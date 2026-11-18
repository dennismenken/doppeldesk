import { ApiError } from "../../lib/errors.ts";
import type { PlainObject } from "../../lib/object.ts";
import { toIso } from "../../lib/time.ts";
import { pathParam } from "../../routes/context.ts";
import { listModel } from "../../routes/generic.ts";
import type { RouteContext, RouteDefinition, RouteResult } from "../../routes/types.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { contactName, contactOf } from "../shared/contacts.ts";
import { deleteWithDependents, patchDocument, updateDocument } from "../shared/documents.ts";
import { containsFilter, unixDateFilter } from "../shared/filters.ts";
import { matchesFieldFilter } from "../shared/list.ts";
import {
  BOOK_AMOUNT_UNVALIDATED_FIELDS,
  BOOKING_TYPES,
  bookAmount,
  type PayableModel,
  unlinkPayments,
} from "../shared/payments.ts";
import { tagsFilter } from "../shared/tags.ts";
import { isBlank, validationError } from "../shared/validation.ts";
import { omitKeys } from "./common.ts";
import { assertHeaderReferencesExist, normalizeHeader } from "./voucherFactory.ts";

const VOUCHER = "Voucher";
const DRAFT = 50;
const OPEN = 100;
const PARTIALLY_PAID = 750;
const PAID = 1000;

/** Fields a PUT on a draft must not change ("can not change the status"; sums come from positions). */
const READ_ONLY_ON_UPDATE: ReadonlySet<string> = new Set(["status", "voucherType", "creditDebit"]);

/**
 * bookAmount for vouchers: registered (100) or partially paid (750) vouchers, CF is not
 * supported (spec). Assumption: money leaves the account for expenses (C) and arrives for
 * income (D); the payee is the supplier contact, else the free supplier name. The log uses
 * the spec's spelling "amountPayed" (one m) for vouchers.
 */
export const VOUCHER_PAYABLE: PayableModel = {
  model: VOUCHER,
  logModel: "VoucherLog",
  logRef: "voucher",
  logAmountField: "amountPayed",
  bookingTypes: BOOKING_TYPES.filter((type) => type !== "CF"),
  bookableStatuses: [OPEN, PARTIALLY_PAID],
  paidStatus: PAID,
  partiallyPaidStatus: PARTIALLY_PAID,
  direction: (voucher) => (voucher.creditDebit === "C" ? -1 : 1),
  purpose: (voucher) => (typeof voucher.description === "string" ? voucher.description : null),
  payee: (tenant, voucher) =>
    contactName(contactOf(tenant, voucher.supplier)) ||
    (typeof voucher.supplierName === "string" ? voucher.supplierName : ""),
};

/** PUT /Voucher/{id}/bookAmount (shared booking rules); returns the VoucherLog entry. */
export function bookVoucherAmount(tenant: Tenant, id: string, input: PlainObject): PlainObject {
  return bookAmount(tenant, VOUCHER_PAYABLE, id, input);
}

function loadVoucher(context: RouteContext): Doc {
  return context.tenant.store.collection(VOUCHER).require(pathParam(context, "voucherId"));
}

function listVouchers(context: RouteContext): RouteResult {
  return listModel(context, VOUCHER, {
    filters: {
      descriptionLike: containsFilter("description"),
      startDate: unixDateFilter("voucherDate", ">="),
      endDate: unixDateFilter("voucherDate", "<="),
      // The voucher's contact is its supplier.
      contact: (doc, value) => matchesFieldFilter(doc.supplier, value),
      tags: tagsFilter(context.tenant, VOUCHER, "all"),
    },
  });
}

/** PUT /Voucher/{id}: simple values of a draft only; status and sums cannot change. */
function updateVoucher(context: RouteContext): RouteResult {
  const voucher = loadVoucher(context);
  if (Number(voucher.status) !== DRAFT) {
    // Assumption: the 422 wording is not verified; the rule "only drafts" is documented.
    throw validationError("You can only update draft vouchers");
  }
  const fields = omitKeys(normalizeHeader(context.input), READ_ONLY_ON_UPDATE);
  assertHeaderReferencesExist(context.tenant, fields);
  return { objects: updateDocument(context.tenant, VOUCHER, voucher.id, fields) };
}

/**
 * DELETE /Voucher/{id} (missing in the spec, which declares 409 for every DELETE).
 * Assumption: like invoices, only drafts (50) can be deleted; positions and tag relations
 * go with them, everything else answers 409.
 */
function deleteVoucher(context: RouteContext): RouteResult {
  const voucher = loadVoucher(context);
  if (Number(voucher.status) !== DRAFT) throw new ApiError(409, "Only draft vouchers can be deleted");
  deleteWithDependents(context.tenant, VOUCHER, voucher.id, [{ model: "VoucherPos", field: "voucher" }]);
  return { objects: [null] };
}

/** PUT /Voucher/{id}/enshrine: from status 100, only once (422); the spec declares {"objects": null}. */
function enshrineVoucher(context: RouteContext): RouteResult {
  const voucher = loadVoucher(context);
  if (!isBlank(voucher.enshrined)) throw validationError("The voucher is already enshrined");
  if (Number(voucher.status) < OPEN) {
    throw validationError("Only registered vouchers (status 100 or higher) can be enshrined");
  }
  const { tenant } = context;
  patchDocument(tenant, VOUCHER, voucher.id, { enshrined: toIso(tenant.clock.now()) });
  return { objects: null };
}

function resetVoucher(context: RouteContext, target: typeof DRAFT | typeof OPEN): RouteResult {
  const voucher = loadVoucher(context);
  const { tenant } = context;
  if (!isBlank(voucher.enshrined)) throw validationError("The voucher is enshrined and can not be reset");
  if (target === OPEN && Number(voucher.status) === DRAFT) {
    throw validationError("A draft voucher can not be reset to open");
  }
  unlinkPayments(tenant, VOUCHER_PAYABLE, voucher.id);
  return {
    objects: patchDocument(tenant, VOUCHER, voucher.id, { status: target, payDate: null, paidAmount: 0 }),
  };
}

export const voucherRoutes: readonly RouteDefinition[] = [
  { method: "GET", path: "/Voucher", handler: listVouchers },
  { method: "PUT", path: "/Voucher/{voucherId}", handler: updateVoucher },
  { method: "DELETE", path: "/Voucher/{voucherId}", handler: deleteVoucher },
  { method: "PUT", path: "/Voucher/{voucherId}/enshrine", handler: enshrineVoucher },
  {
    method: "PUT",
    path: "/Voucher/{voucherId}/bookAmount",
    unvalidatedFields: BOOK_AMOUNT_UNVALIDATED_FIELDS,
    handler: (context) => ({
      objects: bookVoucherAmount(context.tenant, pathParam(context, "voucherId"), context.input),
    }),
  },
  {
    method: "PUT",
    path: "/Voucher/{voucherId}/resetToOpen",
    // The spec's allOf example overrides the status type; shape by the plain voucher schema.
    responseSchema: "Model_VoucherResponse",
    handler: (context) => resetVoucher(context, OPEN),
  },
  {
    method: "PUT",
    path: "/Voucher/{voucherId}/resetToDraft",
    responseSchema: "Model_VoucherResponse",
    handler: (context) => resetVoucher(context, DRAFT),
  },
];
