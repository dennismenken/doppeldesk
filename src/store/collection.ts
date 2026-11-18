import { notFound } from "../lib/errors.ts";
import { deepClone, type PlainObject } from "../lib/object.ts";

/** A stored document. Treat as immutable; change it through the collection. */
export type Doc = Readonly<PlainObject> & { readonly id: string };

/** Serializable state of one collection. */
export interface CollectionSnapshot {
  lastId: number;
  docs: PlainObject[];
}

/**
 * Schemaless document collection of one model (collection name = sevDesk objectName).
 * Ids are numeric strings, sequential per collection starting at 1. Writes store deep
 * copies, so callers can never mutate stored state by accident.
 */
export class Collection {
  readonly name: string;
  #docs = new Map<string, Doc>();
  #lastId = 0;
  readonly #onChange: () => void;

  constructor(name: string, onChange: () => void) {
    this.name = name;
    this.#onChange = onChange;
  }

  /**
   * Inserts a document. Without "id" the next sequential id is assigned; an explicit
   * numeric id bumps the counter so later inserts never collide.
   */
  insert(data: PlainObject): Doc {
    const id = data.id === undefined || data.id === null ? String(this.#lastId + 1) : String(data.id);
    if (this.#docs.has(id)) throw new Error(`${this.name} with id ${id} already exists`);
    if (/^\d+$/.test(id)) this.#lastId = Math.max(this.#lastId, Number(id));
    const doc = withId(id, deepClone(data));
    this.#docs.set(id, doc);
    this.#onChange();
    return doc;
  }

  /** Document by id (number or string), or undefined. */
  get(id: string | number): Doc | undefined {
    return this.#docs.get(String(id));
  }

  /** Document by id or ApiError 404 "No Model_<name> with the id <id> was found". */
  require(id: string | number): Doc {
    const doc = this.get(id);
    if (doc === undefined) throw notFound(this.name, id);
    return doc;
  }

  has(id: string | number): boolean {
    return this.#docs.has(String(id));
  }

  /** Shallow-merges a patch into a document ("id" cannot change). Undefined if missing. */
  update(id: string | number, patch: PlainObject): Doc | undefined {
    const current = this.get(id);
    if (current === undefined) return undefined;
    const doc = withId(current.id, { ...current, ...deepClone(patch) });
    this.#docs.set(current.id, doc);
    this.#onChange();
    return doc;
  }

  /** Replaces a document completely ("id" is kept). Undefined if missing. */
  replace(id: string | number, data: PlainObject): Doc | undefined {
    const current = this.get(id);
    if (current === undefined) return undefined;
    const doc = withId(current.id, deepClone(data));
    this.#docs.set(current.id, doc);
    this.#onChange();
    return doc;
  }

  /** Removes a document; returns whether it existed. */
  delete(id: string | number): boolean {
    const deleted = this.#docs.delete(String(id));
    if (deleted) this.#onChange();
    return deleted;
  }

  /** All documents in ascending id order. */
  all(): Doc[] {
    return [...this.#docs.values()].sort(compareIds);
  }

  /** Documents matching the predicate, ascending id order. */
  find(predicate: (doc: Doc) => boolean): Doc[] {
    return this.all().filter(predicate);
  }

  /** First document (ascending id) matching the predicate. */
  findOne(predicate: (doc: Doc) => boolean): Doc | undefined {
    return this.all().find(predicate);
  }

  get size(): number {
    return this.#docs.size;
  }

  /** Highest id issued so far (0 when none). */
  get lastId(): number {
    return this.#lastId;
  }

  snapshot(): CollectionSnapshot {
    return { lastId: this.#lastId, docs: this.all().map((doc) => deepClone(doc)) };
  }

  /** Replaces the content with a snapshot without change notification. */
  restore(snapshot: CollectionSnapshot): void {
    this.#docs = new Map();
    this.#lastId = snapshot.lastId;
    for (const raw of snapshot.docs) {
      const id = String(raw.id);
      this.#docs.set(id, withId(id, deepClone(raw)));
      if (/^\d+$/.test(id)) this.#lastId = Math.max(this.#lastId, Number(id));
    }
  }
}

/** Document with "id" as first key (stable, readable output). */
function withId(id: string, data: PlainObject): Doc {
  const { id: _ignored, ...rest } = data;
  return { id, ...rest };
}

/** Numeric-aware id comparison (ascending). */
export function compareIds(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id, "en", { numeric: true });
}
