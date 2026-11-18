import type { SpecIndex } from "../spec/specIndex.ts";
import type { Schema } from "../spec/types.ts";

/**
 * Schema of the "objects" payload of a success response. sevDesk always wraps
 * responses in {"objects": ...}, but the spec sometimes declares the bare payload;
 * both forms are normalized here.
 */
export function objectsSchema(spec: SpecIndex, responseSchema: Schema | undefined): Schema | undefined {
  const resolved = spec.resolve(responseSchema);
  if (resolved === undefined) return undefined;
  const objects = resolved.properties?.objects;
  if (objects !== undefined) return objects;
  return responseSchema;
}

/** Schema reference by component name, for routes that name their response schema explicitly. */
export function schemaRef(name: string): Schema {
  return { $ref: `#/components/schemas/${name}` };
}
