import { badRequest } from "../../lib/errors.ts";
import type { PlainObject } from "../../lib/object.ts";
import { pathParam } from "../../routes/context.ts";
import type { RouteContext, RouteDefinition } from "../../routes/types.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { createDocument, updateDocument } from "../shared/documents.ts";
import { isTrue } from "../shared/list.ts";
import { requireReferencedObjects } from "../shared/references.ts";
import { refId } from "../shared/refs.ts";
import { invalidParameter, missingParameters, normalizeRefs } from "../shared/validation.ts";
import { requireFields } from "./validation.ts";

const COMMUNICATION_TYPES = ["EMAIL", "PHONE", "WEB", "MOBILE"] as const;

const ADDRESS_REFS = { contact: "Contact", country: "StaticCountry", category: "Category" } as const;
const COMMUNICATION_WAY_REFS = { contact: "Contact", key: "CommunicationWayKey" } as const;
const ACCOUNTING_CONTACT_REFS = { contact: "Contact" } as const;

/**
 * Normalizes the reference fields of a body, checks the required fields (400) and answers
 * 404 for a reference to a missing object (contact, country, category, communication way key).
 */
function referencedInput(
  tenant: Tenant,
  input: PlainObject,
  refs: Readonly<Record<string, string>>,
  required: readonly string[] = [],
): PlainObject {
  const data = normalizeRefs(input, refs);
  requireFields(data, required);
  requireReferencedObjects(tenant, data, refs);
  return data;
}

function communicationWayInput(tenant: Tenant, data: PlainObject, creating: boolean): PlainObject {
  const required = creating ? ["type", "value", "key", "contact"] : [];
  const result = referencedInput(tenant, data, COMMUNICATION_WAY_REFS, required);
  if (result.type !== undefined) {
    const type = typeof result.type === "string" ? result.type.toUpperCase() : undefined;
    if (!COMMUNICATION_TYPES.some((candidate) => candidate === type)) {
      throw invalidParameter("type", { allowed: COMMUNICATION_TYPES });
    }
    result.type = type;
  }
  if (result.main !== undefined) result.main = isTrue(result.main);
  return result;
}

/**
 * Assumption: at most one communication way per contact and type is the main one, so
 * flagging one as main clears the flag on the others (not verified against sevDesk).
 */
function demoteOtherMainWays(tenant: Tenant, saved: PlainObject & { id: string }): void {
  if (saved.main !== true) return;
  const ways = tenant.store.collection("CommunicationWay");
  const others = ways.find(
    (way) =>
      way.id !== saved.id &&
      way.main === true &&
      refId(way.contact) === refId(saved.contact) &&
      way.type === saved.type,
  );
  for (const way of others) ways.update(way.id, { main: false });
}

function saveCommunicationWay(context: RouteContext, id: string | undefined) {
  const { tenant } = context;
  const data = communicationWayInput(tenant, context.input, id === undefined);
  const saved =
    id === undefined
      ? createDocument(tenant, "CommunicationWay", data, { defaults: { main: false } })
      : updateDocument(tenant, "CommunicationWay", id, data);
  demoteOtherMainWays(tenant, saved);
  return { objects: saved };
}

export const addressRoutes: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/ContactAddress",
    handler: (context) => {
      const data = referencedInput(context.tenant, context.input, ADDRESS_REFS, [
        "contact",
        "country",
        "category",
      ]);
      return { objects: createDocument(context.tenant, "ContactAddress", data) };
    },
  },
  {
    method: "PUT",
    path: "/ContactAddress/{contactAddressId}",
    handler: (context) => {
      const data = referencedInput(context.tenant, context.input, ADDRESS_REFS);
      return {
        objects: updateDocument(
          context.tenant,
          "ContactAddress",
          pathParam(context, "contactAddressId"),
          data,
        ),
      };
    },
  },
];

export const communicationWayRoutes: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/CommunicationWay",
    handler: (context) => saveCommunicationWay(context, undefined),
  },
  {
    method: "PUT",
    path: "/CommunicationWay/{communicationWayId}",
    handler: (context) => saveCommunicationWay(context, pathParam(context, "communicationWayId")),
  },
];

/**
 * Assumption: a contact has at most one accounting contact (it carries the contact's debitor
 * and creditor numbers); a second one for the same contact is 400 (wording not verified).
 */
function assertSingleAccountingContact(tenant: Tenant, contact: unknown, selfId?: string): void {
  const contactId = refId(contact);
  if (contactId === undefined) return;
  const clash = tenant.store
    .collection("AccountingContact")
    .findOne((existing) => existing.id !== selfId && refId(existing.contact) === contactId);
  if (clash !== undefined) {
    throw badRequest(`The contact ${contactId} already has the accounting contact ${clash.id}`);
  }
}

export const accountingContactRoutes: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/AccountingContact",
    handler: (context) => {
      const data = referencedInput(context.tenant, context.input, ACCOUNTING_CONTACT_REFS, ["contact"]);
      assertSingleAccountingContact(context.tenant, data.contact);
      return { objects: createDocument(context.tenant, "AccountingContact", data) };
    },
  },
  {
    method: "PUT",
    path: "/AccountingContact/{accountingContactId}",
    handler: (context) => {
      const id = pathParam(context, "accountingContactId");
      context.tenant.store.collection("AccountingContact").require(id);
      const data = referencedInput(context.tenant, context.input, ACCOUNTING_CONTACT_REFS);
      if (data.contact === null) throw missingParameters(["contact"]);
      assertSingleAccountingContact(context.tenant, data.contact, id);
      return {
        objects: updateDocument(context.tenant, "AccountingContact", id, data),
      };
    },
  },
];
