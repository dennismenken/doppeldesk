import type { NumberedModel } from "../shared/numbering.ts";
import { BOOKING_TYPES, contactPayee, type PayableModel } from "../shared/payments.ts";
import type { PositionModel } from "../shared/positions.ts";
import type { SendableModel } from "../shared/sending.ts";

/** Collection names (sevDesk objectNames) used by the credit note module. */
export const CREDIT_NOTE = "CreditNote";
export const CREDIT_NOTE_POS = "CreditNotePos";
export const CREDIT_NOTE_LOG = "CreditNoteLog";
export const CONTACT = "Contact";
export const INVOICE = "Invoice";
export const INVOICE_POS = "InvoicePos";
export const VOUCHER = "Voucher";
export const VOUCHER_POS = "VoucherPos";

/** Credit note status codes (spec tag "CreditNote"). */
export const CREDIT_NOTE_STATUS = {
  draft: 100,
  open: 200,
  partiallyPaid: 750,
  paid: 1000,
} as const;

/** Booking categories (spec tag "CreditNote", table "Credit note types"). */
export const BOOKING_CATEGORIES = [
  "PROVISION",
  "ROYALTY_ASSIGNED",
  "ROYALTY_UNASSIGNED",
  "UNDERACHIEVEMENT",
  "ACCOUNTING_TYPE",
] as const;

/** Where credit note positions live. */
/** Credit note numbers are unique over all credit notes. */
export const CREDIT_NOTE_NUMBERED: NumberedModel = { model: CREDIT_NOTE, field: "creditNoteNumber" };

export const CREDIT_NOTE_POSITIONS: PositionModel = {
  model: CREDIT_NOTE_POS,
  parentField: "creditNote",
  parentModel: CREDIT_NOTE,
};

/**
 * bookAmount for credit notes: open (200) or partially paid (750) credit notes; a credit
 * note is money leaving the account (assumption), CF is not supported (spec).
 */
export const CREDIT_NOTE_PAYABLE: PayableModel = {
  model: CREDIT_NOTE,
  logModel: CREDIT_NOTE_LOG,
  logRef: "creditNote",
  logAmountField: "ammountPayed",
  bookingTypes: BOOKING_TYPES.filter((type) => type !== "CF"),
  bookableStatuses: [CREDIT_NOTE_STATUS.open, CREDIT_NOTE_STATUS.partiallyPaid],
  paidStatus: CREDIT_NOTE_STATUS.paid,
  partiallyPaidStatus: CREDIT_NOTE_STATUS.partiallyPaid,
  direction: () => -1,
  purpose: (creditNote) =>
    typeof creditNote.creditNoteNumber === "string" ? creditNote.creditNoteNumber : null,
  payee: contactPayee("contact"),
};

/** Sending credit notes: 100 -> 200; assumption: a contact is required beyond draft like for invoices. */
export const CREDIT_NOTE_SENDABLE: SendableModel = {
  model: CREDIT_NOTE,
  draftStatus: CREDIT_NOTE_STATUS.draft,
  sentStatus: CREDIT_NOTE_STATUS.open,
  requiresContact: true,
};

/** Reference fields of the credit note head and the object each one points to. */
export const HEAD_REFS: Readonly<Record<string, string>> = {
  contact: CONTACT,
  addressCountry: "StaticCountry",
  contactPerson: "SevUser",
  taxRule: "TaxRule",
  taxSet: "TaxSet",
  refSrcInvoice: INVOICE,
  refSrcVoucher: VOUCHER,
};

/** Date fields of the credit note head (accepted as unix timestamp, dd.mm.yyyy or ISO). */
export const HEAD_DATES: readonly string[] = ["creditNoteDate", "deliveryDate", "deliveryDateUntil"];

/** Head fields clients cannot set: they follow from positions or from status transitions. */
export const HEAD_SERVER_FIELDS: ReadonlySet<string> = new Set([
  "status",
  "sumNet",
  "sumTax",
  "sumGross",
  "sumDiscounts",
  "sumNetForeignCurrency",
  "sumTaxForeignCurrency",
  "sumGrossForeignCurrency",
  "sumDiscountsForeignCurrency",
  "enshrined",
  "payDate",
  "paidAmount",
  "createUser",
  "sendDate",
  "sendType",
]);

/** Position fields that are derived (or set by the server) and ignored from requests. */
export const POSITION_SERVER_FIELDS: ReadonlySet<string> = new Set([
  "creditNote",
  "priceNet",
  "priceGross",
  "priceTax",
  "sumNet",
  "sumGross",
  "sumTax",
  "sumDiscount",
]);
