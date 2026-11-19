import { SERVER_FIELDS } from "../domain/shared/documents.ts";
import { isPlainObject, type PlainObject } from "../lib/object.ts";
import { isParamSegment, splitPath } from "../lib/routePath.ts";
import { objectsSchema } from "../serialize/envelope.ts";
import { schemaPropertyNames } from "../serialize/serializer.ts";
import type { SpecIndex } from "../spec/specIndex.ts";
import type { Schema, SpecOperation } from "../spec/types.ts";
import type { FactoryPart, RouteHandler } from "./types.ts";

/** "mapAll" is the sevDesk factory flag; it is no model property but handlers may read it. */
const REQUEST_FLAGS: ReadonlySet<string> = new Set(["mapAll"]);

/**
 * True for the create and update shapes of a model: "POST /{Model}" and "PUT /{Model}/{id}".
 * Actions and factories ("/Invoice/Factory/saveInvoice") read request fields that are no model
 * properties and are not filtered.
 */
function writesModel(operation: SpecOperation): boolean {
  const segments = splitPath(operation.path);
  if (operation.method === "POST") return segments.length === 1;
  if (operation.method === "PUT") return segments.length === 2 && isParamSegment(segments[1] ?? "");
  return false;
}

/**
 * Property names the model of a create or update operation knows: the union of the request
 * body schema and the response schema properties, plus server fields. Undefined when the
 * operation is no model write or the spec declares no request properties (no schema
 * information, the body is kept as sent).
 */
export function knownModelFields(spec: SpecIndex, operation: SpecOperation): ReadonlySet<string> | undefined {
  if (!writesModel(operation)) return undefined;
  return knownProperties(
    schemaPropertyNames(spec, operation.requestBodySchema),
    schemaPropertyNames(spec, objectsSchema(spec, operation.responseSchema)),
  );
}

/** Union of request and response properties plus server fields; undefined without request properties. */
function knownProperties(
  requestFields: ReadonlySet<string>,
  responseFields: ReadonlySet<string>,
): ReadonlySet<string> | undefined {
  if (requestFields.size === 0) return undefined;
  return new Set([...requestFields, ...responseFields, ...SERVER_FIELDS, ...REQUEST_FLAGS]);
}

/** Schema of a named property of a (possibly $ref'd) object schema. */
function propertySchema(
  spec: SpecIndex,
  schema: Schema | undefined,
  name: string | undefined,
): Schema | undefined {
  return name === undefined ? undefined : spec.resolve(schema)?.properties?.[name];
}

/**
 * Property names a factory body part knows: the properties of its request schema (the model
 * of the part, e.g. Model_Invoice) plus the properties of the matching response part, plus
 * server fields. Undefined when the spec declares no request properties for the part.
 */
function knownPartFields(
  spec: SpecIndex,
  operation: SpecOperation,
  part: FactoryPart,
): ReadonlySet<string> | undefined {
  const request = propertySchema(spec, operation.requestBodySchema, part.field);
  const response = propertySchema(spec, objectsSchema(spec, operation.responseSchema), part.responseField);
  const known = knownProperties(schemaPropertyNames(spec, request), schemaPropertyNames(spec, response));
  return known === undefined ? undefined : new Set([...known, ...(part.extraFields ?? [])]);
}

function onlyKnown(value: PlainObject, known: ReadonlySet<string>): PlainObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => known.has(key)));
}

/**
 * Wraps a create or update handler so that it sees only properties its model knows. Real
 * sevDesk maps known properties and silently ignores everything else, so unknown request
 * fields are neither stored nor returned. Handlers of other operations stay unchanged.
 */
export function withKnownFields(
  spec: SpecIndex,
  operation: SpecOperation,
  handler: RouteHandler,
): RouteHandler {
  const known = knownModelFields(spec, operation);
  if (known === undefined) return handler;
  return (context) =>
    handler({
      ...context,
      input: onlyKnown(context.input, known),
    });
}

/**
 * Wraps a factory handler so that the declared body parts (document header, positions,
 * discounts) keep only properties their model knows, like withKnownFields does for the top
 * level of model writes. A part is a single object or a list of objects; other values and
 * parts without schema information are passed on as sent.
 */
export function withKnownFactoryParts(
  spec: SpecIndex,
  operation: SpecOperation,
  handler: RouteHandler,
  parts: readonly FactoryPart[],
): RouteHandler {
  const known = parts.flatMap((part) => {
    const fields = knownPartFields(spec, operation, part);
    return fields === undefined ? [] : [{ field: part.field, fields }];
  });
  if (known.length === 0) return handler;
  const filter = (value: unknown, fields: ReadonlySet<string>): unknown => {
    if (Array.isArray(value)) return value.map((item) => filter(item, fields));
    return isPlainObject(value) ? onlyKnown(value, fields) : value;
  };
  return (context) => {
    const input: PlainObject = { ...context.input };
    for (const { field, fields } of known) {
      if (field in input) input[field] = filter(input[field], fields);
    }
    return handler({ ...context, input });
  };
}
