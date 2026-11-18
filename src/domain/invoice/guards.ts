import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { isBlank, validationError } from "../shared/validation.ts";
import { INVOICE } from "./constants.ts";

/** Stored invoice by id, or 404 "No Model_Invoice with the id <id> was found". */
export function requireInvoice(tenant: Tenant, id: string | number): Doc {
  return tenant.store.collection(INVOICE).require(id);
}

/** Status code of an invoice as string ("100", "200", ...). */
export function statusOf(invoice: Doc): string {
  return String(invoice.status ?? "");
}

/** Invoice type, "RE" when unset. */
export function typeOf(invoice: Doc): string {
  return typeof invoice.invoiceType === "string" && invoice.invoiceType !== "" ? invoice.invoiceType : "RE";
}

/**
 * Enshrined invoices are immutable; changes answer HTTP 422 (sevDesk API news, 2024-05-24).
 * Assumption: the message text, which is not documented.
 */
export function assertNotEnshrined(invoice: Doc): void {
  if (!isBlank(invoice.enshrined)) {
    throw validationError(`Invoice with the id ${invoice.id} is enshrined and can not be changed`);
  }
}

/** Assumption: recurring invoices reject status resets with 422 (spec: "cannot be used for WKR"). */
export function assertNotRecurring(invoice: Doc): void {
  if (typeOf(invoice) === "WKR") {
    throw validationError("This endpoint can not be used for recurring invoices (invoiceType WKR)");
  }
}
