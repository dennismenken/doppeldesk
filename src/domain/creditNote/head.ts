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
  isBlank,
  isOneOf,
  missingParameters,
  requireRef,
  requireRefTo,
  validationError,
} from "../shared/validation.ts";
import {
  BOOKING_CATEGORIES,
  CREDIT_NOTE_STATUS,
  HEAD_DATES,
  HEAD_REFS,
  HEAD_SERVER_FIELDS,
  INVOICE,
  VOUCHER,
} from "./constants.ts";

/** Numeric status of a stored credit note (the stored value may be a string). */
export function statusOf(doc: Doc): number {
  return toNumber(doc.status);
}

/** True when the credit note shows net prices (default). Assumption: showNet defaults to true. */
export function isNetMode(doc: PlainObject): boolean {
  return isBlank(doc.showNet) ? true : isTrue(doc.showNet);
}

/**
 * Normalizes client head fields: server-owned fields are dropped, references get a
 * canonical shape, dates become ISO 8601 (Berlin), flags become booleans. Throws 400 for
 * malformed references and 422 for unparseable dates or unknown booking categories.
 */
export function normalizeHead(input: PlainObject): PlainObject {
  const head: PlainObject = {};
  for (const [key, value] of Object.entries(clientFields(input))) {
    if (HEAD_SERVER_FIELDS.has(key)) continue;
    const refObjectName = HEAD_REFS[key];
    if (refObjectName !== undefined) {
      head[key] = isBlank(value) ? null : requireRefTo(key, value, refObjectName);
    } else if (key === "origin") {
      head[key] = isBlank(value) ? null : requireRef(key, value, INVOICE);
    } else if (HEAD_DATES.includes(key)) {
      head[key] = isBlank(value) ? null : readDate(key, value);
    } else if (key === "showNet" || key === "smallSettlement") {
      head[key] = isBlank(value) ? null : isTrue(value);
    } else if (key === "taxRate") {
      head[key] = isBlank(value) ? null : toNumber(value);
    } else {
      head[key] = value;
    }
  }
  if (!isBlank(head.bookingCategory) && !isOneOf(BOOKING_CATEGORIES, head.bookingCategory)) {
    throw validationError(`Invalid bookingCategory '${String(head.bookingCategory)}'`);
  }
  return head;
}

function readDate(key: string, value: unknown): string {
  const date = parseDateInput(value);
  if (date === undefined) throw validationError(`Invalid date for '${key}'`);
  return toIso(date);
}

/**
 * Head patch of an existing credit note. origin is set only by the createFrom* factories, so a
 * client value is ignored like the other server fields. Assumption: the number of a credit
 * note that left the draft state is final, a different number answers 422.
 */
export function headUpdate(existing: Doc, patch: PlainObject): PlainObject {
  const result: PlainObject = { ...patch };
  delete result.origin;
  const changesNumber =
    !isBlank(result.creditNoteNumber) &&
    String(result.creditNoteNumber) !== String(existing.creditNoteNumber);
  if (changesNumber && !isDraft(existing)) {
    throw validationError("The credit note number can only be changed while the credit note is a draft");
  }
  return result;
}

/**
 * Required head fields on creation. Assumption: the live factory requires the spec's
 * required fields except the ones the server can derive (number, status, delivery date,
 * header) and the contact (drafts without contact are possible for invoices).
 */
export function assertCreateRequirements(head: PlainObject): void {
  const missing = ["creditNoteDate", "contactPerson", "taxRate", "currency", "bookingCategory"].filter(
    (key) => isBlank(head[key]),
  );
  if (isBlank(head.taxRule) && isBlank(head.taxType)) missing.push("taxRule");
  if (missing.length > 0) throw missingParameters(missing, 422);
}

/** UNDERACHIEVEMENT credits must reference the source invoice or voucher (spec "Credit note types"). */
export function assertBookingCategoryRules(head: PlainObject): void {
  if (
    head.bookingCategory === "UNDERACHIEVEMENT" &&
    isBlank(head.refSrcInvoice) &&
    isBlank(head.refSrcVoucher)
  ) {
    throw validationError("bookingCategory UNDERACHIEVEMENT requires refSrcInvoice or refSrcVoucher");
  }
}

/** 404 when a referenced object of the head (contact, user, country, tax rule, source document) does not exist. */
export function assertReferencesExist(tenant: Tenant, head: PlainObject): void {
  requireReferencedObjects(tenant, head, {
    ...DOCUMENT_HEAD_REFERENCES,
    refSrcInvoice: INVOICE,
    refSrcVoucher: VOUCHER,
  });
}

/** Reference to the stored credit note, as positions and logs carry it. */
export function creditNoteRef(doc: Doc) {
  return toRef(doc.id, "CreditNote");
}

/** Throws 422 when the credit note is enshrined (enshrined credit notes cannot be changed). */
export function assertNotEnshrined(doc: Doc): void {
  if (!isBlank(doc.enshrined)) throw validationError("Enshrined credit notes cannot be changed");
}

/** True for credit notes that never left the draft state. */
export function isDraft(doc: Doc): boolean {
  return statusOf(doc) === CREDIT_NOTE_STATUS.draft;
}
