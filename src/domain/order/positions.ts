import { notFound } from "../../lib/errors.ts";
import type { PlainObject } from "../../lib/object.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { assertPositionDiscount } from "../shared/discounts.ts";
import { isTrue } from "../shared/list.ts";
import {
  computeDocumentTotals,
  computePositionSums,
  type DocumentTotals,
  type PositionSums,
  toNumber,
} from "../shared/money.ts";
import { positionsOf } from "../shared/positions.ts";
import { invalidParameter, isBlank, missingParameters, normalizeRefs } from "../shared/validation.ts";
import { ORDER, ORDER_POS, ORDER_POSITIONS } from "./constants.ts";

/** Reference fields of a position and the model they point to. */
const POSITION_REFS = { unity: "Unity", part: "Part", order: ORDER } as const;

/** Numeric fields of a position (request values may be numeric strings). */
const NUMERIC_POSITION_FIELDS = ["quantity", "price", "discount", "taxRate", "positionNumber"] as const;

/** Fields of a position the server computes (keys of PositionSums); client input for them is overwritten. */
const DERIVED_POSITION_FIELDS = [
  "priceNet",
  "priceTax",
  "priceGross",
  "sumNet",
  "sumTax",
  "sumGross",
  "sumDiscount",
] as const satisfies readonly (keyof PositionSums)[];

/** Fields a position needs at creation (Model_OrderPos.required, spec). */
const REQUIRED_POSITION_FIELDS = ["unity", "taxRate", "quantity"] as const;

/**
 * Normalizes request fields of a position: references to {id, objectName}, numbers to
 * numbers, "optional" to a boolean. Throws a 400/422 for malformed values.
 */
export function normalizePosition(fields: PlainObject, label: string): PlainObject {
  const result = normalizeRefs(fields, POSITION_REFS);
  for (const key of NUMERIC_POSITION_FIELDS) {
    if (isBlank(fields[key])) continue;
    const parsed = toNumber(fields[key], Number.NaN);
    if (Number.isNaN(parsed)) throw invalidParameter(`${label}.${key}`, { status: 422 });
    result[key] = parsed;
  }
  assertPositionDiscount(result.discount);
  if (!isBlank(fields.optional)) result.optional = isTrue(fields.optional);
  return result;
}

/** Throws when a new position lacks required fields. */
export function assertPositionComplete(fields: PlainObject, label: string): void {
  const missing = REQUIRED_POSITION_FIELDS.filter((key) => isBlank(fields[key]));
  if (missing.length > 0)
    throw missingParameters(
      missing.map((key) => `${label}.${key}`),
      422,
    );
}

/** Amounts of one position. "showNet" decides whether "price" is net (true) or gross (false). */
export function computePositionAmounts(position: PlainObject, showNet: boolean): PositionSums {
  return computePositionSums({
    quantity: toNumber(position.quantity),
    price: toNumber(position.price),
    taxRate: toNumber(position.taxRate),
    discount: toNumber(position.discount),
    mode: showNet ? "net" : "gross",
  });
}

/**
 * Header totals over positions. Assumption: optional positions are shown but do not count
 * toward the totals.
 */
export function computeOrderTotals(positions: readonly PlainObject[], showNet: boolean): DocumentTotals {
  const counted = positions.filter((position) => position.optional !== true);
  return computeDocumentTotals(
    counted.map((position) => computePositionAmounts(position, showNet)),
    showNet ? "net" : "gross",
  );
}

/**
 * Whether prices are net. Assumption: an order without "showNet" holds net prices (the
 * documented meaning of true, and the common case for API consumers).
 */
export function isNetOrder(order: Readonly<PlainObject> | undefined): boolean {
  return order === undefined || order.showNet === undefined || order.showNet === null
    ? true
    : isTrue(order.showNet);
}

/** Positions of an order, ordered by position number, then id. */
export function orderPositions(tenant: Tenant, orderId: string): Doc[] {
  return positionsOf(tenant, ORDER_POSITIONS, orderId);
}

/**
 * Recomputes the derived amounts of all positions and the header totals of an order from
 * the stored fields. Assumption: foreign currency sums are not simulated and stay 0.
 */
export function recalculateOrder(tenant: Tenant, orderId: string): Doc {
  const orders = tenant.store.collection(ORDER);
  const order = orders.require(orderId);
  const showNet = isNetOrder(order);
  const positions = tenant.store.collection(ORDER_POS);
  const current = orderPositions(tenant, orderId);
  for (const position of current) {
    const sums = computePositionAmounts(position, showNet);
    positions.update(position.id, Object.fromEntries(DERIVED_POSITION_FIELDS.map((key) => [key, sums[key]])));
  }
  const totals = computeOrderTotals(current, showNet);
  const updated = orders.update(orderId, {
    sumNet: totals.sumNet,
    sumTax: totals.sumTax,
    sumGross: totals.sumGross,
    sumDiscounts: totals.sumDiscounts,
    sumNetForeignCurrency: 0,
    sumTaxForeignCurrency: 0,
    sumGrossForeignCurrency: 0,
    sumDiscountsForeignCurrency: 0,
  });
  if (updated === undefined) throw notFound(ORDER, orderId);
  return updated;
}
