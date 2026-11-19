import { parseBoolean, parseNumber } from "../lib/coerce.ts";
import { isPlainObject, type PlainObject } from "../lib/object.ts";
import { routeKey } from "../lib/routePath.ts";
import { parseDateInput, toIso, toIsoDate } from "../lib/time.ts";
import type { SpecIndex } from "../spec/specIndex.ts";
import type { Schema } from "../spec/types.ts";
import { objectsSchema, schemaRef } from "./envelope.ts";

const ISO_DATE_TIME_EXAMPLE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)$/;

/**
 * Shapes a value according to a response schema: coerces primitives to the declared
 * type, renders date-time fields as ISO 8601 in Europe/Berlin, fills missing declared
 * properties with null and keeps stored extra fields (document store semantics).
 */
export function shapeValue(spec: SpecIndex, value: unknown, schema: Schema | undefined): unknown {
  if (value === undefined) return null;
  const resolved = effectiveSchema(spec, schema, value);
  if (resolved === undefined || value === null) return value;
  switch (schemaType(resolved)) {
    case "string":
      return toStringValue(value, resolved);
    case "number":
    case "integer":
      return toNumberValue(value);
    case "boolean":
      return toBooleanValue(value);
    case "array":
      return Array.isArray(value) ? value.map((item) => shapeValue(spec, item, resolved.items)) : value;
    case "object": {
      if (!isPlainObject(value)) return value;
      const embedded = embeddedModelSchema(spec, resolved, value);
      return embedded === undefined
        ? shapeObject(spec, value, resolved.properties ?? {})
        : shapeValue(spec, value, embedded);
    }
    default:
      return value;
  }
}

/**
 * Shapes the "objects" payload of a response. A single object is wrapped into an
 * array when the schema is an array; an array is shaped element-wise when the
 * schema describes a single element. Without schema the value passes unchanged.
 */
export function shapeObjects(spec: SpecIndex, value: unknown, schema: Schema | undefined): unknown {
  const resolved = spec.resolve(schema);
  if (resolved === undefined) return value ?? null;
  const isArray = schemaType(resolved) === "array";
  if (isArray && value !== null && value !== undefined && !Array.isArray(value)) {
    return shapeValue(spec, [value], resolved);
  }
  if (!isArray && Array.isArray(value) && schemaType(resolved) === "object") {
    return value.map((item) => shapeValue(spec, item, resolved));
  }
  return shapeValue(spec, value, resolved);
}

/** Declared or implied type of a schema ("object" when it has properties, "array" when it has items). */
export function schemaType(schema: Schema): string | undefined {
  if (schema.type !== undefined) return schema.type;
  if (schema.properties !== undefined) return "object";
  if (schema.items !== undefined) return "array";
  return undefined;
}

/**
 * Resolves $ref, merges allOf into one object schema and picks the oneOf/anyOf
 * variant matching the value. Exported for the sample generator and domain helpers.
 */
export function effectiveSchema(
  spec: SpecIndex,
  schema: Schema | undefined,
  value?: unknown,
): Schema | undefined {
  const resolved = spec.resolve(schema);
  if (resolved === undefined) return undefined;
  if (resolved.allOf !== undefined) return mergeAllOf(spec, resolved);
  const variants = resolved.oneOf ?? resolved.anyOf;
  if (variants !== undefined) {
    const candidates = variants.map((variant) => effectiveSchema(spec, variant, value));
    return (
      candidates.find((candidate) => candidate !== undefined && matchesKind(candidate, value)) ??
      candidates[0]
    );
  }
  return resolved;
}

const PROPERTY_NAME_DEPTH = 8;

/**
 * Names of all properties a schema can declare: $ref, allOf, every oneOf/anyOf variant and
 * array items are followed. Empty when the schema is missing or declares no properties.
 */
export function schemaPropertyNames(spec: SpecIndex, schema: Schema | undefined): Set<string> {
  const names = new Set<string>();
  const visit = (current: Schema | undefined, depth: number): void => {
    const resolved = spec.resolve(current);
    if (resolved === undefined || depth > PROPERTY_NAME_DEPTH) return;
    for (const name of Object.keys(resolved.properties ?? {})) names.add(name);
    for (const part of [...(resolved.allOf ?? []), ...(resolved.oneOf ?? []), ...(resolved.anyOf ?? [])]) {
      visit(part, depth + 1);
    }
    if (resolved.items !== undefined) visit(resolved.items, depth + 1);
  };
  visit(schema, 0);
  return names;
}

