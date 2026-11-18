import type { PlainObject } from "../../lib/object.ts";
import { blankFields, missingParameters } from "../shared/validation.ts";

/** Throws a 400 naming every required field that is missing (undefined, null or ""). */
export function requireFields(input: PlainObject, fields: readonly string[]): void {
  const missing = blankFields(input, fields);
  if (missing.length > 0) throw missingParameters(missing);
}

/** Non-empty trimmed string value of a field, or undefined. */
export function textValue(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
