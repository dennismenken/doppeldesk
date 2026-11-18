import { startOfBerlinDay, toIso } from "../../lib/time.ts";
import { pathParam } from "../../routes/context.ts";
import type { RouteContext, RouteResult } from "../../routes/types.ts";
import { schemaRef } from "../../serialize/envelope.ts";
import { shapeValue } from "../../serialize/serializer.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { embed, isTrue, paginate } from "../shared/list.ts";
import { issueFreeNumber } from "../shared/numbering.ts";
import { readRef, toRef } from "../shared/refs.ts";
import { isBlank, requireRefTo } from "../shared/validation.ts";
import { NUMBER_RANGE_BY_TYPE, ORDER, ORDER_NUMBERED, ORDER_STATUS, type OrderType } from "./constants.ts";
import { orderPositions } from "./positions.ts";
import { createOrderWithPositions, type SavedOrder } from "./saveOrder.ts";

/** Head fields a derived order inherits from its source order. */
const INHERITED_HEAD_FIELDS = [
  "contact",
  "contactPerson",
  "createUser",
  "address",
  "addressCountry",
  "deliveryAddressCountry",
  "currency",
  "taxRule",
  "taxType",
  "taxSet",
  "taxText",
  "taxRate",
  "showNet",
  "smallSettlement",
  "headText",
  "footText",
  "paymentTerms",
  "deliveryTerms",
  "customerInternalNote",
] as const;

/** Collections that form chains of related documents through their "origin" reference. */
const RELATED_MODELS: readonly string[] = [ORDER, "Invoice", "CreditNote"];

/**
 * Creates a new draft order of the given type from a source order: inherited head fields,
 * origin reference to the source and copies of all positions. Assumptions: the order date is
 * today, the header is the new number, the version restarts at 0, and the source order keeps
 * its status.
 */
export function deriveOrder(tenant: Tenant, source: Doc, orderType: OrderType): SavedOrder {
  const orderNumber = issueFreeNumber(tenant, NUMBER_RANGE_BY_TYPE[orderType], ORDER_NUMBERED);
  const inherited = Object.fromEntries(
    INHERITED_HEAD_FIELDS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
  return createOrderWithPositions(
    tenant,
    {
      ...inherited,
      orderType,
      orderNumber,
      header: orderNumber,
      status: ORDER_STATUS.draft,
      version: 0,
      orderDate: toIso(startOfBerlinDay(tenant.clock.now())),
      origin: toRef(source.id, ORDER),
      typeOrigin: ORDER,
    },
    orderPositions(tenant, source.id),
  );
}

/**
 * Handler of the two derive factories. The source order comes from the query
 * (order[id], order[objectName]) or, as fallback, from the body, which is the order reference
 * itself (Model_CreatePackingListFromOrder). The objectName must be "Order" when given.
 */
export function deriveFromRequest(context: RouteContext, orderType: OrderType): RouteResult {
  const ref = requireRefTo("order", orderReference(context), ORDER);
  const source = context.tenant.store.collection(ORDER).require(ref.id);
  return { objects: deriveOrder(context.tenant, source, orderType).order };
}

/** The order reference of a derive request; undefined when neither query nor body names one. */
function orderReference(context: RouteContext): unknown {
  if (!isBlank(context.query.order)) return context.query.order;
  return Object.keys(context.input).length > 0 ? context.input : undefined;
}

interface RelatedDocument {
  model: string;
  doc: Doc;
}

const documentKey = (model: string, id: string): string => `${model}:${id}`;

/**
 * Keys of all documents connected to the start document through origin references,
 * following them in both directions (transitive closure).
 */
function connectedKeys(documents: readonly RelatedDocument[], startKey: string): Set<string> {
  const connected = new Set<string>([startKey]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { model, doc } of documents) {
      const key = documentKey(model, doc.id);
      const origin = readRef(doc.origin);
      if (origin === undefined) continue;
      const originKey = documentKey(origin.objectName, origin.id);
      if (connected.has(key) !== connected.has(originKey)) {
        connected.add(connected.has(key) ? originKey : key);
        grew = true;
      }
    }
  }
  return connected;
}

/**
 * GET /Order/{orderId}/getRelatedObjects: all documents connected to the order through origin
 * references (orders, invoices, credit notes), optionally including the order itself and
 * grouped by type. Assumption: the connection is transitive in both directions; the spec
 * declares the wrong response schema (order positions), each document is shaped by its own.
 */
export function getRelatedObjects(context: RouteContext): RouteResult {
  const { tenant, spec, query } = context;
  const order = tenant.store.collection(ORDER).require(pathParam(context, "orderId"));
  const documents: RelatedDocument[] = RELATED_MODELS.flatMap((model) =>
    tenant.store
      .collection(model)
      .all()
      .map((doc) => ({ model, doc })),
  );
  const ownKey = documentKey(ORDER, order.id);
  const connected = connectedKeys(documents, ownKey);
  const selected = documents.filter(
    ({ model, doc }) =>
      connected.has(documentKey(model, doc.id)) &&
      (isTrue(query.includeItself) || documentKey(model, doc.id) !== ownKey),
  );
  const typeRank = (model: string): number => (isTrue(query.sortByType) ? RELATED_MODELS.indexOf(model) : 0);
  selected.sort(
    (a, b) =>
      typeRank(a.model) - typeRank(b.model) ||
      String(a.doc.create).localeCompare(String(b.doc.create)) ||
      a.model.localeCompare(b.model) ||
      a.doc.id.localeCompare(b.doc.id, "en", { numeric: true }),
  );
  const page = paginate(selected, query);
  const objects = page.objects.map(({ model, doc }) => {
    const [expanded] = embed([doc], query.embed, tenant.store);
    const schemaName = spec
      .schemaNames()
      .find((name) => name.toLowerCase() === `model_${model}response`.toLowerCase());
    return schemaName === undefined ? expanded : shapeValue(spec, expanded, schemaRef(schemaName));
  });
  return { ...page, objects };
}
