import { listModel } from "../../routes/generic.ts";
import type { DomainModule, RouteDefinition } from "../../routes/types.ts";
import { documentPositionOrder } from "../shared/positions.ts";
import { changeOrderParameter, getOrderPdf, sendOrderBy, sendOrderViaEmail } from "./actions.ts";
import { HEAD_EXTRA_FIELDS, ORDER_POS, ORDER_POSITIONS } from "./constants.ts";
import {
  deleteOrder,
  deleteOrderPosition,
  getOrderDiscounts,
  getOrderPositions,
  listOrders,
  updateOrder,
  updateOrderPosition,
} from "./crud.ts";
import { deriveFromRequest, getRelatedObjects } from "./derived.ts";
import { saveOrder } from "./saveOrder.ts";

/**
 * getRelatedObjects returns documents of several types (the spec wrongly declares order
 * positions), so the handler shapes each one and the core leaves the array as it is.
 */
const MIXED_OBJECTS = { type: "array", items: { type: "object" } } as const;

const routes: RouteDefinition[] = [
  { method: "GET", path: "/Order", handler: listOrders },
  {
    method: "POST",
    path: "/Order/Factory/saveOrder",
    factoryParts: [
      { field: "order", responseField: "order", extraFields: HEAD_EXTRA_FIELDS },
      { field: "orderPosSave", responseField: "orderPos" },
    ],
    handler: (context) => {
      const { order, positions } = saveOrder(context.tenant, context.spec, context.input);
      return { objects: { order, orderPos: positions } };
    },
  },
  { method: "PUT", path: "/Order/{orderId}", handler: updateOrder },
  { method: "DELETE", path: "/Order/{orderId}", handler: deleteOrder },
  { method: "GET", path: "/Order/{orderId}/getPositions", handler: getOrderPositions },
  { method: "GET", path: "/Order/{orderId}/getDiscounts", handler: getOrderDiscounts },
  {
    method: "GET",
    path: "/Order/{orderId}/getRelatedObjects",
    handler: getRelatedObjects,
    responseSchema: MIXED_OBJECTS,
  },
  { method: "POST", path: "/Order/{orderId}/sendViaEmail", handler: sendOrderViaEmail },
  { method: "PUT", path: "/Order/{orderId}/sendBy", handler: sendOrderBy },
  { method: "GET", path: "/Order/{orderId}/getPdf", handler: getOrderPdf },
  { method: "PUT", path: "/Order/{orderId}/changeParameter", handler: changeOrderParameter },
  {
    method: "POST",
    path: "/Order/Factory/createPackingListFromOrder",
    handler: (context) => deriveFromRequest(context, "LI"),
  },
  {
    method: "POST",
    path: "/Order/Factory/createContractNoteFromOrder",
    handler: (context) => deriveFromRequest(context, "AB"),
  },
  {
    method: "GET",
    path: "/OrderPos",
    handler: (context) => listModel(context, ORDER_POS, { sort: documentPositionOrder(ORDER_POSITIONS) }),
  },
  { method: "PUT", path: "/OrderPos/{orderPosId}", handler: updateOrderPosition },
  { method: "DELETE", path: "/OrderPos/{orderPosId}", handler: deleteOrderPosition },
];

/**
 * Orders (estimates AN, order confirmations AB, delivery notes LI) and their positions: the
 * saveOrder factory, derived documents, sending, status handling and list filters.
 */
export const orderModule: DomainModule = {
  name: "order",
  models: ["Order", "OrderPos"],
  routes,
};

export { setOrderStatus } from "./actions.ts";
export { ORDER, ORDER_SENDABLE, ORDER_STATUS, ORDER_TYPES, type OrderType } from "./constants.ts";
export { deriveOrder } from "./derived.ts";
export { orderPositions, recalculateOrder } from "./positions.ts";
export { createOrderWithPositions, type SavedOrder, saveOrder } from "./saveOrder.ts";
