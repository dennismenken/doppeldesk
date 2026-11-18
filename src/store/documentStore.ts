import { Collection, type CollectionSnapshot } from "./collection.ts";

/** All collections of one tenant, created lazily by name. */
export class DocumentStore {
  #collections = new Map<string, Collection>();
  readonly #onChange: () => void;

  constructor(onChange: () => void) {
    this.#onChange = onChange;
  }

  /** Collection by sevDesk objectName, e.g. "Invoice" or "InvoicePos" (created on first use). */
  collection(name: string): Collection {
    let collection = this.#collections.get(name);
    if (collection === undefined) {
      collection = new Collection(name, this.#onChange);
      this.#collections.set(name, collection);
    }
    return collection;
  }

  /** Names of collections that currently hold documents or issued ids. */
  names(): string[] {
    return [...this.#collections.values()]
      .filter((collection) => collection.size > 0 || collection.lastId > 0)
      .map((collection) => collection.name)
      .sort();
  }

  snapshot(): Record<string, CollectionSnapshot> {
    return Object.fromEntries(this.names().map((name) => [name, this.collection(name).snapshot()]));
  }

  restore(snapshot: Record<string, CollectionSnapshot>): void {
    this.#collections = new Map();
    for (const [name, data] of Object.entries(snapshot)) {
      const collection = new Collection(name, this.#onChange);
      collection.restore(data);
      this.#collections.set(name, collection);
    }
  }
}
