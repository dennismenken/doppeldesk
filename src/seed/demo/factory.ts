import type { PlainObject } from "../../lib/object.ts";

/** Wraps fields as an entry of a factory request (saveInvoice, saveCreditNote, ...). */
export function factoryObject(objectName: string, fields: PlainObject): PlainObject {
  return { objectName, mapAll: true, ...fields };
}
