import { badRequest } from "../../lib/errors.ts";
import { isPlainObject, type PlainObject } from "../../lib/object.ts";
import { pathParam } from "../../routes/context.ts";
import { getModel, listModel } from "../../routes/generic.ts";
import type { RouteContext, RouteDefinition, RouteResult } from "../../routes/types.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { createDocument, updateDocument } from "../shared/documents.ts";
import { readRef, refId } from "../shared/refs.ts";
import { missingParameters, normalizeRefs } from "../shared/validation.ts";
import { requireFields, textValue } from "./validation.ts";

const FIELD_REFS = { contact: "Contact", contactCustomFieldSetting: "ContactCustomFieldSetting" } as const;

/** The response schema embeds the full setting into every custom field value. */
function withSetting(tenant: Tenant, field: PlainObject): PlainObject {
  const ref = readRef(field.contactCustomFieldSetting, "ContactCustomFieldSetting");
  const setting = ref === undefined ? undefined : tenant.store.collection(ref.objectName).get(ref.id);
  return setting === undefined ? field : { ...field, contactCustomFieldSetting: { ...setting } };
}

function presented(tenant: Tenant, result: RouteResult): RouteResult {
  const objects = Array.isArray(result.objects)
    ? result.objects.map((item) => (isPlainObject(item) ? withSetting(tenant, item) : item))
    : isPlainObject(result.objects)
      ? withSetting(tenant, result.objects)
      : result.objects;
  return { ...result, objects };
}

/**
 * Validated body of a custom field value; "selfId" is the value being updated. Assumption: a
 * contact has at most one value per field setting, a second one is 400 (wording not verified).
 */
function fieldInput(tenant: Tenant, context: RouteContext, selfId?: string): PlainObject {
  const values = tenant.store.collection("ContactCustomField");
  const stored = selfId === undefined ? undefined : values.require(selfId);
  const data = normalizeRefs(context.input, FIELD_REFS);
  if (stored === undefined) requireFields(data, ["contact", "contactCustomFieldSetting", "value"]);
  const contactId = refId(data.contact);
  if (contactId !== undefined) tenant.store.collection("Contact").require(contactId);
  const settingId = refId(data.contactCustomFieldSetting);
  if (settingId !== undefined) tenant.store.collection("ContactCustomFieldSetting").require(settingId);
  if (data.value !== undefined && data.value !== null) data.value = String(data.value);
  const effective = { ...stored, ...data };
  const clash = values.findOne(
    (value) =>
      value.id !== selfId &&
      refId(value.contact) === refId(effective.contact) &&
      refId(value.contactCustomFieldSetting) === refId(effective.contactCustomFieldSetting),
  );
  if (clash !== undefined) {
    throw badRequest(`The contact already has a value for this field (ContactCustomField ${clash.id})`);
  }
  return data;
}

/** Number of custom field values that use the setting. */
function referenceCount(tenant: Tenant, settingId: string): number {
  return tenant.store
    .collection("ContactCustomField")
    .find((field) => refId(field.contactCustomFieldSetting) === settingId).length;
}

/**
 * Validated body of a field setting; "selfId" is the setting being updated. Assumption: setting
 * names are unique per client like tag names (400, wording not verified).
 */
function settingInput(tenant: Tenant, context: RouteContext, selfId?: string): PlainObject {
  const settings = tenant.store.collection("ContactCustomFieldSetting");
  if (selfId !== undefined) settings.require(selfId);
  const data = { ...context.input };
  if (selfId === undefined) requireFields(data, ["name"]);
  if (!("name" in data)) return data;
  const name = textValue(data.name);
  if (name === undefined) throw missingParameters(["name"]);
  const clash = settings.findOne((setting) => setting.id !== selfId && textValue(setting.name) === name);
  if (clash !== undefined) throw badRequest(`A contact field with the name '${name}' already exists.`);
  return data;
}

export const customFieldRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/ContactCustomField",
    handler: (context) => presented(context.tenant, listModel(context, "ContactCustomField")),
  },
  {
    method: "GET",
    path: "/ContactCustomField/{contactCustomFieldId}",
    handler: (context) =>
      presented(
        context.tenant,
        getModel(context, "ContactCustomField", pathParam(context, "contactCustomFieldId")),
      ),
  },
  {
    method: "POST",
    path: "/ContactCustomField",
    handler: (context) =>
      presented(context.tenant, {
        objects: createDocument(context.tenant, "ContactCustomField", fieldInput(context.tenant, context)),
      }),
  },
  {
    method: "PUT",
    path: "/ContactCustomField/{contactCustomFieldId}",
    handler: (context) =>
      presented(context.tenant, {
        objects: updateDocument(
          context.tenant,
          "ContactCustomField",
          pathParam(context, "contactCustomFieldId"),
          fieldInput(context.tenant, context, pathParam(context, "contactCustomFieldId")),
        ),
      }),
  },
  {
    method: "POST",
    path: "/ContactCustomFieldSetting",
    handler: (context) => ({
      objects: createDocument(
        context.tenant,
        "ContactCustomFieldSetting",
        settingInput(context.tenant, context),
      ),
    }),
  },
  {
    method: "PUT",
    path: "/ContactCustomFieldSetting/{contactCustomFieldSettingId}",
    handler: (context) => ({
      objects: updateDocument(
        context.tenant,
        "ContactCustomFieldSetting",
        pathParam(context, "contactCustomFieldSettingId"),
        settingInput(context.tenant, context, pathParam(context, "contactCustomFieldSettingId")),
      ),
    }),
  },
  {
    method: "DELETE",
    path: "/ContactCustomFieldSetting/{contactCustomFieldSettingId}",
    handler: (context) => {
      const id = pathParam(context, "contactCustomFieldSettingId");
      const { store } = context.tenant;
      store.collection("ContactCustomFieldSetting").require(id);
      store.collection("ContactCustomFieldSetting").delete(id);
      // Assumption: deleting a setting also removes the values stored for it (the reference
      // count endpoint exists so clients can warn first).
      const values = store.collection("ContactCustomField");
      for (const value of values.find((field) => refId(field.contactCustomFieldSetting) === id)) {
        values.delete(value.id);
      }
      return { objects: [null] };
    },
  },
  {
    method: "GET",
    path: "/ContactCustomFieldSetting/{contactCustomFieldSettingId}/getReferenceCount",
    handler: (context) => {
      const id = pathParam(context, "contactCustomFieldSettingId");
      context.tenant.store.collection("ContactCustomFieldSetting").require(id);
      return { objects: referenceCount(context.tenant, id) };
    },
  },
];
