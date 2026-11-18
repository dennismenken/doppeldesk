import type { DateTime } from "luxon";
import type { PlainObject } from "../../lib/object.ts";
import { isUnixTimestamp, parseDateInput, startOfBerlinDay } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { compareDocumentNumbers, lowerText, numberSort, unixDateFilter } from "./filters.ts";
import { type FieldFilter, isTrue } from "./list.ts";
import { toNumber } from "./money.ts";
import { isPartiallyPaid, type PayableModel } from "./payments.ts";
import { tagsFilter } from "./tags.ts";

/** What the shared list filters need to know about a payable document type (invoice, credit note). */
export interface ListedDocumentType {
  payable: PayableModel;
  /** Field of the document number, e.g. "invoiceNumber". */
  numberField: string;
  /** Field of the document date the date filters apply to, e.g. "invoiceDate". */
  dateField: string;
  /** Due date of a document; undefined when it has none. */
  dueDate(doc: Doc): DateTime | undefined;
}

/**
 * Filters the spec's filter tables of invoices and credit notes share. Date filters take unix
 * timestamps only (live-verified for invoices). Assumptions: customerIntenalNote (spec spelling)
 * matches customerInternalNote exactly, headerStartsWith and headerOrNumber ignore case, a
 * document is delinquent while it is unsettled (open or partially paid) and its due date lies
 * before today (Berlin). The orderBy* keys are no field filters; documentSort reads them.
 */
export function documentFilters(
  tenant: Tenant,
  type: ListedDocumentType,
): Record<string, FieldFilter | null> {
  const { payable, numberField, dateField } = type;
  const delinquent = (doc: Doc) => isDelinquent(tenant, type, doc);
  return {
    startDate: unixDateFilter(dateField, ">="),
    endDate: unixDateFilter(dateField, "<="),
    day: (doc, value) => {
      if (!isUnixTimestamp(value)) return true;
      const day = parseDateInput(value);
      return day !== undefined && parseDateInput(doc[dateField])?.hasSame(day, "day") === true;
    },
    customerIntenalNote: (doc, value) => typeof value !== "string" || doc.customerInternalNote === value,
    headerStartsWith: (doc, value) => lowerText(doc.header).startsWith(lowerText(value)),
    headerOrNumber: (doc, value) =>
      lowerText(doc.header).includes(lowerText(value)) ||
      lowerText(doc[numberField]).includes(lowerText(value)),
    partiallyPaid: (doc, value) => !isTrue(value) || isPartiallyPaid(payable, doc),
    delinquent: (doc, value) => !isTrue(value) || delinquent(doc),
    notdelinquent: (doc, value) => !isTrue(value) || !delinquent(doc),
    tags: tagsFilter(tenant, payable.model, "all"),
    orderByDueDate: null,
    orderByDueTime: null,
    orderByDebit: null,
  };
}

/** Filter "<number>Greater"/"<number>Smaller": numeric-aware comparison of document numbers. */
export function documentNumberFilter(field: string, comparison: "greater" | "smaller"): FieldFilter {
  return (doc, value) => {
    if (typeof value !== "string" || value === "") return true;
    const result = compareDocumentNumbers(doc[field], value);
    return comparison === "greater" ? result > 0 : result < 0;
  };
}

/**
 * Sort of a document list: the number sort parameter (ASC/DESC) first, then orderByDueDate or
 * orderByDueTime (ascending due date); undefined keeps the default ascending id.
 */
export function documentSort(
  type: ListedDocumentType,
  query: PlainObject,
  numberSortKey: string,
): ((a: Doc, b: Doc) => number) | undefined {
  const byNumber = numberSort(type.numberField, query[numberSortKey]);
  if (byNumber !== undefined) return byNumber;
  if (isTrue(query.orderByDueDate) || isTrue(query.orderByDueTime)) {
    const seconds = (doc: Doc) => type.dueDate(doc)?.toSeconds() ?? 0;
    return (a, b) => seconds(a) - seconds(b);
  }
  return undefined;
}

function isDelinquent(tenant: Tenant, type: ListedDocumentType, doc: Doc): boolean {
  if (!type.payable.bookableStatuses.includes(toNumber(doc.status))) return false;
  const due = type.dueDate(doc);
  return due !== undefined && due < startOfBerlinDay(tenant.clock.now());
}
