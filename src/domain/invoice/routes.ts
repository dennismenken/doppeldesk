import { pathParam } from "../../routes/context.ts";
import { listModel } from "../../routes/generic.ts";
import type { RouteContext, RouteDefinition } from "../../routes/types.ts";
import { listDocuments } from "../shared/list.ts";
import { BOOK_AMOUNT_UNVALIDATED_FIELDS } from "../shared/payments.ts";
import { documentPositionOrder } from "../shared/positions.ts";
import { changeLayout, pdfFile, renderResult } from "../shared/rendering.ts";
import { commitOnDownload } from "../shared/sending.ts";
import { bookInvoiceAmount, isPartiallyPaid } from "./booking.ts";
import { cancelInvoice } from "./cancellation.ts";
import { INVOICE_POS, INVOICE_POSITIONS, INVOICE_SENDABLE } from "./constants.ts";
import { createInvoiceFromOrder, createInvoiceReminder } from "./derived.ts";
import { SAVE_INVOICE_UNVALIDATED_FIELDS, saveInvoice } from "./factory.ts";
import { requireInvoice } from "./guards.ts";
import { listInvoices } from "./listing.ts";
import { invoicePositions } from "./positions.ts";
import { renderInvoice, renderInvoiceXml } from "./rendering.ts";
import {
  deleteInvoice,
  enshrineInvoice,
  resetInvoiceToDraft,
  resetInvoiceToOpen,
  sendInvoice,
  sendInvoiceViaEmail,
} from "./status.ts";

const invoiceId = (context: RouteContext) => pathParam(context, "invoiceId");

/** All Invoice and InvoicePos routes with domain behavior. GET /Invoice/{id} stays generic. */
export const invoiceRoutes: readonly RouteDefinition[] = [
  { method: "GET", path: "/Invoice", handler: listInvoices },
  {
    method: "POST",
    path: "/Invoice/Factory/saveInvoice",
    unvalidatedFields: SAVE_INVOICE_UNVALIDATED_FIELDS,
    factoryParts: [
      { field: "invoice", responseField: "invoice" },
      { field: "invoicePosSave", responseField: "invoicePos" },
      { field: "discountSave" },
    ],
    handler: (context) => ({ status: 201, objects: saveInvoice(context.tenant, context.input) }),
  },
  {
    method: "DELETE",
    path: "/Invoice/{invoiceId}",
    handler: (context) => {
      deleteInvoice(context.tenant, invoiceId(context));
      return { objects: [null] };
    },
  },
  {
    method: "GET",
    path: "/Invoice/{invoiceId}/getPositions",
    handler: (context) => {
      const invoice = requireInvoice(context.tenant, invoiceId(context));
      return listDocuments(invoicePositions(context.tenant, invoice.id), context.query, {
        store: context.tenant.store,
      });
    },
  },
  {
    method: "GET",
    path: "/InvoicePos",
    handler: (context) => listModel(context, INVOICE_POS, { sort: documentPositionOrder(INVOICE_POSITIONS) }),
  },
  {
    method: "PUT",
    path: "/Invoice/{invoiceId}/sendBy",
    handler: (context) => ({ objects: sendInvoice(context.tenant, invoiceId(context), context.input) }),
  },
  {
    method: "POST",
    path: "/Invoice/{invoiceId}/sendViaEmail",
    handler: (context) => ({
      objects: sendInvoiceViaEmail(context.tenant, invoiceId(context), context.input),
    }),
  },
  {
    method: "PUT",
    path: "/Invoice/{invoiceId}/enshrine",
    handler: (context) => {
      enshrineInvoice(context.tenant, invoiceId(context));
      // The spec declares {"objects": null} for this endpoint.
      return { objects: null };
    },
  },
  {
    method: "PUT",
    path: "/Invoice/{invoiceId}/bookAmount",
    unvalidatedFields: BOOK_AMOUNT_UNVALIDATED_FIELDS,
    handler: (context) => ({ objects: bookInvoiceAmount(context.tenant, invoiceId(context), context.input) }),
  },
  {
    method: "PUT",
    path: "/Invoice/{invoiceId}/resetToOpen",
    handler: (context) => ({ objects: resetInvoiceToOpen(context.tenant, invoiceId(context)) }),
  },
  {
    method: "PUT",
    path: "/Invoice/{invoiceId}/resetToDraft",
    handler: (context) => ({ objects: resetInvoiceToDraft(context.tenant, invoiceId(context)) }),
  },
  {
    method: "POST",
    path: "/Invoice/{invoiceId}/cancelInvoice",
    handler: (context) => ({ status: 201, objects: cancelInvoice(context.tenant, invoiceId(context)) }),
  },
  {
    method: "GET",
    path: "/Invoice/{invoiceId}/getIsPartiallyPaid",
    handler: (context) => ({ objects: isPartiallyPaid(requireInvoice(context.tenant, invoiceId(context))) }),
  },
  {
    method: "GET",
    path: "/Invoice/{invoiceId}/getPdf",
    handler: (context) => {
      const invoice = requireInvoice(context.tenant, invoiceId(context));
      const committed = commitOnDownload(context.tenant, INVOICE_SENDABLE, invoice, context.query);
      return { objects: pdfFile(renderInvoice(context.tenant, committed)) };
    },
  },
  {
    method: "GET",
    path: "/Invoice/{invoiceId}/getXml",
    handler: (context) => {
      const invoice = requireInvoice(context.tenant, invoiceId(context));
      return { objects: renderInvoiceXml(context.tenant, invoice) };
    },
  },
  {
    method: "POST",
    path: "/Invoice/{invoiceId}/render",
    handler: (context) => {
      const invoice = requireInvoice(context.tenant, invoiceId(context));
      return { status: 201, objects: renderResult(renderInvoice(context.tenant, invoice)) };
    },
  },
  {
    method: "PUT",
    path: "/Invoice/{invoiceId}/changeParameter",
    handler: (context) => {
      const invoice = requireInvoice(context.tenant, invoiceId(context));
      return { objects: changeLayout(renderInvoice(context.tenant, invoice), context.input) };
    },
  },
  {
    method: "POST",
    path: "/Invoice/Factory/createInvoiceFromOrder",
    handler: (context) => ({ objects: createInvoiceFromOrder(context.tenant, context.input).invoice }),
  },
  {
    method: "POST",
    path: "/Invoice/Factory/createInvoiceReminder",
    handler: (context) => ({
      objects: createInvoiceReminder(context.tenant, context.input, context.query).invoice,
    }),
  },
];
