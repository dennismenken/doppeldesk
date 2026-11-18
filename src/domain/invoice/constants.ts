import type { NumberedModel, NumberRangeKey } from "../shared/numbering.ts";
import { BOOKING_TYPES, contactPayee, type PayableModel } from "../shared/payments.ts";
import type { PositionModel } from "../shared/positions.ts";
import type { SendableModel } from "../shared/sending.ts";

export const INVOICE = "Invoice";
export const INVOICE_POS = "InvoicePos";
/** Booking log entries, objectName as in the bookAmount response of the spec. */
export const INVOICE_LOG = "InvoiceLog";

/** Invoice status codes (spec enum, strings as sevDesk renders them). */
export const INVOICE_STATUS = {
  /** Deactivated recurring invoice (WKR only). */
  deactivated: "50",
  draft: "100",
  open: "200",
  partiallyPaid: "750",
  paid: "1000",
} as const;

/** Invoice types of the spec enum (Model_Invoice.invoiceType). */
export const INVOICE_TYPES = ["RE", "WKR", "SR", "MA", "TR", "AR", "ER"] as const;

/** Status values a client may send in saveInvoice (spec enum of Model_Invoice.status). */
export const INVOICE_STATUS_CODES: readonly string[] = Object.values(INVOICE_STATUS);

/** Invoice numbers are unique over all invoices (SR and MA share the invoice range). */
export const INVOICE_NUMBERED: NumberedModel = { model: INVOICE, field: "invoiceNumber" };

/** Where invoice positions live. */
export const INVOICE_POSITIONS: PositionModel = {
  model: INVOICE_POS,
  parentField: "invoice",
  parentModel: INVOICE,
};

/**
 * bookAmount for invoices. Assumptions: open (200) and partially paid (750) invoices can be
 * booked; a payment is money arriving on the account. The log references the invoice as
 * "creditNote" and spells "ammountPayed" like the spec's InvoiceLog.
 */
export const INVOICE_PAYABLE: PayableModel = {
  model: INVOICE,
  logModel: INVOICE_LOG,
  logRef: "creditNote",
  logAmountField: "ammountPayed",
  bookingTypes: BOOKING_TYPES,
  bookableStatuses: [200, 750],
  paidStatus: 1000,
  partiallyPaidStatus: 750,
  direction: () => 1,
  purpose: (invoice) => (typeof invoice.invoiceNumber === "string" ? invoice.invoiceNumber : null),
  payee: contactPayee("contact"),
};

/** Sending invoices: 100 -> 200, a contact is required beyond draft (Update 2.0, 422). */
export const INVOICE_SENDABLE: SendableModel = {
  model: INVOICE,
  draftStatus: 100,
  sentStatus: 200,
  requiresContact: true,
};

/** Number range of regular invoices (RE- is live-observed). */
export const INVOICE_NUMBER_RANGE: NumberRangeKey = "invoice";

/**
 * Cancellation invoices draw "the next free number from your invoice number range"
 * (sevDesk help center, article 9154465). Assumption: the API behaves like the web UI,
 * so SR invoices use the invoice range and not a separate "SR-" range.
 */
export const CANCELLATION_NUMBER_RANGE: NumberRangeKey = "invoice";

/** Assumption: payment reminders (MA) also draw from the invoice number range. */
export const REMINDER_NUMBER_RANGE: NumberRangeKey = "invoice";

/**
 * Status of the original invoice after cancelInvoice. The spec says it changes to
 * "cancelled" but has no code for it; a third-party source reports 1000.
 * Assumption: 1000 (paid), until verified against a real account.
 */
export const CANCELLED_ORIGINAL_STATUS = INVOICE_STATUS.paid;

/** Status of the cancellation invoice (SR). Spec/help center: "automatically paid". Assumption for the API: 1000. */
export const CANCELLATION_STATUS = INVOICE_STATUS.paid;

/**
 * Statuses from which cancelInvoice is allowed. Help center: only unpaid ("offen oder
 * fällig") invoices can be cancelled. Assumption: drafts (100) and partially paid (750)
 * invoices are rejected as well; drafts are meant to be deleted instead.
 */
export const CANCELLABLE_STATUSES: readonly string[] = [INVOICE_STATUS.open];

/**
 * Assumption: listing without showAll/showWkr/showMa hides recurring invoices (WKR)
 * and payment reminders (MA); derived from the spec's filter descriptions
 * ("showWkr=all Retrieve all recurring invoices", "showMa=all ... payment reminders").
 */
export const HIDDEN_BY_DEFAULT: readonly string[] = ["WKR", "MA"];
