import { type HttpMethod, toHttpMethod } from "../lib/routePath.ts";
import { matchesPathPattern } from "./pathPattern.ts";

/** One logged API request. Never contains the API token or any header. */
export interface RequestLogEntry {
  id: number;
  /** Wall-clock time of the request (ISO 8601, UTC). */
  time: string;
  /**
   * Time of the tenant clock when the request arrived (ISO 8601, Europe/Berlin like the
   * dates of documents); differs from "time" when the clock is frozen or moved.
   */
  clockTime: string;
  method: string;
  /** Path relative to the API base path, without query string. */
  path: string;
  /** Parsed query without the "token" parameter. */
  query: Record<string, unknown>;
  body: unknown;
  status: number;
  durationMs: number;
  /** Matched route template (domain naming), null for unknown routes. */
  route: string | null;
}

/** Filter for listing the request log. */
export interface RequestLogFilter {
  path?: string;
  method?: HttpMethod;
  limit?: number;
}

/** Ring buffer of the latest requests of one tenant. */
export class RequestLog {
  readonly #capacity: number;
  #entries: RequestLogEntry[] = [];
  #nextId = 1;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  add(entry: Omit<RequestLogEntry, "id">): void {
    if (this.#capacity === 0) return;
    this.#entries.push({ id: this.#nextId++, ...entry });
    if (this.#entries.length > this.#capacity) this.#entries.splice(0, this.#entries.length - this.#capacity);
  }

  /** Entries in chronological order; with limit, the newest "limit" entries. */
  list(filter: RequestLogFilter = {}): RequestLogEntry[] {
    const { path, method, limit } = filter;
    const matching = this.#entries.filter(
      (entry) =>
        (method === undefined || toHttpMethod(entry.method) === method) &&
        (path === undefined || matchesPathPattern(path, entry)),
    );
    return limit === undefined ? matching : matching.slice(Math.max(0, matching.length - limit));
  }

  clear(): void {
    this.#entries = [];
  }
}
