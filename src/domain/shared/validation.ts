import { ApiError, badRequest } from "../../lib/errors.ts";
import { isPlainObject, type PlainObject } from "../../lib/object.ts";
import { type Ref, readRef, toRef } from "./refs.ts";

/**
 * Error policy of all domain modules (one place, so modules answer alike):
 * - 400: the request is malformed (factory envelope, references, unparseable values,
 *   missing or invalid parameters of action endpoints such as sendBy or bookAmount);
 * - 422: a well-formed request breaks a business rule of a document (required document
 *   fields in factories, status transitions, enshrined documents, tax rules). sevDesk
 *   answers validation errors of Order, Invoice, Voucher and CreditNote with 422 since
 *   release 4.181 (API news 2024-04-08).
 * Live-verified wording: only the factory message (expectedRefError) and the 404 message.
 * All other texts are assumptions.
 */

/**
 * Type name of a request value as PHP 8 prints it ("null", "array", "int", "float",
 * "string", "bool"). Assumption: sevDesk uses get_debug_type(); the only attested example
 * is "array given", live PHP type errors of sevDesk read "null given".
 */
export function phpTypeName(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value) || isPlainObject(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "boolean") return "bool";
  return "string";
}

/**
 * 400 for a malformed factory part or reference. Live: "<key> expected array with 'id' and
 * 'objectName'" (factory head without objectName/mapAll); the ". <type> given" suffix is
 * attested by one third-party example.
 */
export function expectedRefError(key: string, value: unknown): ApiError {
  return badRequest(`${key} expected array with 'id' and 'objectName'. ${phpTypeName(value)} given`);
}

/** 422 for a business rule violation (see the error policy above). */
export function validationError(message: string): ApiError {
  return new ApiError(422, message);
}

/** Missing required parameters; 400 for action parameters, 422 for document fields. */
export function missingParameters(names: readonly string[], status: 400 | 422 = 400): ApiError {
  return new ApiError(status, `Missing required parameter(s): ${names.join(", ")}`);
}

/** An invalid parameter value, optionally with the allowed values (spec wording "Invalid value given"). */
export function invalidParameter(
  name: string,
  options: { allowed?: readonly unknown[]; status?: 400 | 422 } = {},
): ApiError {
  const allowed = options.allowed === undefined ? "" : `. Allowed values: ${options.allowed.join(", ")}`;
  return new ApiError(options.status ?? 400, `Invalid value given for '${name}'${allowed}`);
}

/** True when a request value counts as not provided. */
export function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** True when the value is one of the allowed literals. */
export function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return allowed.some((candidate) => candidate === value);
}

/** Names of the fields that are blank in the given object. */
export function blankFields(source: PlainObject, names: readonly string[]): string[] {
  return names.filter((name) => isBlank(source[name]));
}

/**
 * Normalizes list parameters of factories: absent gives [], an array stays, a single object
 * becomes a list of one, and form-encoded lists that qs delivers as objects with numeric
 * keys (more than 20 entries) become arrays in key order.
 */
export function listOf(value: unknown): unknown[] {
  if (isBlank(value)) return [];
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 0 && keys.every((key) => /^\d+$/.test(key))) {
      return keys.sort((a, b) => Number(a) - Number(b)).map((key) => value[key]);
    }
  }
  return [value];
}

/**
 * Reads a factory part ({..., objectName, mapAll}). It must be an object whose objectName is
 * "objectName" (or any non-empty name when omitted); otherwise the live 400 of the factory.
 */
export function factoryPart(key: string, value: unknown, objectName?: string): PlainObject {
  const name = isPlainObject(value) ? value.objectName : undefined;
  const valid = typeof name === "string" && name !== "" && (objectName === undefined || name === objectName);
  if (!isPlainObject(value) || !valid) throw expectedRefError(key, value);
  return value;
}

/** Reads a reference ({id, objectName}); the fallback objectName applies when the client omits it. */
export function requireRef(key: string, value: unknown, fallbackObjectName?: string): Ref {
  const ref = readRef(value, fallbackObjectName);
  if (ref === undefined) throw expectedRefError(key, value);
  return ref;
}

/**
 * Reads a reference to an object of the given model ({id, objectName}), e.g. the source of a
 * factory or a reference field such as invoice.contact. The objectName may be omitted and
 * compares case-insensitively (it is stored as the model name); a different model is the
 * factory 400 like any malformed reference, so a stored reference always names its model.
 */
export function requireRefTo(key: string, value: unknown, objectName: string): Ref {
  const ref = readRef(value, objectName);
  if (ref === undefined || ref.objectName.toLowerCase() !== objectName.toLowerCase()) {
    throw expectedRefError(key, value);
  }
  return toRef(ref.id, objectName);
}

/**
 * Ids of a delete list parameter (single {id, objectName} or a list of them) of the given
 * object. The objectName may be omitted; it compares case-insensitively.
 */
export function deletedIds(key: string, value: unknown, objectName: string): string[] {
  return listOf(value).map((item) => {
    const ref = readRef(item, objectName);
    if (ref === undefined || ref.objectName.toLowerCase() !== objectName.toLowerCase()) {
      throw expectedRefError(key, item);
    }
    return ref.id;
  });
}

/**
 * Copy of the fields where the named reference fields are normalized to {id, objectName}
 * (the map gives the model each field references). Blank values stay as they are; anything
 * that is no reference to that model is the factory 400 (see requireRefTo).
 */
export function normalizeRefs(fields: PlainObject, refFields: Readonly<Record<string, string>>): PlainObject {
  const result: PlainObject = { ...fields };
  for (const [key, objectName] of Object.entries(refFields)) {
    if (!isBlank(fields[key])) result[key] = requireRefTo(key, fields[key], objectName);
  }
  return result;
}
