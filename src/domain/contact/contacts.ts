import { ApiError, badRequest } from "../../lib/errors.ts";
import type { PlainObject } from "../../lib/object.ts";
import { pathParam } from "../../routes/context.ts";
import { modelFieldNames, responseObjectsSchema } from "../../routes/generic.ts";
import type { RouteContext, RouteDefinition, RouteResult } from "../../routes/types.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { clientFields, createDocument, updateDocument } from "../shared/documents.ts";
import { listDocuments } from "../shared/list.ts";
import {
  isReferenceIn,
  type ReferenceField,
  referencesTo,
  referencingModels,
  requireReferencedObjects,
} from "../shared/references.ts";
import { refId } from "../shared/refs.ts";
import { missingParameters, normalizeRefs } from "../shared/validation.ts";
import { contactFilters, customerNumberSort, isPerson } from "./contactFilters.ts";
import { isCustomerNumberAvailable, issueCustomerNumber, peekFreeCustomerNumber } from "./customerNumber.ts";
import { requireFields, textValue } from "./validation.ts";

const CONTACT_REFS = { category: "Category", parent: "Contact" } as const;

/** Parts of a contact that are deleted with it. */
const CASCADED_PARTS: readonly ReferenceField[] = [
  { model: "ContactAddress", field: "contact" },
  { model: "CommunicationWay", field: "contact" },
  { model: "ContactCustomField", field: "contact" },
  { model: "AccountingContact", field: "contact" },
  { model: "TagRelation", field: "object" },
];

/** Persons of an organisation; they stay and lose their parent. */
const PERSONS: readonly ReferenceField[] = [{ model: "Contact", field: "parent" }];

/** A contact needs an organisation name or a person name. */
function assertHasName(data: PlainObject): void {
  const named = ["name", "surename", "familyname"].some((field) => textValue(data[field]) !== undefined);
  // Assumption: sevDesk rejects a contact without any name; its exact message is unverified.
  if (!named) throw missingParameters(["name or surename or familyname"]);
}

/** The parent must exist, be an organisation and not be the contact itself. */
function assertValidParent(tenant: Tenant, data: PlainObject, selfId: string | undefined): void {
  const parentId = refId(data.parent);
  if (parentId === undefined) return;
  if (parentId === selfId) throw badRequest("A contact cannot be its own parent.");
  const parent = tenant.store.collection("Contact").require(parentId);
  if (isPerson(parent)) throw badRequest("The parent of a contact must be an organisation.");
}

/** Creates a contact with sevDesk semantics (also usable by seeds and other modules). */
export function createContactDocument(tenant: Tenant, input: PlainObject): Doc {
  const data = normalizeRefs(clientFields(input), CONTACT_REFS);
  requireFields(data, ["category"]);
  requireReferencedObjects(tenant, data, { category: "Category" });
  assertHasName(data);
  assertValidParent(tenant, data, undefined);
  // sevDesk accepts a customer number that is already in use (observed by a consuming
  // integration: guest orders all carry the same number). Only generated numbers skip used ones.
  const given = textValue(data.customerNumber);
  return createDocument(tenant, "Contact", data, {
    // Assumption: a new contact without status is a lead (100).
    defaults: { status: 100 },
    overrides: { customerNumber: given ?? issueCustomerNumber(tenant) },
  });
}

/** Updates a contact; the merged result must still be a valid contact. */
function updateContactDocument(tenant: Tenant, id: string, input: PlainObject): Doc {
  const existing = tenant.store.collection("Contact").require(id);
  const data = normalizeRefs(clientFields(input), CONTACT_REFS);
  if (data.category === null) throw missingParameters(["category"]);
  requireReferencedObjects(tenant, data, { category: "Category" });
  const merged = { ...existing, ...data };
  assertHasName(merged);
  assertValidParent(tenant, data, id);
  if ("customerNumber" in data) {
    data.customerNumber = textValue(data.customerNumber) ?? null;
  }
  return updateDocument(tenant, "Contact", id, data);
}

/**
 * Deletes a contact and what hangs on it: addresses, communication ways, custom field
 * values, the accounting contact and tag assignments. Persons of a deleted organisation
 * lose their parent. Any other reference (invoices, credit notes, orders, vouchers,
 * parts, ...) makes the contact undeletable: HTTP 409 (the spec declares 409 for this
 * DELETE), so no stored object is left pointing to a missing contact.
 * Assumption: sevDesk refuses instead of cascading; the wording is not verified.
 */
