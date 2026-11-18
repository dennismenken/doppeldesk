import type { PlainObject } from "../../lib/object.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { bookAmount, isPartiallyPaid as isDocumentPartiallyPaid } from "../shared/payments.ts";
import { INVOICE_PAYABLE } from "./constants.ts";

/**
 * PUT /Invoice/{id}/bookAmount (shared booking rules, see shared/payments.ts). Returns the
 * InvoiceLog entry (spec response; the invoice reference is named "creditNote" there).
 */
export function bookInvoiceAmount(tenant: Tenant, id: string, input: PlainObject): PlainObject {
  return bookAmount(tenant, INVOICE_PAYABLE, id, input);
}

/** GET /Invoice/{id}/getIsPartiallyPaid (shared rule, see shared/payments.ts). */
export function isPartiallyPaid(invoice: Doc): boolean {
  return isDocumentPartiallyPaid(INVOICE_PAYABLE, invoice);
}
