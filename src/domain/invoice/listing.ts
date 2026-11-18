import type { PlainObject } from "../../lib/object.ts";
import { parseDateInput } from "../../lib/time.ts";
import { modelFieldNames, responseObjectsSchema } from "../../routes/generic.ts";
import type { RouteContext, RouteResult } from "../../routes/types.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { contactName, contactOf } from "../shared/contacts.ts";
import {
  documentFilters,
  documentNumberFilter,
  documentSort,
  type ListedDocumentType,
} from "../shared/documentFilters.ts";
import { lowerText, unixDateFilter } from "../shared/filters.ts";
import { type FieldFilter, isTrue, listDocuments } from "../shared/list.ts";
import { toNumber } from "../shared/money.ts";
import { HIDDEN_BY_DEFAULT, INVOICE, INVOICE_PAYABLE } from "./constants.ts";
import { typeOf } from "./guards.ts";
import { invoicePositions } from "./positions.ts";

/** Invoices for the shared document filters: due date is invoiceDate plus timeToPay days. */
const LISTED_INVOICE: ListedDocumentType = {
  payable: INVOICE_PAYABLE,
  numberField: "invoiceNumber",
  dateField: "invoiceDate",
  dueDate: (doc) => parseDateInput(doc.invoiceDate)?.plus({ days: toNumber(doc.timeToPay) }),
};

/**
 * GET /Invoice with the filters of the spec's filter table. Date filters take unix
 * timestamps only; other formats are silently ignored (live-verified for startDate).
 * Equality filters on fields (status as comma list, invoiceNumber, invoiceType,
 * contact[id], origin[id], sendType, ...) come from the generic list handling.
 */
export function listInvoices(context: RouteContext): RouteResult {
  const { tenant, query } = context;
  const docs = tenant.store
    .collection(INVOICE)
    .all()
    .filter((doc) => visibleByDefault(doc, query));
  return listDocuments(docs, query, {
    fields: modelFieldNames(context.spec, responseObjectsSchema(context)),
    store: tenant.store,
    filters: invoiceFilters(tenant),
    sort: documentSort(LISTED_INVOICE, query, "orderByInvoiceNumber"),
  });
}

function invoiceFilters(tenant: Tenant): Record<string, FieldFilter | null> {
  return {
    ...documentFilters(tenant, LISTED_INVOICE),
    createAfter: unixDateFilter("create", ">"),
    createBefore: unixDateFilter("create", "<"),
    updateAfter: unixDateFilter("update", ">"),
    updateBefore: unixDateFilter("update", "<"),
    invoiceNumberGreater: documentNumberFilter("invoiceNumber", "greater"),
    invoiceNumberSmaller: documentNumberFilter("invoiceNumber", "smaller"),
    fulltextSearch: (doc, value) => searchText(tenant, doc).includes(lowerText(value)),
    onlyDunned: (doc, value) => !isTrue(value) || toNumber(doc.dunningLevel) > 0,
    showAll: null,
    showWkr: null,
    showMa: null,
    orderByInvoiceNumber: null,
  };
}

/**
 * Assumption: without showAll, showWkr=all, showMa=all or an explicit invoiceType
 * filter, recurring invoices and payment reminders are not listed (see HIDDEN_BY_DEFAULT).
 */
function visibleByDefault(doc: Doc, query: PlainObject): boolean {
  if (isTrue(query.showAll) || query.invoiceType !== undefined) return true;
  const type = typeOf(doc);
  if (!HIDDEN_BY_DEFAULT.includes(type)) return true;
  const flag = type === "WKR" ? query.showWkr : query.showMa;
  return flag === "all" || isTrue(flag);
}

/** Lower-cased text of header, number, contact and positions for fulltextSearch. */
function searchText(tenant: Tenant, doc: Doc): string {
  const positions = invoicePositions(tenant, doc.id).flatMap((pos) => [pos.name, pos.text]);
  return [doc.header, doc.invoiceNumber, contactName(contactOf(tenant, doc.contact)), ...positions]
    .map(lowerText)
    .join("\n");
}
