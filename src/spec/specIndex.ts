import { isPlainObject } from "../lib/object.ts";
import { routeKey, toHttpMethod } from "../lib/routePath.ts";
import type { SpecPatchReport } from "./patches.ts";
import type { OpenApiDocument, Schema, SpecOperation, SpecParameter } from "./types.ts";

const SCHEMA_REF_PREFIX = "#/components/schemas/";

/**
 * Read-only view on a loaded OpenAPI document: $ref resolution, component schema
 * lookup and the flattened operation table.
 */
export class SpecIndex {
  readonly document: OpenApiDocument;
  readonly operations: readonly SpecOperation[];
  /** Spec corrections applied while loading (see patches.ts). */
  readonly patches: SpecPatchReport;
  readonly #byKey: Map<string, SpecOperation>;

  constructor(document: OpenApiDocument, patches: SpecPatchReport = { applied: [], skipped: [] }) {
    this.document = document;
    this.patches = patches;
    this.operations = buildOperations(document);
    this.#byKey = new Map(this.operations.map((operation) => [operation.key, operation]));
  }

  /** Component schema by name, e.g. "Model_InvoiceResponse". */
  schema(name: string): Schema | undefined {
    return this.document.components?.schemas?.[name];
  }

  /** Names of all component schemas. */
  schemaNames(): string[] {
    return Object.keys(this.document.components?.schemas ?? {});
  }

  /** Operation by route key (see routeKey()). */
  operation(key: string): SpecOperation | undefined {
    return this.#byKey.get(key);
  }

  /** Follows $ref chains until a concrete schema is reached (cycle-safe). */
  resolve(schema: Schema | undefined): Schema | undefined {
    let current = schema;
    const seen = new Set<string>();
    while (current?.$ref !== undefined) {
      const ref: string = current.$ref;
      if (seen.has(ref)) return undefined;
      seen.add(ref);
      current = this.#lookup(ref);
    }
    return current;
  }

  /** Name of the component schema a $ref points to, if any. */
  static refName(schema: Schema | undefined): string | undefined {
    const ref = schema?.$ref;
    return ref?.startsWith(SCHEMA_REF_PREFIX) ? ref.slice(SCHEMA_REF_PREFIX.length) : undefined;
  }

  #lookup(ref: string): Schema | undefined {
    if (!ref.startsWith("#/")) return undefined;
    let node: unknown = this.document;
    for (const part of ref.slice(2).split("/")) {
      if (!isPlainObject(node)) return undefined;
      node = node[part.replaceAll("~1", "/").replaceAll("~0", "~")];
    }
    return isPlainObject(node) ? (node as Schema) : undefined;
  }
}

function buildOperations(document: OpenApiDocument): SpecOperation[] {
  const operations: SpecOperation[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    const shared = parameters(item.parameters);
    for (const [methodName, raw] of Object.entries(item)) {
      const method = toHttpMethod(methodName);
      if (method === undefined || !isPlainObject(raw)) continue;
      const own = parameters(raw.parameters);
      const merged = [...shared.filter((p) => !own.some((o) => o.name === p.name && o.in === p.in)), ...own];
      const success = successResponse(raw.responses);
      operations.push({
        key: routeKey(method, path),
        method,
        path,
        operationId: optionalString(raw.operationId),
        tag: Array.isArray(raw.tags) ? optionalString(raw.tags[0]) : undefined,
        summary: optionalString(raw.summary),
        parameters: merged,
        requestBodySchema: jsonSchema(isPlainObject(raw.requestBody) ? raw.requestBody.content : undefined),
        successStatus: success.status,
        responseSchema: success.schema,
      });
    }
  }
  return operations;
}

function parameters(value: unknown): SpecParameter[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject).flatMap((param) => {
    const name = optionalString(param.name);
    const location = optionalString(param.in);
    if (name === undefined || location === undefined) return [];
    return [
      {
        name,
        in: location,
        required: param.required === true,
        schema: isPlainObject(param.schema) ? (param.schema as Schema) : undefined,
      },
    ];
  });
}

function successResponse(responses: unknown): { status: number; schema: Schema | undefined } {
  if (!isPlainObject(responses)) return { status: 200, schema: undefined };
  const code = Object.keys(responses)
    .filter((status) => /^2\d\d$/.test(status))
    .sort()[0];
  if (code === undefined) return { status: 200, schema: undefined };
  const response = responses[code];
  return {
    status: Number(code),
    schema: jsonSchema(isPlainObject(response) ? response.content : undefined),
  };
}

function jsonSchema(content: unknown): Schema | undefined {
  if (!isPlainObject(content)) return undefined;
  const media = content["application/json"] ?? Object.values(content)[0];
  return isPlainObject(media) && isPlainObject(media.schema) ? (media.schema as Schema) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
