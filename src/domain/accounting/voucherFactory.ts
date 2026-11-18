import type { PlainObject } from "../../lib/object.ts";
import { toIso } from "../../lib/time.ts";
import type { RouteDefinition } from "../../routes/types.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { clientFields, createDocument } from "../shared/documents.ts";
import { isTrue } from "../shared/list.ts";
import { computeDocumentTotals, computePositionSums, type PositionSums, toNumber } from "../shared/money.ts";
import { type PositionModel, positionsOf } from "../shared/positions.ts";
import { requireReferencedObjects } from "../shared/references.ts";
import { refId, toRef } from "../shared/refs.ts";
import {
  deletedIds,
  expectedRefError,
  factoryPart,
  invalidParameter,
  isBlank,
  listOf,
  missingParameters,
  validationError,
} from "../shared/validation.ts";
import { dateField, omitKeys, refField } from "./common.ts";

const VOUCHER = "Voucher";
const VOUCHER_POS = "VoucherPos";

/** Header date fields: input in any sevDesk date format, stored as Berlin-day ISO. */
const HEADER_DATE_FIELDS = [
  "voucherDate",
  "deliveryDate",
  "deliveryDateUntil",
  "paymentDeadline",
  "propertyForeignCurrencyDeadline",
  "recurringStartDate",
  "recurringNextVoucher",
  "recurringLastVoucher",
  "recurringEndDate",
] as const;

/** Header reference fields and the object name their references get. */
const HEADER_REF_FIELDS: Readonly<Record<string, string>> = {
  supplier: "Contact",
  costCentre: "CostCentre",
  taxRule: "TaxRule",
  taxSet: "TaxSet",
};

/** Header fields the server computes; client values are ignored. */
const COMPUTED_HEADER_FIELDS: ReadonlySet<string> = new Set([
  "sumNet",
  "sumTax",
  "sumGross",
  "sumNetAccounting",
  "sumTaxAccounting",
  "sumGrossAccounting",
  "sumDiscounts",
  "sumDiscountsForeignCurrency",
  "paidAmount",
  "payDate",
  "enshrined",
  "createUser",
  "document",
]);

/** Position fields the server computes or replaces by normalized values. */
const COMPUTED_POSITION_FIELDS: ReadonlySet<string> = new Set([
  "sum",
  "sumNet",
  "sumTax",
  "sumGross",
  "sumNetAccounting",
  "sumTaxAccounting",
  "sumGrossAccounting",
  "voucher",
  "accountDatev",
  "accountingType",
  "estimatedAccountingType",
  "net",
  "isAsset",
  "taxRate",
]);

const FACTORY_STATUSES: readonly number[] = [50, 100];
const CREDIT_DEBIT: readonly string[] = ["C", "D"];
const VOUCHER_TYPES: readonly string[] = ["VOU", "RV"];

/** Result of the voucher factory: the voucher, its positions and the attached filename. */
export interface SavedVoucher {
  voucher: Doc;
  voucherPos: Doc[];
  filename: string | null;
}

/** A validated position of the request, not yet written. */
interface PositionDraft {
  /** Set when an existing position is updated. */
  id: string | undefined;
  data: PlainObject;
  net: boolean;
  sums: PositionSums;
}

function requireMapAll(object: PlainObject, key: string): void {
  if (!isTrue(object.mapAll)) throw expectedRefError(key, object);
}

/** Converts date and reference fields of a voucher header; absent keys stay absent. */
export function normalizeHeader(input: PlainObject): PlainObject {
  const result: PlainObject = { ...omitKeys(clientFields(input), COMPUTED_HEADER_FIELDS) };
  for (const field of HEADER_DATE_FIELDS) {
    if (field in input) result[field] = dateField(input[field], field);
  }
  for (const [field, objectName] of Object.entries(HEADER_REF_FIELDS)) {
    if (field in input) result[field] = refField(input[field], objectName);
  }
  if ("status" in input) result.status = Number(input.status);
  return result;
}

/** Checks header rules of the factory (create and update) on the merged header. */
function validateHeader(header: PlainObject): void {
  const missing = ["creditDebit", "voucherType", "status"].filter((key) => isBlank(header[key]));
  // Assumption: Update 2.0 clients send taxRule, 1.0 clients taxType; one of them is enough.
  if (isBlank(header.taxRule) && isBlank(header.taxType)) missing.push("taxRule");
  if (missing.length > 0) throw missingParameters(missing, 422);
  if (!CREDIT_DEBIT.includes(String(header.creditDebit))) {
    throw invalidParameter("creditDebit", { allowed: CREDIT_DEBIT, status: 422 });
  }
  if (!VOUCHER_TYPES.includes(String(header.voucherType))) {
    throw invalidParameter("voucherType", { allowed: VOUCHER_TYPES, status: 422 });
  }
  if (!FACTORY_STATUSES.includes(Number(header.status))) {
    throw validationError("The only valid status values for this endpoint are 50 (draft) and 100 (open).");
  }
}

