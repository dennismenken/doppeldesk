import { isPlainObject, type PlainObject } from "../../lib/object.ts";
import { startOfBerlinDay, toIso } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { assertNotCancellationPair } from "../invoice/cancellation.ts";
import { toNumber } from "../shared/money.ts";
import { comparePositions } from "../shared/positions.ts";
import { isRefTo, type Ref, readRef, toRef } from "../shared/refs.ts";
import { expectedRefError, isBlank, validationError } from "../shared/validation.ts";
import { INVOICE, INVOICE_POS, VOUCHER, VOUCHER_POS } from "./constants.ts";
import { isNetMode } from "./head.ts";
import { normalizePosition } from "./positions.ts";
import { insertCreditNote, type SavedCreditNote } from "./save.ts";

/**
 * Assumption: positions without a unit fall back to unity 1 ("Stk"), the best attested id
 * of the piece unit in sevDesk accounts.
 */
const DEFAULT_UNITY = toRef(1, "Unity");

/**
 * Head fields a credit note copies from its source invoice (same tax and address setup). The
 * texts (header, headText, footText) are not copied, they speak of an invoice; the credit
 * note gets its own default header.
 */
const COPIED_INVOICE_FIELDS = [
  "contact",
  "contactPerson",
  "addressCountry",
  "address",
  "currency",
  "taxRule",
  "taxType",
  "taxSet",
  "taxText",
  "taxRate",
  "showNet",
  "smallSettlement",
  "deliveryDate",
  "deliveryDateUntil",
] as const;

/** Invoice types that cannot be credited with sevdesk-Update 2.0 (advance and partial invoices). */
const NOT_CREDITABLE_INVOICE_TYPES: readonly string[] = ["AR", "TR"];

/**
 * POST /CreditNote/Factory/createFromInvoice: a draft credit note (category UNDERACHIEVEMENT)
 * that points to the invoice via "origin" and "refSrcInvoice" and copies its positions with
 * the invoice's own (positive) amounts. The invoice is not changed (Assumption). Cancellation
 * invoices (SR) and cancelled originals are already settled and are rejected (422, Assumption).
 */
export function createCreditNoteFromInvoice(tenant: Tenant, input: PlainObject): SavedCreditNote {
  const source = readSourceRef("invoice", input.invoice, INVOICE);
  const invoice = tenant.store.collection(INVOICE).require(source.id);
  if (NOT_CREDITABLE_INVOICE_TYPES.includes(String(invoice.invoiceType))) {
    throw validationError("Credit notes cannot be created from advance or partial invoices");
  }
  assertNotCancellationPair(tenant, invoice, "createFromInvoice");
  const sourcePositions = tenant.store
    .collection(INVOICE_POS)
    .find((position) => isRefTo(position.invoice, INVOICE, invoice.id))
    .sort(comparePositions);
  if (sourcePositions.length === 0) throw validationError("The invoice needs at least one position");

  const head: PlainObject = {
    ...copyFields(invoice, COPIED_INVOICE_FIELDS),
    creditNoteDate: todayIso(tenant),
    bookingCategory: "UNDERACHIEVEMENT",
    refSrcInvoice: toRef(invoice.id, INVOICE),
    origin: toRef(invoice.id, INVOICE),
  };
  const netMode = isNetMode(head);
  const positions = sourcePositions.map((position) =>
    normalizePosition(
      {
        ...copyFields(position, [
          "name",
          "text",
          "part",
          "quantity",
          "price",
          "taxRate",
          "discount",
          "optional",
        ]),
        unity: position.unity ?? DEFAULT_UNITY,
      },
      undefined,
      netMode,
    ),
  );
  return insertCreditNote(tenant, head, positions);
}

/**
 * POST /CreditNote/Factory/createFromVoucher (marked "not supported with sevdesk-Update 2.0"
 * in the spec, kept for 1.0 clients). Assumption: the supplier becomes the contact, every
 * voucher position becomes one net position of quantity 1 with its net sum, the voucher
 * description becomes the header and the header tax rate is the main rate of the positions.
 */
export function createCreditNoteFromVoucher(tenant: Tenant, input: PlainObject): SavedCreditNote {
  const source = readSourceRef("voucher", input.voucher, VOUCHER);
  const voucher = tenant.store.collection(VOUCHER).require(source.id);
  const sourcePositions = tenant.store
    .collection(VOUCHER_POS)
    .find((position) => isRefTo(position.voucher, VOUCHER, voucher.id));
  if (sourcePositions.length === 0) throw validationError("The voucher needs at least one position");

  const head: PlainObject = {
    ...copyFields(voucher, ["currency", "taxRule", "taxType", "taxSet", "deliveryDate", "deliveryDateUntil"]),
    contact: voucher.supplier ?? null,
    // Assumption: without a creating user on the voucher the first stored user is the contact person.
    contactPerson: voucher.createUser ?? firstUserRef(tenant),
    header: voucher.description ?? null,
    showNet: true,
    creditNoteDate: todayIso(tenant),
    bookingCategory: "UNDERACHIEVEMENT",
    refSrcVoucher: toRef(voucher.id, VOUCHER),
    origin: toRef(voucher.id, VOUCHER),
  };
  const positions = sourcePositions.map((position) =>
    normalizePosition(
      {
        name: position.comment ?? null,
        quantity: 1,
        price: toNumber(position.sumNet),
        taxRate: toNumber(position.taxRate),
        unity: DEFAULT_UNITY,
      },
      undefined,
      true,
    ),
  );
  return insertCreditNote(tenant, { ...head, taxRate: mainTaxRate(positions) }, positions);
}

/**
 * Header tax rate that matches the positions: the rate with the largest net amount, the higher
 * rate on a tie. Assumption: the header taxRate names the main rate of the document (the
 * voucher itself has no header rate to copy).
 */
function mainTaxRate(positions: readonly PlainObject[]): number {
  const amounts = new Map<number, number>();
  for (const position of positions) {
    const rate = toNumber(position.taxRate);
    amounts.set(rate, (amounts.get(rate) ?? 0) + toNumber(position.quantity) * toNumber(position.price));
  }
  let main = 0;
  let largest = Number.NEGATIVE_INFINITY;
  for (const [rate, amount] of amounts) {
    if (amount > largest || (amount === largest && rate > main)) {
      main = rate;
      largest = amount;
    }
  }
  return main;
}

/** {id, objectName} of the source document; 400 in the factory wording when malformed. */
function readSourceRef(key: string, value: unknown, objectName: string): Ref {
  const ref = isPlainObject(value) && value.objectName === objectName ? readRef(value) : undefined;
  if (ref === undefined) throw expectedRefError(key, value);
  return ref;
}

/** Reference to the first stored SevUser, if any. */
function firstUserRef(tenant: Tenant): Ref | null {
  const user = tenant.store.collection("SevUser").all()[0];
  return user === undefined ? null : toRef(user.id, "SevUser");
}

/** Copies the listed fields that carry a value. */
function copyFields(source: Doc, keys: readonly string[]): PlainObject {
  const copy: PlainObject = {};
  for (const key of keys) {
    if (!isBlank(source[key])) copy[key] = source[key];
  }
  return copy;
}

/** Midnight of today (Berlin) as ISO string: the credit note date of created drafts. */
function todayIso(tenant: Tenant): string {
  return toIso(startOfBerlinDay(tenant.clock.now()));
}
