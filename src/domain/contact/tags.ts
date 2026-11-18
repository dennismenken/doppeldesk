import { badRequest, notFound } from "../../lib/errors.ts";
import { isPlainObject } from "../../lib/object.ts";
import { pathParam } from "../../routes/context.ts";
import type { RouteDefinition } from "../../routes/types.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { createDocument, updateDocument } from "../shared/documents.ts";
import { refId, toRef } from "../shared/refs.ts";
import { invalidParameter, missingParameters } from "../shared/validation.ts";
import { requireFields, textValue } from "./validation.ts";

/** Models a tag can be attached to (enum of Tag/Factory/create in the spec). */
const TAGGABLE = ["Invoice", "Voucher", "Order", "CreditNote"] as const;

function assertUniqueName(tenant: Tenant, name: string, exceptId?: string): void {
  const clash = tenant.store.collection("Tag").findOne((tag) => tag.name === name && tag.id !== exceptId);
  // Assumption: tag names are unique per client (Tag/Factory/create reuses a tag with the same name).
  if (clash !== undefined) throw badRequest(`A tag with the name '${name}' already exists.`);
}

export const tagRoutes: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/Tag/Factory/create",
    handler: (context) => {
      const { tenant, input } = context;
      requireFields(input, ["object"]);
      const name = textValue(input.name);
      if (name === undefined) throw missingParameters(["name"]);
      const object = isPlainObject(input.object) ? input.object : {};
      const targetId = refId(object);
      const targetName = TAGGABLE.find((candidate) => candidate === object.objectName);
      if (targetId === undefined || targetName === undefined) {
        throw invalidParameter("object", { allowed: TAGGABLE });
      }
      tenant.store.collection(targetName).require(targetId);

      const tags = tenant.store.collection("Tag");
      const tag =
        tags.findOne((candidate) => candidate.name === name) ?? createDocument(tenant, "Tag", { name });
      const target = toRef(targetId, targetName);
      // Assumption: attaching the same tag twice returns the existing relation.
      const existing = tenant.store
        .collection("TagRelation")
        .findOne((relation) => refId(relation.tag) === tag.id && isSameObject(relation.object, target));
      const relation =
        existing ?? createDocument(tenant, "TagRelation", { tag: toRef(tag.id, "Tag"), object: target });
      return { objects: relation };
    },
  },
  {
    method: "PUT",
    path: "/Tag/{tagId}",
    handler: (context) => {
      const id = pathParam(context, "tagId");
      context.tenant.store.collection("Tag").require(id);
      requireFields(context.input, ["name"]);
      const name = textValue(context.input.name);
      if (name === undefined) throw missingParameters(["name"]);
      assertUniqueName(context.tenant, name, id);
      return { objects: updateDocument(context.tenant, "Tag", id, { name }) };
    },
  },
  {
    method: "DELETE",
    path: "/Tag/{tagId}",
    handler: (context) => {
      const id = pathParam(context, "tagId");
      const { store } = context.tenant;
      if (!store.collection("Tag").delete(id)) throw notFound("Tag", id);
      const relations = store.collection("TagRelation");
      for (const relation of relations.find((candidate) => refId(candidate.tag) === id)) {
        relations.delete(relation.id);
      }
      return { objects: [null] };
    },
  },
];

function isSameObject(stored: unknown, target: { id: string; objectName: string }): boolean {
  return isPlainObject(stored) && refId(stored) === target.id && stored.objectName === target.objectName;
}
