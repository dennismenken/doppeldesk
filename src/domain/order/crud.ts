import type { PlainObject } from "../../lib/object.ts";
import { pathParam } from "../../routes/context.ts";
import { listModel } from "../../routes/generic.ts";
import type { RouteContext, RouteResult } from "../../routes/types.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { clientFields, DISCOUNTS, deleteWithDependents, updateDocument } from "../shared/documents.ts";
import { amountFilter, numberSort, unixDateFilter } from "../shared/filters.ts";
import type { FieldFilter, ListOptions } from "../shared/list.ts";
import { listDocuments } from "../shared/list.ts";
import { assertNumberAvailable, releaseNumber } from "../shared/numbering.ts";
import { isRefTo, readRef } from "../shared/refs.ts";
import { tagsFilter } from "../shared/tags.ts";
import { assertTaxRates } from "../shared/taxRules.ts";
import { isBlank } from "../shared/validation.ts";
import {
  isOrderType,
  NUMBER_RANGE_BY_TYPE,
  ORDER,
  ORDER_NUMBERED,
  ORDER_POS,
  ORDER_POSITIONS,
} from "./constants.ts";
import { assertDraftOrder, COMPUTED_HEAD_FIELDS, normalizeHead, validateHead, withSendDate } from "./head.ts";
import { isNetOrder, normalizePosition, orderPositions, recalculateOrder } from "./positions.ts";

