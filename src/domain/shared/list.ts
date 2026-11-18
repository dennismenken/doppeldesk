import { badRequest } from "../../lib/errors.ts";
import { isPlainObject, type PlainObject } from "../../lib/object.ts";
import type { Doc } from "../../store/collection.ts";
import type { DocumentStore } from "../../store/documentStore.ts";
import { readRef } from "./refs.ts";

/** Query keys that are never treated as field filters. */
export const RESERVED_QUERY_KEYS: ReadonlySet<string> = new Set([
  "limit",
  "offset",
  "countAll",
  "embed",
  "depth",
  "token",
  "orderBy",
]);

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 1000;

/**
 * Domain-specific filter for one top-level query key (qs-parsed, so "contact[id]=1"
 * arrives as key "contact" with value {id: "1"}). Return true to keep the document.
 */
export type FieldFilter = (doc: Doc, value: unknown, query: PlainObject) => boolean;

export interface ListOptions {
  /** Custom filters by query key; null ignores the key entirely (no generic filter). */
  filters?: Readonly<Record<string, FieldFilter | null>>;
  /** Known field names (e.g. from the response schema) that enable generic equality filters. */
  fields?: Iterable<string>;
  /** Sort comparator; default is ascending id. */
  sort?: (a: Doc, b: Doc) => number;
  /** Enables "embed" (refs replaced by full stored objects). */
  store?: DocumentStore;
}

/** Result shape handlers can return directly. */
export interface ListResult {
  objects: PlainObject[];
  total?: number;
}

/**
 * Filters, sorts, paginates and embeds a list like sevDesk:
 * - limit (1 to 1000, default 100; invalid -> 400), offset, countAll=true -> total,
 * - generic equality filters for query keys matching known or present top-level fields,
 *   comma-separated values mean IN, object values (contact[id]=..&contact[objectName]=..)
 *   match references,
 * - custom filters per key, reserved keys are ignored, embed=a,b expands references.
 */
export function listDocuments(
  docs: readonly Doc[],
  query: PlainObject,
  options: ListOptions = {},
): ListResult {
  const fields = new Set(options.fields ?? []);
  const filters = options.filters ?? {};
  const predicates: ((doc: Doc) => boolean)[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (RESERVED_QUERY_KEYS.has(key)) continue;
    const custom = filters[key];
    if (custom === null) continue;
    if (custom !== undefined) {
      predicates.push((doc) => custom(doc, value, query));
    } else if (fields.has(key) || docs.some((candidate) => key in candidate)) {
      predicates.push((doc) => matchesFieldFilter(doc[key], value));
    }
  }
  let matching = docs.filter((doc) => predicates.every((predicate) => predicate(doc)));
  if (options.sort !== undefined) matching = [...matching].sort(options.sort);
  const page = paginate(matching, query);
  const objects =
    options.store === undefined
      ? page.objects.map((doc) => ({ ...doc }))
      : embed(page.objects, query.embed, options.store);
  return { ...page, objects };
}

/**
 * The page of a complete, ordered list that limit and offset select, with "total" for
 * countAll=true. Lists that are no plain store collections (static guidance, related
 * documents) paginate through it like listDocuments; an invalid limit is the 400.
 */
export function paginate<T>(items: readonly T[], query: PlainObject): { objects: T[]; total?: number } {
  const { limit, offset } = readPagination(query);
  const objects = items.slice(offset, offset + limit);
  return isTrue(query.countAll) ? { objects, total: items.length } : { objects };
}

/** Reads limit/offset; throws 400 with the sevDesk message for an invalid limit. */
export function readPagination(query: PlainObject): { limit: number; offset: number } {
  let limit = DEFAULT_LIST_LIMIT;
  if (query.limit !== undefined && query.limit !== "") {
    const parsed = Number(query.limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIST_LIMIT) {
      throw badRequest(
        `Invalid 'limit' parameter. Please provide an integer value between 1 and ${MAX_LIST_LIMIT}.`,
      );
    }
    limit = parsed;
  }
  const offsetValue = Number(query.offset ?? 0);
  const offset = Number.isInteger(offsetValue) && offsetValue > 0 ? offsetValue : 0;
  return { limit, offset };
}

/**
 * Generic equality: scalar filters compare string forms (refs by id), comma-separated
 * or array values mean IN, object filters match every given sub key of a reference.
 * The objectName of a reference compares case-insensitively (the spec spells some
 * filters "creditNote[objectName]=creditNote" while references carry "CreditNote").
 * Empty filter values match everything.
 */
export function matchesFieldFilter(fieldValue: unknown, filter: unknown): boolean {
  if (isPlainObject(filter)) {
    if (!isPlainObject(fieldValue)) return Object.keys(filter).length === 0;
    return Object.entries(filter).every(([subKey, subFilter]) =>
      subKey === "objectName"
        ? matchesObjectName(fieldValue.objectName, subFilter)
        : matchesFieldFilter(fieldValue[subKey], subFilter),
    );
  }
  const accepted = filterValues(filter);
  if (accepted.length === 0) return true;
  const actual = comparable(isPlainObject(fieldValue) ? fieldValue.id : fieldValue);
  return actual !== undefined && accepted.includes(actual);
}

function matchesObjectName(actual: unknown, filter: unknown): boolean {
  const lower = (value: unknown) => (typeof value === "string" ? value.toLowerCase() : value);
  return matchesFieldFilter(lower(actual), Array.isArray(filter) ? filter.map(lower) : lower(filter));
}

/**
 * Replaces reference fields named in embed (comma-separated) with the full stored
 * objects; unknown names or dangling refs stay unchanged.
 */
export function embed(docs: readonly Doc[], embedParam: unknown, store: DocumentStore): PlainObject[] {
  const names = typeof embedParam === "string" ? embedParam.split(",").map((name) => name.trim()) : [];
  return docs.map((doc) => {
    const result: PlainObject = { ...doc };
    for (const name of names) {
      const ref = readRef(doc[name]);
      const target = ref === undefined ? undefined : store.collection(ref.objectName).get(ref.id);
      if (target !== undefined) result[name] = { ...target };
    }
    return result;
  });
}

/** True for "true", "1", true and 1. */
export function isTrue(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "1";
}

function filterValues(filter: unknown): string[] {
  const raw = Array.isArray(filter) ? filter : [filter];
  return raw
    .flatMap((item) => (typeof item === "string" ? item.split(",") : [item]))
    .map(comparable)
    .filter((item): item is string => item !== undefined && item !== "");
}

function comparable(value: unknown): string | undefined {
  if (value === true || value === "true") return "1";
  if (value === false || value === "false") return "0";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}
