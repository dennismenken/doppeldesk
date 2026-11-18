import { deepClone } from "../lib/object.ts";
import { SpecIndex } from "../spec/specIndex.ts";
import type { Schema } from "../spec/types.ts";
import { effectiveSchema, isDateTimeSchema, schemaType } from "./serializer.ts";

const MAX_DEPTH = 8;

/** Id of sample objects and references, like the spec's reference examples ("0"). */
const SAMPLE_ID = "0";

/**
 * Deterministic sample value for a schema, used for action endpoints without
 * domain behavior. Precedence: example, default, first enum value, then fixed
 * type-based values (date-times use the given "now"). Arrays are empty unless an
 * example is given. Never random.
 * Objects with "id" and "objectName" (models and references) get the id "0" and as
 * objectName the model name: from the component schema name (Model_<Name>Response), for
 * the top level else the given model, for nested objects else the capitalized property
 * name ("contact" -> "Contact").
 */
export function sampleValue(
  spec: SpecIndex,
  schema: Schema | undefined,
  now: string,
  model?: string,
): unknown {
  return sample(spec, schema, now, 0, model);
}

function sample(
  spec: SpecIndex,
  schema: Schema | undefined,
  now: string,
  depth: number,
  name: string | undefined,
): unknown {
  const resolved = effectiveSchema(spec, schema);
  if (resolved === undefined || depth > MAX_DEPTH) return null;
  const explicit = explicitSample(resolved);
  if (explicit !== undefined) return explicit;
  switch (schemaType(resolved)) {
    case "object":
      return sampleObject(spec, resolved, now, depth, modelName(schema) ?? name);
    case "array":
      return [];
    case "string":
      return isDateTimeSchema(resolved) ? now : "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

function sampleObject(
  spec: SpecIndex,
  schema: Schema,
  now: string,
  depth: number,
  model: string | undefined,
): Record<string, unknown> {
  const properties = schema.properties ?? {};
  const isModel = "id" in properties && "objectName" in properties;
  const result: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    const identity = key === "id" ? SAMPLE_ID : key === "objectName" ? model : undefined;
    result[key] =
      isModel && identity !== undefined
        ? identitySample(spec, property, identity)
        : sample(spec, property, now, depth + 1, capitalize(key));
  }
  return result;
}

/** id or objectName of a sample model: the schema's own example wins, numbers stay numbers. */
function identitySample(spec: SpecIndex, schema: Schema, value: string): unknown {
  const resolved = effectiveSchema(spec, schema);
  if (resolved === undefined) return value;
  const explicit = explicitSample(resolved);
  if (explicit !== undefined) return explicit;
  const type = schemaType(resolved);
  return type === "integer" || type === "number" ? Number(value) || 0 : value;
}

/** Example, default or first enum value of a schema; undefined when it has none. */
function explicitSample(schema: Schema): unknown {
  if (schema.example !== undefined) return deepClone(schema.example);
  if (schema.default !== undefined) return deepClone(schema.default);
  if (schema.enum !== undefined && schema.enum.length > 0) return deepClone(schema.enum[0]);
  return undefined;
}

/** "Model_ContactResponse" -> "Contact"; undefined for inline schemas and other names. */
function modelName(schema: Schema | undefined): string | undefined {
  const match = /^Model_(.+?)(?:Response)?$/.exec(SpecIndex.refName(schema) ?? "");
  const name = match?.[1];
  return name === undefined ? undefined : capitalize(name);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
