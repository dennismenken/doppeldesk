import { isUnixTimestamp, parseDateInput } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { FieldFilter } from "./list.ts";
import { toNumber } from "./money.ts";

/** Comparison of a stored value against a filter bound. */
export type Comparison = ">=" | "<=" | ">" | "<";

function compare(actual: number, comparison: Comparison, bound: number): boolean {
  switch (comparison) {
    case ">=":
      return actual >= bound;
    case "<=":
      return actual <= bound;
    case ">":
      return actual > bound;
    case "<":
      return actual < bound;
  }
}

/**
 * Date filter on a stored date field with a unix timestamp as bound (startDate, endDate,
 * createBefore, ...). Live-verified for invoices: any other format such as "Y-m-d" is
 * silently ignored and the list stays unfiltered. Documents without a date never match.
 */
export function unixDateFilter(field: string, comparison: Comparison): FieldFilter {
  return (doc, value) => {
    if (!isUnixTimestamp(value)) return true;
    const actual = parseDateInput(doc[field]);
    return actual !== undefined && compare(actual.toSeconds(), comparison, Number(value));
  };
}

/**
 * Date filter that accepts every date format DoppelDesk parses (unix, dd.mm.yyyy, ISO).
 * Unparseable bounds are ignored. Used where no unix-only behavior is known (transactions).
 */
export function anyDateFilter(field: string, comparison: Comparison): FieldFilter {
  return (doc, value) => {
    const bound = parseDateInput(value);
    if (bound === undefined) return true;
    const actual = parseDateInput(doc[field]);
    return actual !== undefined && compare(actual.toMillis(), comparison, bound.toMillis());
  };
}

/** Case-insensitive "contains" filter on a stored text field; empty filters match all. */
export function containsFilter(field: string): FieldFilter {
  return (doc, value) => {
    if (typeof value !== "string" || value === "") return true;
    return lowerText(doc[field]).includes(value.toLowerCase());
  };
}

/**
 * startAmount/endAmount: compares the net sum of net documents and the gross sum otherwise
 * (spec: "the (net/gross) sum"); "isNet" tells which one a document shows. Unreadable
 * bounds are ignored.
 */
export function amountFilter(bound: "min" | "max", isNet: (doc: Doc) => boolean): FieldFilter {
  return (doc, value) => {
    const limit = toNumber(value, Number.NaN);
    if (Number.isNaN(limit)) return true;
    const amount = toNumber(isNet(doc) ? doc.sumNet : doc.sumGross);
    return bound === "min" ? amount >= limit : amount <= limit;
  };
}

/** Numeric-aware comparison of document numbers ("RE-1002" > "RE-999"). */
export function compareDocumentNumbers(a: unknown, b: unknown): number {
  return String(a ?? "").localeCompare(String(b ?? ""), "en", { numeric: true });
}

/** Sort by a document number field, "ASC" or "DESC" (case-insensitive); undefined for other values. */
export function numberSort(field: string, direction: unknown): ((a: Doc, b: Doc) => number) | undefined {
  const normalized = typeof direction === "string" ? direction.toUpperCase() : "";
  if (normalized !== "ASC" && normalized !== "DESC") return undefined;
  const sign = normalized === "DESC" ? -1 : 1;
  return (a, b) => sign * compareDocumentNumbers(a[field], b[field]);
}

/** Lower-cased text of a string or number value ("" otherwise). */
export function lowerText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).toLowerCase() : "";
}
