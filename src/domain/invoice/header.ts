import type { PlainObject } from "../../lib/object.ts";
import { parseDateInput, toIso } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { clientFields } from "../shared/documents.ts";
import { isTrue } from "../shared/list.ts";
import { toNumber } from "../shared/money.ts";
import { DOCUMENT_HEAD_REFERENCES, requireReferencedObjects } from "../shared/references.ts";
import { toRef } from "../shared/refs.ts";
import {
  expectedRefError,
  invalidParameter,
  isBlank,
  isOneOf,
  missingParameters,
  requireRefTo,
  validationError,
} from "../shared/validation.ts";
import { INVOICE_STATUS, INVOICE_STATUS_CODES, INVOICE_TYPES } from "./constants.ts";
import { statusOf } from "./guards.ts";

/**
 * Header fields only the server sets (status transitions, sums, payments, sending).
 * Client values are ignored: sevDesk Update 2.0 creates invoices as drafts and
 * changes status only through the action endpoints.
 */
const SERVER_HEADER_FIELDS = [
  "status",
  "sumNet",
  "sumTax",
  "sumGross",
  "sumDiscounts",
  "sumNetForeignCurrency",
  "sumTaxForeignCurrency",
  "sumGrossForeignCurrency",
  "sumDiscountsForeignCurrency",
  "sumNetAccounting",
  "sumTaxAccounting",
  "sumGrossAccounting",
  "paidAmount",
  "payDate",
  "enshrined",
  "sendDate",
  "sendType",
  "createUser",
] as const;

/** Optional header date fields, normalized to ISO 8601 (Berlin); a blank value clears them. */
const OPTIONAL_DATE_FIELDS = ["deliveryDate", "deliveryDateUntil", "reminderDeadline"] as const;

/** Reference fields and the model each one references (objectName is optional in requests). */
const REF_FIELDS: Readonly<Record<string, string>> = {
  contact: "Contact",
  contactPerson: "SevUser",
  addressCountry: "StaticCountry",
  taxRule: "TaxRule",
  taxSet: "TaxSet",
  paymentMethod: "PaymentMethod",
  costCentre: "CostCentre",
};

/**
 * Normalizes client header data of saveInvoice: drops server fields, converts dates
 * to ISO and references to {id, objectName} of their model, checks that referenced
 * objects exist (404). With "required", the fields sevDesk needs on create are
 * enforced (live: contactPerson and taxRate).
 */
export function normalizeHeader(tenant: Tenant, input: PlainObject, required: boolean): PlainObject {
  assertEnumValues(input);
  const header = clientFields(input);
  for (const field of SERVER_HEADER_FIELDS) delete header[field];

  // invoiceDate is required: a blank value counts as omitted (create: today, update: unchanged).
  if (isBlank(header.invoiceDate)) delete header.invoiceDate;
  else header.invoiceDate = readDate("invoiceDate", header.invoiceDate);
  for (const field of OPTIONAL_DATE_FIELDS) {
    if (field in header) header[field] = isBlank(header[field]) ? null : readDate(field, header[field]);
  }
  if ("smallSettlement" in header) header.smallSettlement = isTrue(header.smallSettlement);

  for (const [field, objectName] of Object.entries(REF_FIELDS)) {
    const value = header[field];
    if (value === undefined || value === null) continue;
    header[field] = plainIdRef(value, objectName) ?? requireRefTo(field, value, objectName);
  }

  if (required) {
    if (header.contactPerson === undefined || header.contactPerson === null) {
      throw expectedRefError("contactPerson", header.contactPerson);
    }
    if (isBlank(header.taxRate)) throw missingParameters(["invoice[taxRate]"], 422);
  }
  if (header.taxRate !== undefined && header.taxRate !== null) header.taxRate = toNumber(header.taxRate);

  requireReferencedObjects(tenant, header, DOCUMENT_HEAD_REFERENCES);
  return header;
}

function readDate(field: string, value: unknown): string {
  const parsed = parseDateInput(value);
  if (parsed === undefined) throw invalidParameter(`invoice[${field}]`);
  return toIso(parsed);
}

/**
 * Header patch of an existing invoice. origin is set only by the factories that derive an
 * invoice (cancelInvoice, createInvoiceFromOrder, createInvoiceReminder), so a client value is
 * ignored like the other server fields. Assumption: the number of an invoice that left the
 * draft state is final, a different number answers 422 (sevDesk behavior not documented).
 */
export function headerUpdate(existing: Doc, patch: PlainObject): PlainObject {
  const result: PlainObject = { ...patch };
  delete result.origin;
  const changesNumber =
    !isBlank(result.invoiceNumber) && String(result.invoiceNumber) !== String(existing.invoiceNumber);
  if (changesNumber && !isDraftStatus(statusOf(existing))) {
    throw validationError("The invoice number can only be changed while the invoice is a draft");
  }
  return result;
}

function isDraftStatus(status: string): boolean {
  return status === INVOICE_STATUS.draft || status === INVOICE_STATUS.deactivated;
}

/**
 * invoiceType and status must be values of the spec enums (422 like other document field
 * rules, e.g. order.orderType). A valid status other than draft is still ignored on create
 * (see createInvoice).
 */
function assertEnumValues(input: PlainObject): void {
  if (!isBlank(input.invoiceType) && !isOneOf(INVOICE_TYPES, input.invoiceType)) {
    throw invalidParameter("invoice[invoiceType]", { allowed: INVOICE_TYPES, status: 422 });
  }
  if (!isBlank(input.status) && !INVOICE_STATUS_CODES.includes(String(input.status))) {
    throw invalidParameter("invoice[status]", { allowed: INVOICE_STATUS_CODES, status: 422 });
  }
}

/**
 * Spec (saveInvoice): "You can not create a regular invoice with the deliveryDate being
 * later than the invoiceDate" (use AR). Assumption: HTTP 422 like other Update 2.0
 * validation errors; the message is not documented.
 */
export function assertDeliveryDate(header: PlainObject): void {
  const type = header.invoiceType ?? "RE";
  if (type !== "RE") return;
  const invoiceDate = parseDateInput(header.invoiceDate);
  const deliveryDate = parseDateInput(header.deliveryDate);
  if (invoiceDate === undefined || deliveryDate === undefined) return;
  if (deliveryDate.startOf("day") > invoiceDate.startOf("day")) {
    throw validationError(
      "A regular invoice can not have a deliveryDate later than the invoiceDate, use invoiceType AR instead",
    );
  }
}

/** Accepts a plain id for reference fields (lenient; sevDesk documents objects). */
function plainIdRef(value: unknown, objectName: string) {
  return typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))
    ? toRef(value, objectName)
    : undefined;
}
