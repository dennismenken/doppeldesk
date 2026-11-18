import type { PlainObject } from "../../lib/object.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { isRefTo, refId } from "./refs.ts";

/** A top-level field of a stored document that references another document. */
export interface Reference {
  model: string;
  doc: Doc;
  field: string;
}

/** A reference field of a model, e.g. {model: "ContactAddress", field: "contact"}. */
export interface ReferenceField {
  model: string;
  field: string;
}

/**
 * Every top-level reference ({id, objectName}) to the object in any collection of the
 * tenant. The store is schemaless, so this scan is how DoppelDesk keeps the object graph
 * resolvable when an object is deleted.
 */
export function referencesTo(tenant: Tenant, objectName: string, id: string): Reference[] {
  const references: Reference[] = [];
  for (const model of tenant.store.names()) {
    for (const doc of tenant.store.collection(model).all()) {
      if (model === objectName && doc.id === id) continue;
      for (const [field, value] of Object.entries(doc)) {
        if (isRefTo(value, objectName, id)) references.push({ model, doc, field });
      }
    }
  }
  return references;
}

/** True when the reference sits in one of the given model fields. */
export function isReferenceIn(reference: Reference, fields: readonly ReferenceField[]): boolean {
  return fields.some(
    (candidate) => candidate.model === reference.model && candidate.field === reference.field,
  );
}

/** Distinct model names of the references, sorted, for messages ("Invoice, Order"). */
export function referencingModels(references: readonly Reference[]): string {
  return [...new Set(references.map((reference) => reference.model))].sort().join(", ");
}

/**
 * Answers 404 "No Model_<Model> with the id <id> was found" for a reference field of the
 * data that points to a missing object; "fields" maps each field to the model it must
 * reference (e.g. {category: "Category"}). Blank fields are skipped.
 */
export function requireReferencedObjects(
  tenant: Tenant,
  data: PlainObject,
  fields: Readonly<Record<string, string>>,
): void {
  for (const [field, model] of Object.entries(fields)) {
    const id = refId(data[field]);
    if (id !== undefined) tenant.store.collection(model).require(id);
  }
}

/**
 * Reference fields of document heads (invoice, credit note, order) whose targets DoppelDesk
 * holds as data: a reference to a missing object answers 404 like an unknown id. Assumption:
 * taxSet, paymentMethod and costCentre are not checked, DoppelDesk serves no data for them.
 */
export const DOCUMENT_HEAD_REFERENCES: Readonly<Record<string, string>> = {
  contact: "Contact",
  contactPerson: "SevUser",
  addressCountry: "StaticCountry",
  taxRule: "TaxRule",
};
