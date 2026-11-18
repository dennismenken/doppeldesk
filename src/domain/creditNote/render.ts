import type { PlainObject } from "../../lib/object.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import {
  changeLayout,
  pdfFile,
  type RenderedDocument,
  renderDocument,
  renderResult,
} from "../shared/rendering.ts";
import { commitOnDownload } from "../shared/sending.ts";
import { isBlank, missingParameters } from "../shared/validation.ts";
import { CREDIT_NOTE, CREDIT_NOTE_SENDABLE } from "./constants.ts";
import { creditNotePositions } from "./positions.ts";

/** Renders the deterministic placeholder PDF of a credit note (see shared/rendering.ts). */
function renderCreditNote(tenant: Tenant, creditNote: Doc): RenderedDocument {
  return renderDocument(tenant, creditNote, {
    numberField: "creditNoteNumber",
    numberLabel: "Gutschriftnummer",
    dateField: "creditNoteDate",
    dateLabel: "Gutschriftdatum",
    fallbackName: `CreditNote-${creditNote.id}`,
    positions: creditNotePositions(tenant, creditNote.id),
  });
}

/** GET /CreditNote/{id}/getPdf: like invoices, a draft is marked as sent (VPDF) unless preventSendBy=true. */
export function getCreditNotePdf(tenant: Tenant, id: string, query: PlainObject): PlainObject {
  const creditNote = tenant.store.collection(CREDIT_NOTE).require(id);
  const committed = commitOnDownload(tenant, CREDIT_NOTE_SENDABLE, creditNote, query);
  return pdfFile(renderCreditNote(tenant, committed));
}

/**
 * GET /CreditNote/{id}/sendByWithRender?sendType=...: renders the PDF. Assumption: like a
 * GET it does not change status or sendType, sendBy is needed for that.
 */
export function renderCreditNoteWithSendType(tenant: Tenant, id: string, query: PlainObject): PlainObject {
  const creditNote = tenant.store.collection(CREDIT_NOTE).require(id);
  if (isBlank(query.sendType)) throw missingParameters(["sendType"]);
  return renderResult(renderCreditNote(tenant, creditNote));
}

/** PUT /CreditNote/{id}/changeParameter: validates key and value, returns the re-rendered document. */
export function changeCreditNoteParameter(tenant: Tenant, id: string, input: PlainObject): PlainObject {
  const creditNote = tenant.store.collection(CREDIT_NOTE).require(id);
  return changeLayout(renderCreditNote(tenant, creditNote), input);
}
