import { notFound } from "../../lib/errors.ts";
import type { PlainObject } from "../../lib/object.ts";
import type { SpecIndex } from "../../spec/specIndex.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { clientFields, createDocument, updateDocument } from "../shared/documents.ts";
import { isTrue } from "../shared/list.ts";
import { assertNumberAvailable, assignNumber } from "../shared/numbering.ts";
import { nextPositionNumber } from "../shared/positions.ts";
import { toRef } from "../shared/refs.ts";
import { assertTaxRates } from "../shared/taxRules.ts";
import {
  deletedIds,
  expectedRefError,
  factoryPart,
  invalidParameter,
  isBlank,
  listOf,
  validationError,
} from "../shared/validation.ts";
import { isOrderType, NUMBER_RANGE_BY_TYPE, ORDER, ORDER_NUMBERED, ORDER_POS } from "./constants.ts";
import { assertDraftOrder, creatorOf, normalizeHead, validateHead, withSendDate } from "./head.ts";
import {
  assertPositionComplete,
  computeOrderTotals,
  isNetOrder,
  normalizePosition,
  orderPositions,
  recalculateOrder,
} from "./positions.ts";

/** Result of the saveOrder factory: the order and all its positions. */
export interface SavedOrder {
  order: Doc;
  positions: Doc[];
}

/** A position as the factory will store it: an existing document with changes, or a new one. */
interface PlannedPosition {
  id: string | undefined;
  fields: PlainObject;
}

/** Parsed and structurally validated factory request. */
interface SaveOrderRequest {
  head: PlainObject;
  orderId: string | undefined;
  mapAll: boolean;
  saves: { raw: PlainObject; label: string }[];
  deletions: string[];
}

/**
 * The saveOrder factory (POST /Order/Factory/saveOrder): creates or updates an order with its
 * positions in one call. Rules (live-verified for invoices, applied to orders by assumption):
 * - the head needs objectName "Order" and mapAll true; a head with "id" but without mapAll is a
 *   silent no-op that still answers 201,
 * - positions come in "orderPosSave" (with "id" they update, without they create), positions in
 *   "orderPosDelete" are removed,
 * - positions of an order that is not a draft can not be created, changed or deleted (409),
 * - at least one position must remain, the total must not be negative (spec news, release 4.167).
 * All validation happens before the first write, so a rejected request changes nothing.
 */
export function saveOrder(tenant: Tenant, spec: SpecIndex, input: PlainObject): SavedOrder {
  const request = parseRequest(input);
  const orders = tenant.store.collection(ORDER);
  const existing = request.orderId === undefined ? undefined : orders.require(request.orderId);
  if (existing !== undefined && !request.mapAll) {
    return { order: existing, positions: orderPositions(tenant, existing.id) };
  }
  if (existing === undefined && !request.mapAll) throw expectedRefError("order", request.head);

  const headPatch = normalizeHead(clientFields(request.head));
  const effective = { ...existing, ...headPatch };
  validateHead(spec, tenant, effective, { creating: existing === undefined, changed: headPatch });
  if (existing !== undefined && !isBlank(headPatch.orderNumber)) {
    assertNumberAvailable(tenant, ORDER_NUMBERED, String(headPatch.orderNumber), existing.id);
  }
  if (existing !== undefined && changesPositions(request)) {
    assertDraftOrder(existing, "order position", "changed");
  }
  const plan = planPositions(tenant, request, existing);
  if (plan.length === 0) throw validationError("An order needs at least one position");
  assertTaxRates(
    effective,
    plan.map((position) => position.fields),
  );
  const totals = computeOrderTotals(
    plan.map((position) => position.fields),
    isNetOrder({ showNet: true, ...effective }),
  );
  if (totals.sumNet < 0 || totals.sumGross < 0) {
    // Assumption: wording; the rule itself is documented (spec news, release 4.167).
    throw validationError("The sum of an estimate, order confirmation or delivery note must not be negative");
  }

  const order =
    existing === undefined
      ? createOrder(tenant, headPatch)
      : updateDocument(tenant, ORDER, existing.id, withSendDate(tenant, effective, headPatch));
  writePositions(tenant, order.id, plan, request.deletions);
  const saved = recalculateOrder(tenant, order.id);
  return { order: saved, positions: orderPositions(tenant, order.id) };
}

/**
 * Creates an order with positions without request validation: for derived documents and seeds.
 * "head" and "positions" take the same fields as the factory (references, timestamps, numbers
 * are normalized); the order type must be valid. Position numbers default to the list index.
 */
