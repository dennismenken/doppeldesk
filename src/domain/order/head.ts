import { ApiError } from "../../lib/errors.ts";
import { isPlainObject, type PlainObject } from "../../lib/object.ts";
import { parseDateInput, startOfBerlinDay, toIso } from "../../lib/time.ts";
import type { SpecIndex } from "../../spec/specIndex.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { isTrue } from "../shared/list.ts";
import { toNumber } from "../shared/money.ts";
import { DOCUMENT_HEAD_REFERENCES, requireReferencedObjects } from "../shared/references.ts";
import { type Ref, readRef } from "../shared/refs.ts";
import { SEND_TYPES } from "../shared/sending.ts";
import {
  invalidParameter,
  isBlank,
  isOneOf,
  missingParameters,
  normalizeRefs,
  requireRef,
} from "../shared/validation.ts";
import { isOrderType, ORDER_STATUS, ORDER_STATUS_CODES, ORDER_TYPES } from "./constants.ts";

/** Reference fields of the order head and the model they point to. */
const HEAD_REFS = {
  contact: "Contact",
  contactPerson: "SevUser",
  createUser: "SevUser",
  addressCountry: "StaticCountry",
  taxRule: "TaxRule",
  taxSet: "TaxSet",
} as const;

/** Fields the server computes or assigns; client input for them is ignored on update. */
export const COMPUTED_HEAD_FIELDS: readonly string[] = [
  "sumNet",
  "sumTax",
  "sumGross",
  "sumDiscounts",
  "sumNetForeignCurrency",
  "sumTaxForeignCurrency",
  "sumGrossForeignCurrency",
  "sumDiscountsForeignCurrency",
];

/**
 * Required head fields that the server fills in itself (the number comes from the number
 * range) or that are covered by an alternative: taxRule replaces taxType in sevDesk
 * Update 2.0, and the other way around in 1.0, so one of both suffices.
 */
const SERVER_FILLED_FIELDS: ReadonlySet<string> = new Set(["orderNumber", "mapAll", "objectName"]);
const TAX_REGULATION_FIELDS = ["taxRule", "taxType"] as const;

/** Names of the required head fields according to the spec (Model_Order.required). */
export function requiredHeadFields(spec: SpecIndex): string[] {
  return (spec.schema("Model_Order")?.required ?? []).filter(
    (name) => !SERVER_FILLED_FIELDS.has(name) && !(TAX_REGULATION_FIELDS as readonly string[]).includes(name),
  );
}

/**
 * Normalizes request fields of the order head: references to {id, objectName}, dates to ISO
 * 8601 (order date at Berlin midnight), numbers and booleans to their types. Only fields that
 * are present are touched. Throws a 400/422 for malformed values.
 */
export function normalizeHead(fields: PlainObject): PlainObject {
  const result = normalizeRefs(fields, HEAD_REFS);
  if (!isBlank(fields.origin)) {
    result.origin = isPlainObject(fields.origin)
      ? requireRef("origin", fields.origin, stringOrUndefined(fields.typeOrigin))
      : requireRef("origin", { id: fields.origin, objectName: fields.typeOrigin });
  }
  if (!isBlank(fields.orderDate)) result.orderDate = toDateField("orderDate", fields.orderDate, true);
  if ("sendDate" in fields) {
    result.sendDate = isBlank(fields.sendDate) ? null : toDateField("sendDate", fields.sendDate, false);
  }
  for (const key of ["status", "version", "taxRate"]) {
    if (isBlank(fields[key])) continue;
    const parsed = toNumber(fields[key], Number.NaN);
    if (Number.isNaN(parsed)) throw invalidParameter(`order.${key}`, { status: 422 });
    result[key] = parsed;
  }
  for (const key of ["showNet", "smallSettlement"]) {
    if (!isBlank(fields[key])) result[key] = isTrue(fields[key]);
  }
  return result;
}

/**
 * Validates the effective head (stored fields merged with the request "changed"). A create
 * demands the spec's required fields, an update must not clear one of them (both 422, like
 * the factory); the value checks always apply to the fields present.
 */
export function validateHead(
  spec: SpecIndex,
  tenant: Tenant,
  head: PlainObject,
  options: { creating: boolean; changed: PlainObject },
): void {
  const concerns = (name: string) => options.creating || name in options.changed;
  const missing = requiredHeadFields(spec).filter((name) => concerns(name) && isBlank(head[name]));
  if (TAX_REGULATION_FIELDS.some(concerns) && TAX_REGULATION_FIELDS.every((name) => isBlank(head[name]))) {
    missing.push("taxRule");
  }
  if (concerns("orderType") && isBlank(head.orderType)) missing.push("orderType");
  if (missing.length > 0) {
    throw missingParameters(
      missing.map((name) => `order.${name}`),
      422,
    );
  }
  if (!isBlank(head.orderType) && !isOrderType(head.orderType)) {
    throw invalidParameter("order.orderType", { allowed: ORDER_TYPES, status: 422 });
  }
  if (!isBlank(head.status) && !ORDER_STATUS_CODES.includes(Number(head.status))) {
    throw invalidParameter("order.status", { allowed: ORDER_STATUS_CODES, status: 422 });
  }
  if (!isBlank(head.sendType) && !isOneOf(SEND_TYPES, head.sendType)) {
    throw invalidParameter("order.sendType", { allowed: SEND_TYPES, status: 422 });
  }
  // Spec (tag "Order", attribute sendType): giving status 200 directly requires a send type.
  if (Number(head.status) === ORDER_STATUS.delivered && isBlank(head.sendType)) {
    throw missingParameters(["order.sendType"], 422);
  }
  requireReferencedObjects(tenant, options.changed, DOCUMENT_HEAD_REFERENCES);
}

/**
 * 409 for changes sevDesk only allows on draft orders: deleting the order or deleting and
 * changing its positions (spec: DELETE /OrderPos "Conflict - f.e occurs if the order is not
 * a draft"). Assumption: changing positions follows the same rule; the wording.
 */
export function assertDraftOrder(order: Doc, subject: string, action: "changed" | "deleted"): void {
  if (Number(order.status) !== ORDER_STATUS.draft) {
    throw new ApiError(409, `The ${subject} cannot be ${action} because the order is not a draft`);
  }
}

/** Reference to the user who created an order. Assumption: the contact person. */
export function creatorOf(head: PlainObject): Ref | undefined {
  return readRef(head.contactPerson, "SevUser");
}

function toDateField(key: string, value: unknown, dayOnly: boolean): string {
  const parsed = parseDateInput(value);
  if (parsed === undefined) throw invalidParameter(`order.${key}`, { status: 422 });
  // Assumption: the order date is a calendar day (live invoices render it at Berlin midnight).
  return toIso(dayOnly ? startOfBerlinDay(parsed) : parsed);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Adds the send date to a patch when the effective order is delivered (status 200) but has none. */
export function withSendDate(tenant: Tenant, effective: PlainObject, patch: PlainObject): PlainObject {
  if (Number(effective.status) !== ORDER_STATUS.delivered || !isBlank(effective.sendDate)) return patch;
  return { ...patch, sendDate: toIso(tenant.clock.now()) };
}
