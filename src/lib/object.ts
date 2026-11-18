/** A plain JSON-like object (document, request body, query object). */
export type PlainObject = Record<string, unknown>;

/** True for non-null, non-array objects that are not Buffers or Dates. */
export function isPlainObject(value: unknown): value is PlainObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !Buffer.isBuffer(value) &&
    !(value instanceof Date)
  );
}

/** Deep copy of JSON-compatible data. */
export function deepClone<T>(value: T): T {
  return structuredClone(value);
}
