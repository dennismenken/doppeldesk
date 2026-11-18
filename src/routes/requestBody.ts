import { SERVER_FIELDS } from "../domain/shared/documents.ts";
import { invalidParameter, isBlank, missingParameters } from "../domain/shared/validation.ts";
import { parseBoolean, parseNumber } from "../lib/coerce.ts";
import { isPlainObject } from "../lib/object.ts";
import { parseDateInput } from "../lib/time.ts";
import { effectiveSchema, schemaType } from "../serialize/serializer.ts";
import type { SpecIndex } from "../spec/specIndex.ts";
import type { Schema } from "../spec/types.ts";

/**
 * Checks the values of a request body against the operation's request schema and throws
 * ApiError 400 "Invalid value given for '<field>'" for the first value that cannot be read
 * as the declared type:
 * - string: anything but an object or array; "date" and "date-time" formats must be a
 *   readable date (unix seconds, Y-m-d, d.m.Y, ISO 8601);
 * - number and integer: a number, a decimal string or a boolean;
 * - boolean: true/false, 1/0 and their string forms.
 * Absent, null and empty-string values pass (requiredness is checked separately), as do
 * read-only fields and SERVER_FIELDS (the server ignores client values for them). Objects
 * and arrays are checked recursively; a value whose shape differs from the schema (e.g. a
 * plain id where the schema declares a reference) is left to the handler. Enums are not checked: the spec
 * enums are incomplete (e.g. tax rules), domain modules check the ones they rely on.
 *
 * "ignore" lists fields whose handler deliberately reads them differently from the spec type,
 * as dotted paths without array indexes ("invoice.deliveryDateUntil").
 */
export function assertBodyMatchesSchema(
  spec: SpecIndex,
  schema: Schema | undefined,
  body: unknown,
  ignore: readonly string[] = [],
): void {
  if (!isPlainObject(body)) return;
  checkObject(spec, schema, body, { name: "", path: "", ignore: new Set(ignore) });
}

/**
 * 400 "Missing required parameter(s): ..." for top-level fields the request schema lists as
 * required and the body leaves blank. SERVER_FIELDS, "mapAll" and read-only fields
 * are not demanded from the client.
 */
export function assertRequiredFields(spec: SpecIndex, schema: Schema | undefined, body: unknown): void {
  const resolved = effectiveSchema(spec, schema, body);
  if (resolved === undefined) return;
  const input = isPlainObject(body) ? body : {};
  const missing = (resolved.required ?? []).filter((field) => {
    if (SERVER_FIELDS.has(field) || field === "mapAll") return false;
    if (effectiveSchema(spec, resolved.properties?.[field])?.readOnly === true) return false;
    return isBlank(input[field]);
  });
  if (missing.length > 0) throw missingParameters(missing);
}

interface Location {
  /** Request notation for messages: "invoice[invoicePosSave][0][price]". */
  name: string;
  /** Dotted path without indexes for the ignore list: "invoicePosSave.price". */
  path: string;
  ignore: ReadonlySet<string>;
}

function child(location: Location, key: string | number): Location {
  const isIndex = typeof key === "number";
  return {
    name: location.name === "" ? String(key) : `${location.name}[${key}]`,
    path: isIndex ? location.path : location.path === "" ? key : `${location.path}.${key}`,
    ignore: location.ignore,
  };
}

function checkObject(
  spec: SpecIndex,
  schema: Schema | undefined,
  value: Record<string, unknown>,
  location: Location,
): void {
  const resolved = effectiveSchema(spec, schema, value);
  for (const [key, propertySchema] of Object.entries(resolved?.properties ?? {})) {
    if (!(key in value) || SERVER_FIELDS.has(key)) continue;
    checkValue(spec, propertySchema, value[key], child(location, key));
  }
}

function checkValue(spec: SpecIndex, schema: Schema | undefined, value: unknown, location: Location): void {
  if (value === undefined || value === null || value === "" || location.ignore.has(location.path)) return;
  const resolved = effectiveSchema(spec, schema, value);
  if (resolved === undefined || resolved.readOnly === true) return;
  switch (schemaType(resolved)) {
    case "object":
      if (isPlainObject(value)) checkObject(spec, resolved, value, location);
      return;
    case "array":
      if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
          checkValue(spec, resolved.items, item, child(location, index));
        }
      }
      return;
    case "string":
      if (!isReadableString(value, resolved)) throw invalidParameter(location.name);
      return;
    case "number":
    case "integer":
      if (typeof value !== "boolean" && parseNumber(value) === undefined)
        throw invalidParameter(location.name);
      return;
    case "boolean":
      if (parseBoolean(value) === undefined) throw invalidParameter(location.name);
      return;
  }
}

function isReadableString(value: unknown, schema: Schema): boolean {
  if (typeof value === "object") return false;
  if (schema.format === "date" || schema.format === "date-time") return parseDateInput(value) !== undefined;
  return true;
}
