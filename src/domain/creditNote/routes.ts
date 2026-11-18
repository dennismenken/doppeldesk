import { pathParam } from "../../routes/context.ts";
import { getModel, listModel } from "../../routes/generic.ts";
import type { RouteDefinition } from "../../routes/types.ts";
import { BOOK_AMOUNT_UNVALIDATED_FIELDS } from "../shared/payments.ts";
import { documentPositionOrder } from "../shared/positions.ts";
import { CREDIT_NOTE, CREDIT_NOTE_POS, CREDIT_NOTE_POSITIONS } from "./constants.ts";
import {
  bookCreditNoteAmount,
  enshrineCreditNote,
  resetCreditNoteToDraft,
  resetCreditNoteToOpen,
  sendCreditNoteBy,
  sendCreditNoteViaEmail,
} from "./lifecycle.ts";
import { deleteCreditNote, listCreditNotes } from "./queries.ts";
import { changeCreditNoteParameter, getCreditNotePdf, renderCreditNoteWithSendType } from "./render.ts";
import { saveCreditNote, updateCreditNoteHead } from "./save.ts";
import { createCreditNoteFromInvoice, createCreditNoteFromVoucher } from "./sources.ts";

const ID = "creditNoteId";

/** All routes of the credit note module; each replaces the generic route with the same key. */
export const creditNoteRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/CreditNote",
    handler: listCreditNotes,
  },
  {
    method: "POST",
    path: "/CreditNote/Factory/saveCreditNote",
    handler: (context) => ({ objects: saveCreditNote(context.tenant, context.input) }),
  },
  {
    method: "POST",
    path: "/CreditNote/Factory/createFromInvoice",
    handler: (context) => ({
      objects: { ...createCreditNoteFromInvoice(context.tenant, context.input), discount: [] },
    }),
  },
  {
    method: "POST",
    path: "/CreditNote/Factory/createFromVoucher",
    handler: (context) => ({
      objects: { ...createCreditNoteFromVoucher(context.tenant, context.input), discount: [] },
    }),
  },
  {
    method: "GET",
    path: `/CreditNote/{${ID}}`,
    handler: (context) => getModel(context, CREDIT_NOTE, pathParam(context, ID)),
  },
  {
    method: "PUT",
    path: `/CreditNote/{${ID}}`,
    handler: (context) => ({
      objects: updateCreditNoteHead(context.tenant, pathParam(context, ID), context.input),
    }),
  },
  {
    method: "DELETE",
    path: `/CreditNote/{${ID}}`,
    handler: (context) => {
      deleteCreditNote(context.tenant, pathParam(context, ID));
      return { objects: [null] };
    },
  },
  {
    method: "PUT",
    path: `/CreditNote/{${ID}}/sendBy`,
    handler: (context) => ({
      objects: sendCreditNoteBy(context.tenant, pathParam(context, ID), context.input),
    }),
  },
  {
    method: "POST",
    path: `/CreditNote/{${ID}}/sendViaEmail`,
    handler: (context) => ({
      objects: sendCreditNoteViaEmail(context.tenant, pathParam(context, ID), context.input),
    }),
  },
  {
    method: "PUT",
    path: `/CreditNote/{${ID}}/enshrine`,
    handler: (context) => {
      enshrineCreditNote(context.tenant, pathParam(context, ID));
      // The spec declares {"objects": null} for this endpoint (like for invoices).
      return { objects: null };
    },
  },
  {
    method: "PUT",
    path: `/CreditNote/{${ID}}/bookAmount`,
    unvalidatedFields: BOOK_AMOUNT_UNVALIDATED_FIELDS,
    handler: (context) => ({
      objects: bookCreditNoteAmount(context.tenant, pathParam(context, ID), context.input),
    }),
  },
  {
    method: "PUT",
    path: `/CreditNote/{${ID}}/resetToOpen`,
    handler: (context) => ({ objects: resetCreditNoteToOpen(context.tenant, pathParam(context, ID)) }),
  },
  {
    method: "PUT",
    path: `/CreditNote/{${ID}}/resetToDraft`,
    handler: (context) => ({ objects: resetCreditNoteToDraft(context.tenant, pathParam(context, ID)) }),
  },
  {
    method: "GET",
    path: `/CreditNote/{${ID}}/getPdf`,
    handler: (context) => ({
      objects: getCreditNotePdf(context.tenant, pathParam(context, ID), context.query),
    }),
  },
  {
    method: "GET",
    path: `/CreditNote/{${ID}}/sendByWithRender`,
    handler: (context) => ({
      objects: renderCreditNoteWithSendType(context.tenant, pathParam(context, ID), context.query),
    }),
  },
  {
    method: "PUT",
    path: `/CreditNote/{${ID}}/changeParameter`,
    handler: (context) => ({
      objects: changeCreditNoteParameter(context.tenant, pathParam(context, ID), context.input),
    }),
  },
  {
    method: "GET",
    path: "/CreditNotePos",
    handler: (context) =>
      listModel(context, CREDIT_NOTE_POS, { sort: documentPositionOrder(CREDIT_NOTE_POSITIONS) }),
  },
];
