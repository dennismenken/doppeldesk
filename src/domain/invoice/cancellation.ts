import type { PlainObject } from "../../lib/object.ts";
import { startOfBerlinDay, toIso } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { createDocument, patchDocument } from "../shared/documents.ts";
import { roundMoney, toNumber } from "../shared/money.ts";
import { issueFreeNumber } from "../shared/numbering.ts";
import { isRefTo, toRef } from "../shared/refs.ts";
import { validationError } from "../shared/validation.ts";
import {
  CANCELLABLE_STATUSES,
  CANCELLATION_NUMBER_RANGE,
  CANCELLATION_STATUS,
  CANCELLED_ORIGINAL_STATUS,
  INVOICE,
  INVOICE_NUMBERED,
  INVOICE_STATUS,
} from "./constants.ts";
import { insertPosition } from "./factory.ts";
import { requireInvoice, statusOf, typeOf } from "./guards.ts";
import { invoicePositions } from "./positions.ts";

/** Header fields the cancellation invoice takes over from the original. */
const COPIED_HEADER_FIELDS = [
  "contact",
  "contactPerson",
  "address",
  "addressCountry",
  "deliveryDate",
  "deliveryDateUntil",
  "timeToPay",
  "discount",
  "discountTime",
  "smallSettlement",
  "taxRate",
  "taxRule",
  "taxText",
  "taxType",
  "taxSet",
  "paymentMethod",
  "costCentre",
  "currency",
  "showNet",
  "propertyIsEInvoice",
] as const;

/** Amount fields of positions and header that are negated on the cancellation invoice. */
const NEGATED_POSITION_FIELDS = [
  "price",
  "priceNet",
  "priceGross",
  "priceTax",
  "sumNet",
  "sumTax",
  "sumGross",
  "sumDiscount",
  "sumNetAccounting",
  "sumTaxAccounting",
  "sumGrossAccounting",
] as const;
const NEGATED_HEADER_FIELDS = [
  "sumNet",
  "sumTax",
  "sumGross",
  "sumDiscounts",
  "sumNetAccounting",
  "sumTaxAccounting",
  "sumGrossAccounting",
] as const;

/**
 * POST /Invoice/{id}/cancelInvoice. Creates the cancellation invoice (live-verified):
 * invoiceType "SR", origin {id, objectName: "Invoice"}, positions with negative price,
 * priceGross, sumGross, sumNet (quantity stays positive) and payDate null.
 * The statuses of original and SR and the allowed source statuses are assumptions,
 * see the constants. Returns the cancellation invoice (assumption; the spec only says
 * "an invoice object").
 */
export function cancelInvoice(tenant: Tenant, id: string): Doc {
  const original = requireInvoice(tenant, id);
  assertCancellable(tenant, original);

  const now = tenant.clock.now();
  const header: PlainObject = {};
  for (const field of COPIED_HEADER_FIELDS) {
    if (original[field] !== undefined) header[field] = original[field];
  }
  for (const field of NEGATED_HEADER_FIELDS) header[field] = negate(original[field]);
  const invoiceNumber = issueFreeNumber(tenant, CANCELLATION_NUMBER_RANGE, INVOICE_NUMBERED);
  const cancellation = createDocument(tenant, INVOICE, header, {
    overrides: {
      invoiceNumber,
      invoiceType: "SR",
      origin: toRef(original.id, INVOICE),
      // Assumption: the cancellation is dated on the day it is created.
      invoiceDate: toIso(startOfBerlinDay(now)),
      header: `Stornorechnung zu Rechnung Nr. ${String(original.invoiceNumber ?? original.id)}`,
      status: CANCELLATION_STATUS,
      payDate: null,
      paidAmount: 0,
      enshrined: null,
      sendDate: null,
      sendType: null,
      createUser: original.contactPerson ?? null,
      sumNetForeignCurrency: 0,
      sumTaxForeignCurrency: 0,
      sumGrossForeignCurrency: 0,
      sumDiscountsForeignCurrency: 0,
    },
  });
  for (const position of invoicePositions(tenant, original.id)) {
    const copy: PlainObject = { ...position };
    for (const field of NEGATED_POSITION_FIELDS) copy[field] = negate(position[field]);
    insertPosition(tenant, cancellation.id, copy);
  }
  patchDocument(tenant, INVOICE, original.id, { status: CANCELLED_ORIGINAL_STATUS });
  return cancellation;
}

/** The cancellation invoice (SR) of an invoice, if one exists. */
export function cancellationOf(tenant: Tenant, invoiceId: string): Doc | undefined {
  return tenant.store
    .collection(INVOICE)
    .findOne((doc) => typeOf(doc) === "SR" && isRefTo(doc.origin, INVOICE, invoiceId));
}

/**
 * 422 when the invoice belongs to a cancellation pair: the cancellation invoice (SR) itself
 * or an original that has one. Both are settled by the cancellation, so status resets and
 * credit notes would leave the pair inconsistent. Assumption: wording and status 422.
 */
export function assertNotCancellationPair(tenant: Tenant, invoice: Doc, action: string): void {
  if (typeOf(invoice) === "SR") throw validationError(`${action} is not possible for cancellation invoices`);
  if (cancellationOf(tenant, invoice.id) !== undefined) {
    throw validationError(`${action} is not possible for cancelled invoices`);
  }
}

/** Assumptions: HTTP 422 and the wording of the rejections; which statuses are cancellable (see constants). */
function assertCancellable(tenant: Tenant, invoice: Doc): void {
  if (typeOf(invoice) === "SR") throw validationError("A cancellation invoice can not be cancelled");
  if (cancellationOf(tenant, invoice.id) !== undefined) throw validationError("Invoice is already cancelled");
  const status = statusOf(invoice);
  if (status === INVOICE_STATUS.draft) {
    throw validationError("Draft invoices can not be cancelled, delete the draft instead");
  }
  if (!CANCELLABLE_STATUSES.includes(status)) {
    throw validationError("Only open invoices can be cancelled, create a credit note for paid invoices");
  }
}

function negate(value: unknown): number {
  const amount = roundMoney(-toNumber(value));
  return amount === 0 ? 0 : amount;
}
