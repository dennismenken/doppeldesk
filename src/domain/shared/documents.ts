import { notFound } from "../../lib/errors.ts";
import type { PlainObject } from "../../lib/object.ts";
import { toIso } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { isRefTo, toRef } from "./refs.ts";

/** Fields the server owns; client input for them is ignored on create and update. */
export const SERVER_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "objectName",
  "create",
  "update",
  "sevClient",
]);

/** Copy of the input without server-owned fields (and without the sevDesk "mapAll" flag). */
export function clientFields(input: PlainObject): PlainObject {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => !SERVER_FIELDS.has(key) && key !== "mapAll"),
  );
}

/**
 * Creates a document with the standard sevDesk stamps: id (sequential), objectName,
 * create/update (tenant clock, ISO Berlin) and sevClient ref. Server fields in "data"
 * are ignored; "defaults" are applied below the client data, "overrides" above it.
 */
export function createDocument(
  tenant: Tenant,
  model: string,
  data: PlainObject,
  options: { defaults?: PlainObject; overrides?: PlainObject } = {},
): Doc {
  const now = toIso(tenant.clock.now());
  return tenant.store.collection(model).insert({
    objectName: model,
    create: now,
    update: now,
    sevClient: toRef(tenant.sevClientId, "SevClient"),
    ...options.defaults,
    ...clientFields(data),
    ...options.overrides,
  });
}

/**
 * Shallow-merges client data into an existing document and stamps "update".
 * Throws ApiError 404 when the document does not exist.
 */
export function updateDocument(tenant: Tenant, model: string, id: string | number, data: PlainObject): Doc {
  const updated = tenant.store
    .collection(model)
    .update(id, { ...clientFields(data), update: toIso(tenant.clock.now()) });
  if (updated === undefined) throw notFound(model, id);
  return updated;
}

/**
 * Shallow-merges a server-side patch (status, sums, payment fields) into a document and
 * stamps "update"; unlike updateDocument it does not filter server-owned fields.
 * Throws ApiError 404 when the document does not exist.
 */
export function patchDocument(tenant: Tenant, model: string, id: string | number, patch: PlainObject): Doc {
  const updated = tenant.store.collection(model).update(id, { ...patch, update: toIso(tenant.clock.now()) });
  if (updated === undefined) throw notFound(model, id);
  return updated;
}

/** A collection whose documents belong to another document through a reference field. */
export interface DependentModel {
  model: string;
  /** Field referencing the owning document, e.g. "invoice" for InvoicePos, "object" for Discounts. */
  field: string;
}

/** Header discounts and surcharges (discountSave), referencing their document through "object". */
export const DISCOUNTS = "Discounts";
/** Tag assignments (Tag/Factory/create), referencing the tagged document through "object". */
export const TAG_RELATION = "TagRelation";

/**
 * Dependents every sevDesk document can have: header discounts (discountSave) and tag
 * relations (Tag/Factory/create) reference the document through "object".
 */
export const COMMON_DEPENDENTS: readonly DependentModel[] = [
  { model: DISCOUNTS, field: "object" },
  { model: TAG_RELATION, field: "object" },
];

/**
 * Deletes a document together with the documents that reference it (positions, discounts,
 * tag relations). Number ranges are the caller's business (see releaseNumber).
 */
export function deleteWithDependents(
  tenant: Tenant,
  model: string,
  id: string,
  dependents: readonly DependentModel[],
): void {
  for (const dependent of [...dependents, ...COMMON_DEPENDENTS]) {
    const collection = tenant.store.collection(dependent.model);
    for (const doc of collection.find((candidate) => isRefTo(candidate[dependent.field], model, id))) {
      collection.delete(doc.id);
    }
  }
  tenant.store.collection(model).delete(id);
}