/** 404 when the header references a supplier contact or a tax rule that does not exist. */
export function assertHeaderReferencesExist(tenant: Tenant, header: PlainObject): void {
  requireReferencedObjects(tenant, header, { supplier: "Contact", taxRule: "TaxRule" });
}

/**
 * Rules of the saved voucher as a whole: a supplier contact or a free supplier name, and at
 * least one position. Assumption: both answer 422 like the other document factories.
 */
function validateVoucherContent(header: PlainObject, positionCount: number): void {
  if (isBlank(header.supplier) && isBlank(header.supplierName)) {
    throw missingParameters(["supplier"], 422);
  }
  if (positionCount === 0) throw validationError("A voucher needs at least one position");
}

/** Validates one position of "voucherPosSave" and computes its sums. */
function draftPosition(raw: unknown, index: number): PositionDraft {
  const key = `voucherPosSave[${index}]`;
  const position = factoryPart(key, raw, VOUCHER_POS);
  requireMapAll(position, key);
  const missing = ["net", "taxRate"]
    .filter((field) => isBlank(position[field]))
    .map((field) => `${key}.${field}`);
  if (missing.length > 0) throw missingParameters(missing, 422);
  const accountDatev = refField(position.accountDatev, "AccountDatev");
  const accountingType = refField(position.accountingType, "AccountingType");
  if (accountDatev === null && accountingType === null) throw missingParameters([`${key}.accountDatev`], 422);

  const net = isTrue(position.net);
  const amount = net ? (position.sumNet ?? position.sum) : (position.sumGross ?? position.sum);
  if (isBlank(amount)) throw missingParameters([`${key}.${net ? "sumNet" : "sumGross"}`], 422);
  const sums = computePositionSums({
    quantity: 1,
    price: toNumber(amount),
    taxRate: toNumber(position.taxRate),
    mode: net ? "net" : "gross",
  });
  const id = refId(position.id);
  const data: PlainObject = {
    ...omitKeys(clientFields(position), COMPUTED_POSITION_FIELDS),
    accountDatev,
    accountingType,
    estimatedAccountingType: refField(position.estimatedAccountingType, "AccountingType"),
    taxRate: sums.taxRate,
    net,
    isAsset: isTrue(position.isAsset),
    sumNet: sums.sumNet,
    sumTax: sums.sumTax,
    sumGross: sums.sumGross,
    sumNetAccounting: sums.sumNet,
    sumTaxAccounting: sums.sumTax,
    sumGrossAccounting: sums.sumGross,
    comment: position.comment ?? null,
  };
  return { id, data, net, sums };
}

/** Sums of the header from the position sums ("net" decides the leading amount). */
function headerSums(positions: readonly Doc[]): PlainObject {
  const net = positions.every((position) => position.net !== false);
  const sums = positions.map((position) =>
    computePositionSums({
      quantity: 1,
      price: toNumber(net ? position.sumNet : position.sumGross),
      taxRate: toNumber(position.taxRate),
      mode: net ? "net" : "gross",
    }),
  );
  const totals = computeDocumentTotals(sums, net ? "net" : "gross");
  return {
    sumNet: totals.sumNet,
    sumTax: totals.sumTax,
    sumGross: totals.sumGross,
    // Assumption: no foreign currency handling, accounting sums equal the document sums.
    sumNetAccounting: totals.sumNet,
    sumTaxAccounting: totals.sumTax,
    sumGrossAccounting: totals.sumGross,
    sumDiscounts: 0,
  };
}

/** Where voucher positions live. */
const VOUCHER_POSITIONS: PositionModel = { model: VOUCHER_POS, parentField: "voucher", parentModel: VOUCHER };

/** Positions of a voucher (ascending id, vouchers have no position numbers). */
function voucherPositions(tenant: Tenant, voucherId: string): Doc[] {
  return positionsOf(tenant, VOUCHER_POSITIONS, voucherId);
}

/**
 * Factory behind POST /Voucher/Factory/saveVoucher: creates a voucher with positions, or
 * updates a draft when the header carries an id. Everything is validated before the
 * first write: header rules, supplier (contact or name, an unknown contact is 404) and at
 * least one position.
 */
