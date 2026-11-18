import type { Tenant } from "../../tenant/tenant.ts";
import { isBlank, validationError } from "./validation.ts";

/** Format of one number range. */
export interface NumberRangeConfig {
  prefix: string;
  start: number;
}

/**
 * The number ranges of a tenant: the one place for prefixes and start values.
 * Facts: "RE-" invoice and "GU-" credit note prefixes are live-observed by a consuming
 * app (the spec examples show "RE-1000"). Cancellation invoices (SR) and payment
 * reminders (MA) draw from the invoice range (help center: "next free number from your
 * invoice number range"; for MA an assumption). All other prefixes and all start values
 * are assumptions until verified against a real account.
 */
export const NUMBER_RANGES = {
  invoice: { prefix: "RE-", start: 1001 },
  creditNote: { prefix: "GU-", start: 1001 },
  /** Assumption: order types AN (offer), AB (order confirmation), LI (delivery note). */
  offer: { prefix: "AN-", start: 1001 },
  orderConfirmation: { prefix: "AB-", start: 1001 },
  deliveryNote: { prefix: "LI-", start: 1001 },
  /** Assumption: customer numbers follow the spec example "KD-1000". */
  customer: { prefix: "KD-", start: 1001 },
} as const satisfies Record<string, NumberRangeConfig>;

export type NumberRangeKey = keyof typeof NUMBER_RANGES;

/** Issues the next formatted number of a range, e.g. "RE-1001". */
export function nextNumber(tenant: Tenant, key: NumberRangeKey): string {
  const range = NUMBER_RANGES[key];
  return `${range.prefix}${tenant.numberRanges.next(key, range.start)}`;
}

/** Formatted number that nextNumber() would issue next, without issuing it. */
export function peekNumber(tenant: Tenant, key: NumberRangeKey): string {
  const range = NUMBER_RANGES[key];
  const last = tenant.numberRanges.last(key);
  return `${range.prefix}${last === undefined ? range.start : last + 1}`;
}

/**
 * Gives a formatted number back (e.g. when a numbered draft is deleted). The counter
 * rolls back only if it was the last issued number (live-verified for credit notes).
 */
export function releaseNumber(tenant: Tenant, key: NumberRangeKey, formatted: string): boolean {
  const range = NUMBER_RANGES[key];
  if (!formatted.startsWith(range.prefix)) return false;
  const digits = formatted.slice(range.prefix.length);
  if (!/^\d+$/.test(digits)) return false;
  return tenant.numberRanges.release(key, Number(digits), range.start);
}

/** Where a document type stores its number (e.g. Invoice.invoiceNumber), for uniqueness. */
export interface NumberedModel {
  model: string;
  field: string;
}

function usedNumbers(tenant: Tenant, numbered: NumberedModel, exceptId?: string): Set<string> {
  return new Set(
    tenant.store
      .collection(numbered.model)
      .find((doc) => doc.id !== exceptId && !isBlank(doc[numbered.field]))
      .map((doc) => String(doc[numbered.field])),
  );
}

/**
 * 422 when another document of the model already carries the number. Assumption: sevDesk
 * refuses duplicate document numbers; the wording is not verified.
 */
export function assertNumberAvailable(
  tenant: Tenant,
  numbered: NumberedModel,
  number: string,
  exceptId?: string,
): void {
  if (usedNumbers(tenant, numbered, exceptId).has(number)) {
    throw validationError(`The ${numbered.field} ${number} is already in use`);
  }
}

/** Issues the next number of the range that no document uses yet (manually assigned numbers are skipped). */
export function issueFreeNumber(tenant: Tenant, key: NumberRangeKey, numbered: NumberedModel): string {
  const used = usedNumbers(tenant, numbered);
  let candidate = nextNumber(tenant, key);
  while (used.has(candidate)) candidate = nextNumber(tenant, key);
  return candidate;
}

/** Number issueFreeNumber() would issue next, without issuing it. */
export function peekFreeNumber(tenant: Tenant, key: NumberRangeKey, numbered: NumberedModel): string {
  const { prefix, start } = NUMBER_RANGES[key];
  const used = usedNumbers(tenant, numbered);
  const last = tenant.numberRanges.last(key);
  let candidate = last === undefined ? start : last + 1;
  while (used.has(`${prefix}${candidate}`)) candidate += 1;
  return `${prefix}${candidate}`;
}

/** Number of a new document: the given one when it is still free (else 422), otherwise the next free one. */
export function assignNumber(
  tenant: Tenant,
  key: NumberRangeKey,
  numbered: NumberedModel,
  given: unknown,
): string {
  if (isBlank(given)) return issueFreeNumber(tenant, key, numbered);
  const number = String(given);
  assertNumberAvailable(tenant, numbered, number);
  return number;
}
