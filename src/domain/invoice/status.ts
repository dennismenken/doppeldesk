import { ApiError } from "../../lib/errors.ts";
import type { PlainObject } from "../../lib/object.ts";
import { toIso } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { deleteWithDependents, patchDocument } from "../shared/documents.ts";
import { releaseNumber } from "../shared/numbering.ts";
import { unlinkPayments } from "../shared/payments.ts";
import { sendBy, sendViaEmail, UNSENT_FIELDS } from "../shared/sending.ts";
import { validationError } from "../shared/validation.ts";
import { assertNotCancellationPair } from "./cancellation.ts";
import {
  INVOICE,
  INVOICE_PAYABLE,
  INVOICE_POSITIONS,
  INVOICE_SENDABLE,
  INVOICE_STATUS,
} from "./constants.ts";
import { numberRangeFor } from "./factory.ts";
import { assertNotEnshrined, assertNotRecurring, requireInvoice, statusOf, typeOf } from "./guards.ts";

/** PUT /Invoice/{id}/sendBy (shared sending rules): a draft becomes open (100 -> 200, live). */
export function sendInvoice(tenant: Tenant, id: string, input: PlainObject): Doc {
  return sendBy(tenant, INVOICE_SENDABLE, id, input);
}

/** POST /Invoice/{id}/sendViaEmail: marks the invoice as sent (VM) and stores an Email document. */
export function sendInvoiceViaEmail(tenant: Tenant, id: string, input: PlainObject): PlainObject {
  return sendViaEmail(tenant, INVOICE_SENDABLE, id, input);
}

/**
 * PUT /Invoice/{id}/enshrine: sets enshrined to the current time; only from status
 * 200 upwards and only once (spec: 422). Assumption: the message texts.
 */
export function enshrineInvoice(tenant: Tenant, id: string): Doc {
  const invoice = requireInvoice(tenant, id);
  assertNotEnshrined(invoice);
  if (Number(statusOf(invoice)) < Number(INVOICE_STATUS.open)) {
    throw validationError("Only invoices with status open or higher can be enshrined");
  }
  return patchDocument(tenant, INVOICE, invoice.id, { enshrined: toIso(tenant.clock.now()) });
}

/**
 * PUT /Invoice/{id}/resetToOpen: back to 200, payments are unlinked (spec). Not for
 * enshrined or recurring invoices and not to raise a draft (spec: 422).
 * Assumptions: payDate is cleared and paidAmount reset to 0; cancellation invoices and
 * cancelled originals are rejected (422).
 */
export function resetInvoiceToOpen(tenant: Tenant, id: string): Doc {
  const invoice = requireInvoice(tenant, id);
  assertNotEnshrined(invoice);
  assertNotRecurring(invoice);
  assertNotCancellationPair(tenant, invoice, "resetToOpen");
  if (statusOf(invoice) === INVOICE_STATUS.draft) {
    throw validationError("The status of a draft can not be raised with resetToOpen, use sendBy instead");
  }
  unlinkPayments(tenant, INVOICE_PAYABLE, invoice.id);
  return patchDocument(tenant, INVOICE, invoice.id, {
    status: INVOICE_STATUS.open,
    payDate: null,
    paidAmount: 0,
  });
}

/**
 * PUT /Invoice/{id}/resetToDraft: only from status 200 (spec; higher status needs
 * resetToOpen first), not for enshrined or recurring invoices (422).
 * Assumptions: a draft stays a draft (no-op); the draft is unsent again, so sendType and
 * sendDate are cleared like on never-sent drafts; cancellation pairs are rejected (422).
 */
export function resetInvoiceToDraft(tenant: Tenant, id: string): Doc {
  const invoice = requireInvoice(tenant, id);
  assertNotEnshrined(invoice);
  assertNotRecurring(invoice);
  assertNotCancellationPair(tenant, invoice, "resetToDraft");
  const status = statusOf(invoice);
  if (status === INVOICE_STATUS.draft) return invoice;
  if (status !== INVOICE_STATUS.open) {
    throw validationError("Only invoices with status open can be reset to draft, use resetToOpen first");
  }
  unlinkPayments(tenant, INVOICE_PAYABLE, invoice.id);
  return patchDocument(tenant, INVOICE, invoice.id, {
    status: INVOICE_STATUS.draft,
    payDate: null,
    ...UNSENT_FIELDS,
  });
}

/**
 * DELETE /Invoice/{id} (not in the spec, live: works for drafts). Positions, discounts and
 * tag relations go with it; the number is given back when it was the last one issued
 * (live-verified for credit notes, assumption for invoices).
 * Assumption: deleting a non-draft answers HTTP 409, as the spec declares 409 for all
 * DELETE operations and a third-party client maps 409 to "deleting a non-draft".
 */
export function deleteInvoice(tenant: Tenant, id: string): void {
  const invoice = requireInvoice(tenant, id);
  if (statusOf(invoice) !== INVOICE_STATUS.draft) {
    throw new ApiError(409, "Only invoices with status draft can be deleted");
  }
  deleteWithDependents(tenant, INVOICE, invoice.id, [
    { model: INVOICE_POSITIONS.model, field: INVOICE_POSITIONS.parentField },
  ]);
  if (typeof invoice.invoiceNumber === "string") {
    releaseNumber(tenant, numberRangeFor(typeOf(invoice)), invoice.invoiceNumber);
  }
}