export function deleteContactCascade(tenant: Tenant, id: string): void {
  const { store } = tenant;
  store.collection("Contact").require(id);
  const references = referencesTo(tenant, "Contact", id);
  const blocking = references.filter(
    (ref) => !isReferenceIn(ref, CASCADED_PARTS) && !isReferenceIn(ref, PERSONS),
  );
  if (blocking.length > 0) {
    throw new ApiError(
      409,
      `The contact is still referenced by ${referencingModels(blocking)} and can not be deleted`,
    );
  }
  for (const reference of references) {
    if (isReferenceIn(reference, PERSONS))
      store.collection(reference.model).update(reference.doc.id, { parent: null });
    else store.collection(reference.model).delete(reference.doc.id);
  }
  store.collection("Contact").delete(id);
}

function listContacts(context: RouteContext): RouteResult {
  const { tenant, query } = context;
  const all = tenant.store.collection("Contact").all();
  // Live-verified: only depth=1 returns persons next to organisations.
  const docs = String(query.depth) === "1" ? all : all.filter((contact) => !isPerson(contact));
  return listDocuments(docs, query, {
    filters: contactFilters(tenant),
    fields: modelFieldNames(context.spec, responseObjectsSchema(context)),
    sort: customerNumberSort(query.orderByCustomerNumber),
    store: tenant.store,
  });
}

/** Number of documents of a collection that reference the contact in the given field. */
function countReferences(tenant: Tenant, collection: string, field: string, contactId: string): number {
  return tenant.store.collection(collection).find((doc) => refId(doc[field]) === contactId).length;
}

function tabsItemCount(context: RouteContext): RouteResult {
  const { tenant } = context;
  const contactId = pathParam(context, "contactId");
  tenant.store.collection("Contact").require(contactId);
  const count = (collection: string, field = "contact") =>
    countReferences(tenant, collection, field, contactId);
  const invoiceIds = new Set(
    tenant.store
      .collection("Invoice")
      .find((invoice) => refId(invoice.contact) === contactId)
      .map((invoice) => invoice.id),
  );
  return {
    objects: {
      orders: count("Order"),
      invoices: invoiceIds.size,
      creditNotes: count("CreditNote"),
      // Assumption: "documents" counts uploaded files, which DoppelDesk models as "Document".
      documents: count("Document"),
      persons: count("Contact", "parent"),
      vouchers: count("Voucher", "supplier"),
      letters: count("Letter"),
      parts: count("Part", "supplier"),
      invoicePos: tenant.store
        .collection("InvoicePos")
        .find((position) => invoiceIds.has(refId(position.invoice) ?? "")).length,
    },
  };
}

function findByCustomFieldValue(context: RouteContext): RouteResult {
  const { tenant, query } = context;
  const value = textValue(query.value);
  if (value === undefined) throw missingParameters(["value"]);
  const settingRef = query.customFieldSetting;
  const settingId = refId(settingRef);
  const name = textValue(query.customFieldName);
  if (settingId === undefined && name === undefined) {
    throw missingParameters(["customFieldName"]);
  }
  const settingIds = new Set(
    tenant.store
      .collection("ContactCustomFieldSetting")
      .find((setting) => (settingId === undefined ? setting.name === name : setting.id === settingId))
      .map((setting) => setting.id),
  );
  const contactIds = new Set(
    tenant.store
      .collection("ContactCustomField")
      .find((field) => settingIds.has(refId(field.contactCustomFieldSetting) ?? "") && field.value === value)
      .map((field) => refId(field.contact)),
  );
  return { objects: tenant.store.collection("Contact").find((contact) => contactIds.has(contact.id)) };
}

export const contactRoutes: readonly RouteDefinition[] = [
  { method: "GET", path: "/Contact", handler: listContacts },
  {
    method: "POST",
    path: "/Contact",
    handler: (context) => ({ objects: createContactDocument(context.tenant, context.input) }),
  },
  {
    method: "PUT",
    path: "/Contact/{contactId}",
    handler: (context) => ({
      objects: updateContactDocument(context.tenant, pathParam(context, "contactId"), context.input),
    }),
  },
  {
    method: "DELETE",
    path: "/Contact/{contactId}",
    handler: (context) => {
      deleteContactCascade(context.tenant, pathParam(context, "contactId"));
      return { objects: [null] };
    },
  },
  {
    method: "GET",
    path: "/Contact/Factory/getNextCustomerNumber",
    handler: (context) => ({ objects: peekFreeCustomerNumber(context.tenant) }),
  },
  {
    method: "GET",
    path: "/Contact/Mapper/checkCustomerNumberAvailability",
    handler: (context) => ({
      objects: isCustomerNumberAvailable(context.tenant, textValue(context.query.customerNumber) ?? ""),
    }),
  },
  { method: "GET", path: "/Contact/Factory/findContactsByCustomFieldValue", handler: findByCustomFieldValue },
  { method: "GET", path: "/Contact/{contactId}/getTabsItemCount", handler: tabsItemCount },
];
