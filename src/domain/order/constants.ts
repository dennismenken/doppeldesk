import type { NumberedModel, NumberRangeKey } from "../shared/numbering.ts";
import type { PositionModel } from "../shared/positions.ts";
import type { SendableModel } from "../shared/sending.ts";

/** Collection names (sevDesk objectNames) used by the order module. */
export const ORDER = "Order";
export const CONTACT = "Contact";
export const ORDER_POS = "OrderPos";

/** Order status codes (spec tag "Order", table "Order status"). */
export const ORDER_STATUS = {
  draft: 100,
  delivered: 200,
  rejected: 300,
  accepted: 500,
  partiallyCalculated: 750,
  calculated: 1000,
} as const;

export const ORDER_STATUS_CODES: readonly number[] = Object.values(ORDER_STATUS);

/** Order numbers are unique over all orders of every type. */
export const ORDER_NUMBERED: NumberedModel = { model: ORDER, field: "orderNumber" };

/** Where order positions live. */
export const ORDER_POSITIONS: PositionModel = { model: ORDER_POS, parentField: "order", parentModel: ORDER };

/** Sending orders: a draft becomes "delivered" (200); no contact rule is documented for orders. */
export const ORDER_SENDABLE: SendableModel = {
  model: ORDER,
  draftStatus: ORDER_STATUS.draft,
  sentStatus: ORDER_STATUS.delivered,
  requiresContact: false,
};

/** Order types: AN estimate (offer), AB order confirmation (contract note), LI delivery note (packing list). */
export const ORDER_TYPES = ["AN", "AB", "LI"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/** Number range of each order type (see shared/numbering.ts). */
export const NUMBER_RANGE_BY_TYPE: Readonly<Record<OrderType, NumberRangeKey>> = {
  AN: "offer",
  AB: "orderConfirmation",
  LI: "deliveryNote",
};

export function isOrderType(value: unknown): value is OrderType {
  return ORDER_TYPES.some((type) => type === value);
}