export function saveVoucher(tenant: Tenant, input: PlainObject): SavedVoucher {
  const header = factoryPart("voucher", input.voucher, VOUCHER);
  const vouchers = tenant.store.collection(VOUCHER);
  const existingId = refId(header.id);
  const existing = existingId === undefined ? undefined : vouchers.require(existingId);
  const filename = typeof input.filename === "string" && input.filename !== "" ? input.filename : null;

  // Live (invoices): updating through the factory without mapAll answers 201 but changes nothing.
  if (existing !== undefined && !isTrue(header.mapAll)) {
    return { voucher: existing, voucherPos: voucherPositions(tenant, existing.id), filename };
  }
  requireMapAll(header, "voucher");
  if (existing !== undefined && Number(existing.status) !== 50) {
    // Assumption: the 422 wording is not verified; the rule "only drafts" is documented.
    throw validationError("You can only update draft vouchers");
  }

  const drafts = listOf(input.voucherPosSave).map((raw, index) => draftPosition(raw, index));
  const removals =
    existing === undefined ? [] : deletedIds("voucherPosDelete", input.voucherPosDelete, VOUCHER_POS);
  for (const id of removals) {
    const position = tenant.store.collection(VOUCHER_POS).require(id);
    if (refId(position.voucher) !== existing?.id)
      throw validationError(`Position ${id} does not belong to the voucher`);
  }
  for (const draft of drafts) {
    if (draft.id === undefined) continue;
    const position = tenant.store.collection(VOUCHER_POS).require(draft.id);
    if (refId(position.voucher) !== existing?.id)
      throw validationError(`Position ${draft.id} does not belong to the voucher`);
  }
  const keptIds = new Set(drafts.map((draft) => draft.id));
  const keptExisting =
    existing === undefined
      ? []
      : voucherPositions(tenant, existing.id).filter(
          (position) => !removals.includes(position.id) && !keptIds.has(position.id),
        );
  const modes = new Set([
    ...drafts.map((draft) => draft.net),
    ...keptExisting.map((position) => position.net !== false),
  ]);
  if (modes.size > 1) throw validationError("All positions must be either net or gross");

  const normalized = normalizeHeader(header);
  const merged: PlainObject = { ...existing, ...normalized };
  validateHeader(merged);
  validateVoucherContent(merged, drafts.length + keptExisting.length);
  assertHeaderReferencesExist(tenant, merged);

  // All checks passed, from here on only writes.
  const document = filename === null ? undefined : attachDocument(tenant, filename);
  const stored =
    existing === undefined
      ? createDocument(tenant, VOUCHER, normalized, {
          defaults: {
            currency: "EUR",
            mapAll: true,
            paidAmount: 0,
            payDate: null,
            enshrined: null,
            createUser: createUserRef(tenant),
            document: null,
          },
        })
      : vouchers.require(existing.id);
  const voucherRef = toRef(stored.id, VOUCHER);
  const positions = tenant.store.collection(VOUCHER_POS);
  for (const id of removals) positions.delete(id);
  const now = toIso(tenant.clock.now());
  for (const draft of drafts) {
    if (draft.id === undefined) {
      createDocument(tenant, VOUCHER_POS, { ...draft.data, voucher: voucherRef });
    } else {
      positions.update(draft.id, { ...draft.data, update: now });
    }
  }
  const allPositions = voucherPositions(tenant, stored.id);
  const patch: PlainObject = {
    ...(existing === undefined ? {} : { ...normalized, update: now }),
    ...headerSums(allPositions),
    ...(document === undefined ? {} : { document: toRef(document.id, "Document") }),
  };
  const voucher = vouchers.update(stored.id, patch) ?? stored;
  return { voucher, voucherPos: allPositions, filename };
}

/** Stores the uploaded file as Document and returns it. */
function attachDocument(tenant: Tenant, filename: string): Doc {
  return createDocument(tenant, "Document", { filename });
}

/** The first SevUser of the tenant as creator, if there is one. */
function createUserRef(tenant: Tenant): ReturnType<typeof toRef> | null {
  const user = tenant.store.collection("SevUser").all()[0];
  return user === undefined ? null : toRef(user.id, "SevUser");
}

export const voucherFactoryRoutes: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/Voucher/Factory/saveVoucher",
    handler: ({ tenant, input }) => {
      const saved = saveVoucher(tenant, input);
      return { objects: { voucher: saved.voucher, voucherPos: saved.voucherPos, filename: saved.filename } };
    },
  },
];
