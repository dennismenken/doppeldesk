import { toIso } from "../../lib/time.ts";
import { pathParam } from "../../routes/context.ts";
import type { RouteContext, RouteResult } from "../../routes/types.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { changeLayout, pdfFile, type RenderedDocument, renderDocument } from "../shared/rendering.ts";
import { commitOnDownload, sendBy, sendViaEmail } from "../shared/sending.ts";
import { ORDER, ORDER_SENDABLE } from "./constants.ts";
import { orderPositions } from "./positions.ts";

/**
 * Sets the status of an order, e.g. after an invoice was created from it (750 partially
 * calculated, 1000 calculated). For other modules; returns undefined for an unknown order.
 */
export function setOrderStatus(tenant: Tenant, orderId: string, status: number): Doc | undefined {
  return tenant.store.collection(ORDER).update(orderId, { status, update: toIso(tenant.clock.now()) });
}

/** PUT /Order/{orderId}/sendBy (shared sending rules): a draft becomes delivered (200). */
export function sendOrderBy(context: RouteContext): RouteResult {
  return { objects: sendBy(context.tenant, ORDER_SENDABLE, pathParam(context, "orderId"), context.input) };
}

/** POST /Order/{orderId}/sendViaEmail: stores the mail and marks the order as sent (send type VM). */
export function sendOrderViaEmail(context: RouteContext): RouteResult {
  const email = sendViaEmail(context.tenant, ORDER_SENDABLE, pathParam(context, "orderId"), context.input);
  return { status: 201, objects: email };
}

/** GET /Order/{orderId}/getPdf: the spec says it "commits the order" unless preventSendBy=true. */
export function getOrderPdf(context: RouteContext): RouteResult {
  const { tenant, query } = context;
  const order = tenant.store.collection(ORDER).require(pathParam(context, "orderId"));
  const committed = commitOnDownload(tenant, ORDER_SENDABLE, order, query);
  return { objects: pdfFile(renderOrder(tenant, committed)) };
}

/** PUT /Order/{orderId}/changeParameter: validates key and value, returns the re-rendered document. */
export function changeOrderParameter(context: RouteContext): RouteResult {
  const order = context.tenant.store.collection(ORDER).require(pathParam(context, "orderId"));
  return { objects: changeLayout(renderOrder(context.tenant, order), context.input) };
}

/** Renders the deterministic placeholder PDF of an order (see shared/rendering.ts). */
function renderOrder(tenant: Tenant, order: Doc): RenderedDocument {
  return renderDocument(tenant, order, {
    numberField: "orderNumber",
    numberLabel: "Nummer",
    dateField: "orderDate",
    dateLabel: "Datum",
    fallbackName: `Order-${order.id}`,
    positions: orderPositions(tenant, order.id),
  });
}
