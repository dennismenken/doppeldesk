import { isPlainObject } from "../../lib/object.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { TAG_RELATION } from "./documents.ts";
import type { FieldFilter } from "./list.ts";
import { isRefTo, refId } from "./refs.ts";

/**
 * Filter for "tags[0][id]=<id>&tags[0][objectName]=Tag" on lists: keeps documents of the
 * model that carry the given tags through TagRelation. "all" requires every listed tag,
 * "any" at least one (sevDesk documents neither, see docs/annahmen.md). Without tag ids
 * the filter keeps everything.
 */
export function tagsFilter(tenant: Tenant, objectName: string, match: "all" | "any"): FieldFilter {
  return (doc, value) => {
    const entries = Array.isArray(value) ? value : isPlainObject(value) ? Object.values(value) : [value];
    const wanted = entries.flatMap((entry) => refId(entry) ?? []);
    if (wanted.length === 0) return true;
    const attached = new Set(
      tenant.store
        .collection(TAG_RELATION)
        .find((relation) => isRefTo(relation.object, objectName, doc.id))
        .flatMap((relation) => refId(relation.tag) ?? []),
    );
    return match === "all" ? wanted.every((id) => attached.has(id)) : wanted.some((id) => attached.has(id));
  };
}