function mergeAllOf(spec: SpecIndex, schema: Schema): Schema {
  const properties: Record<string, Schema> = {};
  for (const part of schema.allOf ?? []) {
    const resolved = effectiveSchema(spec, part);
    Object.assign(properties, resolved?.properties ?? {});
  }
  Object.assign(properties, schema.properties ?? {});
  return { type: "object", properties };
}

function matchesKind(schema: Schema, value: unknown): boolean {
  const type = schemaType(schema);
  if (value === undefined || value === null || type === undefined) return true;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  if (type === "integer" || type === "number") return typeof value === "number";
  return typeof value === type;
}

const REFERENCE_KEYS: ReadonlySet<string> = new Set(["id", "objectName"]);

/**
 * Schema for a document embedded into a reference field (embed=contact): the schema
 * declares only {id, objectName}, but the value carries more fields. Such a value is
 * shaped like the model itself (GET /<Model>/{id}, else Model_<Model>Response or
 * Model_<Model>), so an object has the same shape embedded and standalone.
 */
function embeddedModelSchema(spec: SpecIndex, schema: Schema, value: PlainObject): Schema | undefined {
  const declared = Object.keys(schema.properties ?? {});
  const isReference =
    declared.length === REFERENCE_KEYS.size && declared.every((key) => REFERENCE_KEYS.has(key));
  if (!isReference || typeof value.objectName !== "string") return undefined;
  if (Object.keys(value).every((key) => REFERENCE_KEYS.has(key))) return undefined;
  return modelSchema(spec, value.objectName);
}

/** Single-object response schema of a model, undefined when the spec has none. */
function modelSchema(spec: SpecIndex, model: string): Schema | undefined {
  const getOne = spec.operation(routeKey("GET", `/${model}/{id}`));
  const objects = getOne === undefined ? undefined : objectsSchema(spec, getOne.responseSchema);
  const resolved = spec.resolve(objects);
  if (resolved !== undefined) return schemaType(resolved) === "array" ? resolved.items : objects;
  const name = [`Model_${model}Response`, `Model_${model}`].find((candidate) => spec.schema(candidate));
  return name === undefined ? undefined : schemaRef(name);
}

/**
 * Declared properties are shaped (missing ones become null); stored fields the schema does
 * not declare stay, shaped by the model's own schema when the object names its model
 * (objectName), so a field has the same type in every response (e.g. "balance" of a check
 * account in the clearingAccount factory response and in GET /CheckAccount/{id}).
 */
function shapeObject(spec: SpecIndex, value: PlainObject, properties: Record<string, Schema>): PlainObject {
  const result: PlainObject = {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    result[key] = key in value ? shapeValue(spec, value[key], propertySchema) : null;
  }
  let modelProperties: Record<string, Schema> | undefined;
  for (const [key, extra] of Object.entries(value)) {
    if (key in properties) continue;
    modelProperties ??= ownModelProperties(spec, value);
    const schema = modelProperties[key];
    result[key] = schema === undefined ? (extra ?? null) : shapeValue(spec, extra, schema);
  }
  return result;
}

/** Properties of the model schema an object names in "objectName" ({} when there is none). */
function ownModelProperties(spec: SpecIndex, value: PlainObject): Record<string, Schema> {
  if (typeof value.objectName !== "string") return {};
  return effectiveSchema(spec, modelSchema(spec, value.objectName))?.properties ?? {};
}

/** True when the schema describes a date-time: format date-time or an ISO date-time example. */
export function isDateTimeSchema(schema: Schema): boolean {
  if (schema.format === "date-time") return true;
  return (
    schema.format === undefined &&
    typeof schema.example === "string" &&
    ISO_DATE_TIME_EXAMPLE.test(schema.example)
  );
}

function toStringValue(value: unknown, schema: Schema): unknown {
  if (isDateTimeSchema(schema)) {
    const parsed = parseDateInput(value);
    if (parsed !== undefined) return toIso(parsed);
  } else if (schema.format === "date") {
    const parsed = parseDateInput(value);
    if (parsed !== undefined) return toIsoDate(parsed);
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return value;
}

function toNumberValue(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  return parseNumber(value) ?? value;
}

function toBooleanValue(value: unknown): unknown {
  return parseBoolean(value) ?? value;
}
