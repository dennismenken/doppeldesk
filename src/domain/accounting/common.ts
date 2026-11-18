import type { PlainObject } from "../../lib/object.ts";
import { parseDateInput, startOfBerlinDay, toIso } from "../../lib/time.ts";
import { type Ref, refId, toRef } from "../shared/refs.ts";
import { invalidParameter } from "../shared/validation.ts";

/** Copy of an object without the given keys. */
export function omitKeys(source: PlainObject, keys: ReadonlySet<string>): PlainObject {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.has(key)));
}

/**
 * Normalizes a date input (unix seconds, dd.mm.yyyy, ISO) to the Berlin calendar day as
 * ISO 8601. Empty values give null, unparseable values a 400.
 */
export function dateField(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseDateInput(value);
  if (parsed === undefined) throw invalidParameter(name);
  return toIso(startOfBerlinDay(parsed));
}

/** Reference to the given object type from a ref object or plain id; null when unusable. */
export function refField(value: unknown, objectName: string): Ref | null {
  const id = refId(value);
  return id === undefined ? null : toRef(id, objectName);
}