/** Numeric part of an order number ("AN-1001" -> 1001), or undefined. */
function numberPart(value: unknown): number | undefined {
  const match = /(\d+)\D*$/.exec(String(value ?? ""));
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** Assumption: the number comparison uses the numeric part, so "1001" and "AN-1001" are equivalent. */
function numberFilter(comparison: "greater" | "smaller"): FieldFilter {
  return (doc, value) => {
    const actual = numberPart(doc.orderNumber);
    const limit = numberPart(value);
    if (limit === undefined) return true;
    if (actual === undefined) return false;
    return comparison === "greater" ? actual > limit : actual < limit;
  };
}

/**
 * Filters of GET /Order (spec tag "Order", "How to filter"). Equality filters on status,
 * orderNumber, orderType and contact[id] come from the generic list; "tags" is added per
 * tenant in listOrders.
 */
const ORDER_FILTERS: NonNullable<ListOptions["filters"]> = {
  startDate: unixDateFilter("orderDate", ">="),
  endDate: unixDateFilter("orderDate", "<="),
  createAfter: unixDateFilter("create", ">"),
  createBefore: unixDateFilter("create", "<"),
  updateAfter: unixDateFilter("update", ">"),
  updateBefore: unixDateFilter("update", "<"),
  orderNumberGreater: numberFilter("greater"),
  orderNumberSmaller: numberFilter("smaller"),
  // The spec's filter table spells this one with a doubled "Number".
  orderNumberNumberSmaller: numberFilter("smaller"),
  startAmount: amountFilter("min", isNetOrder),
  endAmount: amountFilter("max", isNetOrder),
  orderByOrderNumber: null,
};

/** GET /Order. */
export function listOrders(context: RouteContext): RouteResult {
  return listModel(context, ORDER, {
    filters: { ...ORDER_FILTERS, tags: tagsFilter(context.tenant, ORDER, "all") },
    sort: numberSort("orderNumber", context.query.orderByOrderNumber),
  });
}

/** PUT /Order/{orderId}: merges head fields; the sums are always recomputed from the positions. */
export function updateOrder(context: RouteContext): RouteResult {
  const { tenant, spec } = context;
  const existing = tenant.store.collection(ORDER).require(pathParam(context, "orderId"));
  const patch = normalizeHead(withoutComputedFields(clientFields(context.input)));
  const effective = { ...existing, ...patch };
  validateHead(spec, tenant, effective, { creating: false, changed: patch });
  if (!isBlank(patch.orderNumber)) {
    assertNumberAvailable(tenant, ORDER_NUMBERED, String(patch.orderNumber), existing.id);
  }
  assertTaxRates(effective, orderPositions(tenant, existing.id));
  updateDocument(tenant, ORDER, existing.id, withSendDate(tenant, effective, patch));
  return { objects: recalculateOrder(tenant, existing.id) };
}

/** DELETE /Order/{orderId}: drafts only (409 otherwise); removes positions and discounts, frees the number. */
export function deleteOrder(context: RouteContext): RouteResult {
  const { tenant } = context;
  const orders = tenant.store.collection(ORDER);
  const order = orders.require(pathParam(context, "orderId"));
  assertDraftOrder(order, "order", "deleted");
  removeOrder(tenant, order);
  return { objects: [null] };
}

/** Removes an order with positions, discounts and tag relations and gives its number back when it was the last issued. */
function removeOrder(tenant: Tenant, order: Doc): void {
  deleteWithDependents(tenant, ORDER, order.id, [
    { model: ORDER_POSITIONS.model, field: ORDER_POSITIONS.parentField },
  ]);
  if (isOrderType(order.orderType) && typeof order.orderNumber === "string") {
    releaseNumber(tenant, NUMBER_RANGE_BY_TYPE[order.orderType], order.orderNumber);
  }
}

/**
 * PUT /OrderPos/{orderPosId}: only positions of draft orders (409 otherwise, like DELETE);
 * merges position fields and recomputes the amounts and the order totals.
 */
export function updateOrderPosition(context: RouteContext): RouteResult {
  const { tenant } = context;
  const id = pathParam(context, "orderPosId");
  const parent = parentOf(tenant, tenant.store.collection(ORDER_POS).require(id));
  if (parent !== undefined) assertDraftOrder(parent, "order position", "changed");
  updateDocument(tenant, ORDER_POS, id, normalizePosition(clientFields(context.input), "orderPos"));
  const position = refreshParent(tenant, id);
  return { objects: position };
}

/** DELETE /OrderPos/{orderPosId}: only positions of draft orders (409 otherwise); recomputes the order totals. */
export function deleteOrderPosition(context: RouteContext): RouteResult {
  const { tenant } = context;
  const positions = tenant.store.collection(ORDER_POS);
  const position = positions.require(pathParam(context, "orderPosId"));
  const parent = parentOf(tenant, position);
  if (parent !== undefined) assertDraftOrder(parent, "order position", "deleted");
  positions.delete(position.id);
  if (parent !== undefined) recalculateOrder(tenant, parent.id);
  return { objects: [null] };
}

/** GET /Order/{orderId}/getPositions. */
export function getOrderPositions(context: RouteContext): RouteResult {
  const order = context.tenant.store.collection(ORDER).require(pathParam(context, "orderId"));
  return listDocuments(orderPositions(context.tenant, order.id), context.query, {
    store: context.tenant.store,
  });
}

/** GET /Order/{orderId}/getDiscounts. */
export function getOrderDiscounts(context: RouteContext): RouteResult {
  const order = context.tenant.store.collection(ORDER).require(pathParam(context, "orderId"));
  const discounts = context.tenant.store
    .collection(DISCOUNTS)
    .find((discount) => isRefTo(discount.object, ORDER, order.id));
  return listDocuments(discounts, context.query, { store: context.tenant.store });
}

function parentOf(tenant: Tenant, position: Doc): Doc | undefined {
  const ref = readRef(position.order, ORDER);
  return ref === undefined ? undefined : tenant.store.collection(ORDER).get(ref.id);
}

/** Recomputes the parent order of a position and returns the refreshed position. */
function refreshParent(tenant: Tenant, positionId: string): Doc {
  const positions = tenant.store.collection(ORDER_POS);
  const position = positions.require(positionId);
  const parent = parentOf(tenant, position);
  if (parent !== undefined) recalculateOrder(tenant, parent.id);
  return positions.require(positionId);
}

function withoutComputedFields(fields: PlainObject): PlainObject {
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !COMPUTED_HEAD_FIELDS.includes(key)));
}
