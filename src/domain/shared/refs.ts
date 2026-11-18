import { isPlainObject } from "../../lib/object.ts";

/** sevDesk object reference as rendered in responses. */
export interface Ref {
  id: string;
  objectName: string;
}

/** Builds a reference {id: "<id>", objectName}. */
export function toRef(id: string | number, objectName: string): Ref {
  return { id: String(id), objectName };
}

/**
 * Reads a reference from request or stored data. Accepts {id, objectName} with numeric
 * or string id. When objectName is missing, "fallbackObjectName" is used if given.
 * Returns undefined for anything else.
 */
export function readRef(value: unknown, fallbackObjectName?: string): Ref | undefined {
  if (!isPlainObject(value)) return undefined;
  const { id, objectName } = value;
  if ((typeof id !== "string" && typeof id !== "number") || String(id) === "") return undefined;
  const name = typeof objectName === "string" && objectName !== "" ? objectName : fallbackObjectName;
  return name === undefined ? undefined : toRef(id, name);
}

/** Id of a reference object or of a plain id value (number/string); undefined otherwise. */
export function refId(value: unknown): string | undefined {
  if (typeof value === "number" || (typeof value === "string" && value !== "")) return String(value);
  if (isPlainObject(value) && (typeof value.id === "string" || typeof value.id === "number"))
    return String(value.id);
  return undefined;
}

/** True when the value references the given object (and id, if given). */
export function isRefTo(value: unknown, objectName: string, id?: string | number): boolean {
  const ref = readRef(value);
  return ref !== undefined && ref.objectName === objectName && (id === undefined || ref.id === String(id));
}
