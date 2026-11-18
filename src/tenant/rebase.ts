import { badRequest } from "../lib/errors.ts";
import { isPlainObject } from "../lib/object.ts";
import type { CollectionSnapshot } from "../store/collection.ts";
import type { TenantSnapshot } from "./tenant.ts";

const SEV_CLIENT = "SevClient";

/**
 * Moves a snapshot to another sevClient id (import into a tenant that has a different one):
 * the SevClient document and every reference {id, objectName: "SevClient"} to the snapshot's
 * sevClientId get the target id, so imported documents, newly created documents and
 * GET /SevClient agree. Throws ApiError 400 when the snapshot already holds a different
 * SevClient document with the target id.
 */
export function rebaseSnapshot(snapshot: TenantSnapshot, sevClientId: string): TenantSnapshot {
  const from = snapshot.sevClientId;
  if (from === sevClientId) return snapshot;
  const clients = snapshot.collections[SEV_CLIENT]?.docs ?? [];
  const ids = new Set(clients.map((doc) => String(doc.id)));
  if (ids.has(from) && ids.has(sevClientId)) {
    throw badRequest(
      `Snapshot has SevClient ${sevClientId} next to its own SevClient ${from}, it can not be moved to sevClient ${sevClientId}`,
    );
  }
  const collections: Record<string, CollectionSnapshot> = {};
  for (const [name, collection] of Object.entries(snapshot.collections)) {
    const docs = collection.docs.map((doc) => {
      const rebased = rebaseValue(doc, from, sevClientId);
      return isPlainObject(rebased) ? rebased : doc;
    });
    collections[name] =
      name === SEV_CLIENT
        ? {
            ...collection,
            docs: docs.map((doc) => (String(doc.id) === from ? { ...doc, id: sevClientId } : doc)),
          }
        : { ...collection, docs };
  }
  return { ...snapshot, sevClientId, collections };
}

/** Deep copy of a stored value with SevClient references to "from" pointing to "to". */
function rebaseValue(value: unknown, from: string, to: string): unknown {
  if (Array.isArray(value)) return value.map((item) => rebaseValue(item, from, to));
  if (!isPlainObject(value)) return value;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, rebaseValue(item, from, to)]),
  );
  const isOldClient =
    value.objectName === SEV_CLIENT &&
    (typeof value.id === "string" || typeof value.id === "number") &&
    String(value.id) === from;
  return isOldClient ? { ...result, id: to } : result;
}