export function createOrderWithPositions(
  tenant: Tenant,
  head: PlainObject,
  positions: readonly PlainObject[],
): SavedOrder {
  const patch = normalizeHead(clientFields(head));
  const planned = positions.map((fields, index) => ({
    id: undefined,
    fields: { positionNumber: index, ...normalizePosition(clientFields(fields), `positions[${index}]`) },
  }));
  const order = createOrder(tenant, patch);
  writePositions(tenant, order.id, planned, []);
  return { order: recalculateOrder(tenant, order.id), positions: orderPositions(tenant, order.id) };
}

/** Creates the order document with defaults, the issued number and the send date of delivered orders. */
function createOrder(tenant: Tenant, headPatch: PlainObject): Doc {
  const { orderType } = headPatch;
  if (!isOrderType(orderType)) throw invalidParameter("order.orderType", { status: 422 });
  const orderNumber = assignNumber(
    tenant,
    NUMBER_RANGE_BY_TYPE[orderType],
    ORDER_NUMBERED,
    headPatch.orderNumber,
  );
  const creator = creatorOf(headPatch);
  return createDocument(tenant, ORDER, withSendDate(tenant, headPatch, headPatch), {
    // Assumption: omitted showNet and smallSettlement default to net prices and a regular tax regime.
    defaults: {
      showNet: true,
      smallSettlement: false,
      ...(creator === undefined ? {} : { createUser: toRef(creator.id, creator.objectName) }),
    },
    overrides: { orderNumber },
  });
}

function parseRequest(input: PlainObject): SaveOrderRequest {
  const head = factoryPart("order", input.order, ORDER);
  const saves = listOf(input.orderPosSave).map((raw, index) => {
    const label = `orderPosSave[${index}]`;
    return { raw: factoryPart(label, raw, ORDER_POS), label };
  });
  const deletions = deletedIds("orderPosDelete", input.orderPosDelete, ORDER_POS);
  return {
    head,
    orderId: isBlank(head.id) ? undefined : String(head.id),
    mapAll: isTrue(head.mapAll),
    saves,
    deletions,
  };
}

/** True when the request creates, changes (mapAll) or deletes positions. */
function changesPositions(request: SaveOrderRequest): boolean {
  return (
    request.deletions.length > 0 || request.saves.some(({ raw }) => isBlank(raw.id) || isTrue(raw.mapAll))
  );
}

/**
 * Resolves the position changes against the stored positions. Positions with "id" must belong
 * to the order; ones without "mapAll" are left untouched like the head.
 */
function planPositions(
  tenant: Tenant,
  request: SaveOrderRequest,
  existing: Doc | undefined,
): PlannedPosition[] {
  const stored = existing === undefined ? [] : orderPositions(tenant, existing.id);
  const storedIds = new Set(stored.map((position) => position.id));
  for (const id of request.deletions) {
    if (!storedIds.has(id)) throw notFoundPosition(id);
  }
  const plan = new Map<string, PlannedPosition>(
    stored
      .filter((position) => !request.deletions.includes(position.id))
      .map((position) => [position.id, { id: position.id, fields: { ...position } }]),
  );
  const created: PlannedPosition[] = [];
  for (const { raw, label } of request.saves) {
    const fields = normalizePosition(clientFields(raw), label);
    if (isBlank(raw.id)) {
      if (!isTrue(raw.mapAll)) throw expectedRefError(label, raw);
      assertPositionComplete(fields, label);
      created.push({ id: undefined, fields });
      continue;
    }
    const id = String(raw.id);
    const current = plan.get(id);
    if (current === undefined) throw notFoundPosition(id);
    if (isTrue(raw.mapAll)) plan.set(id, { id, fields: { ...current.fields, ...fields } });
  }
  const all = [...plan.values(), ...created];
  for (const position of created) {
    if (isBlank(position.fields.positionNumber)) {
      position.fields.positionNumber = nextPositionNumber(all.map((entry) => entry.fields));
    }
  }
  return all;
}

function writePositions(
  tenant: Tenant,
  orderId: string,
  plan: readonly PlannedPosition[],
  deletions: readonly string[],
): void {
  const positions = tenant.store.collection(ORDER_POS);
  for (const id of deletions) positions.delete(id);
  const orderRef = toRef(orderId, ORDER);
  for (const { id, fields } of plan) {
    if (id === undefined) {
      createDocument(tenant, ORDER_POS, fields, { overrides: { order: orderRef } });
    } else {
      updateDocument(tenant, ORDER_POS, id, fields);
    }
  }
}

function notFoundPosition(id: string) {
  return notFound(ORDER_POS, id);
}
