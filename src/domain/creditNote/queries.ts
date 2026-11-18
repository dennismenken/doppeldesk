import { ApiError } from "../../lib/errors.ts";
import { parseDateInput } from "../../lib/time.ts";
import { listModel } from "../../routes/generic.ts";
import type { RouteContext, RouteResult } from "../../routes/types.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import {
  documentFilters,
  documentNumberFilter,
  documentSort,
  type ListedDocumentType,
} from "../shared/documentFilters.ts";
import { deleteWithDependents } from "../shared/documents.ts";
import { amountFilter } from "../shared/filters.ts";
import { isTrue } from "../shared/list.ts";
import { releaseNumber } from "../shared/numbering.ts";
import { isBlank } from "../shared/validation.ts";
import { CREDIT_NOTE, CREDIT_NOTE_PAYABLE, CREDIT_NOTE_POSITIONS } from "./constants.ts";
import { isDraft, isNetMode } from "./head.ts";

/**
 * Credit notes for the shared document filters. Assumption: credit notes carry no payment term
 * (no timeToPay in the spec model), so the due date is the credit note date.
 */
const LISTED_CREDIT_NOTE: ListedDocumentType = {
  payable: CREDIT_NOTE_PAYABLE,
  numberField: "creditNoteNumber",
  dateField: "creditNoteDate",
  dueDate: (doc) => parseDateInput(doc.creditNoteDate),
};

/**
 * GET /CreditNote with the filters of the spec's filter table (tag "CreditNote"). Equality
 * filters (status lists, creditNoteNumber, contact[id], origin[id], costCentre[id],
 * paymentMethod[id]) come from the generic list handling. onlyEnshrined keeps enshrined
 * credit notes, start/endAmount compare the net or gross sum depending on showNet.
 */
export function listCreditNotes(context: RouteContext): RouteResult {
  const { tenant, query } = context;
  const greater = documentNumberFilter("creditNoteNumber", "greater");
  const smaller = documentNumberFilter("creditNoteNumber", "smaller");
  return listModel(context, CREDIT_NOTE, {
    filters: {
      ...documentFilters(tenant, LISTED_CREDIT_NOTE),
      creditNoteNumberGreater: greater,
      creditNoteNumberSmaller: smaller,
      // The spec's filter table spells this one with a doubled "Number".
      creditNoteNumberNumberSmaller: smaller,
      onlyEnshrined: (doc, value) => !isTrue(value) || !isBlank(doc.enshrined),
      startAmount: amountFilter("min", isNetMode),
      endAmount: amountFilter("max", isNetMode),
      orderByCreditNoteNumber: null,
    },
    sort: documentSort(LISTED_CREDIT_NOTE, query, "orderByCreditNoteNumber"),
  });
}

/**
 * DELETE /CreditNote/{id}: only drafts (409 otherwise, the spec's "Conflict" case). Deletes
 * positions and tag relations and gives the number back; the range rolls back if it was the
 * last issued number (live-verified).
 */
export function deleteCreditNote(tenant: Tenant, id: string): void {
  const creditNote = tenant.store.collection(CREDIT_NOTE).require(id);
  if (!isDraft(creditNote)) throw new ApiError(409, "Only credit notes in draft status can be deleted");
  deleteWithDependents(tenant, CREDIT_NOTE, id, [
    { model: CREDIT_NOTE_POSITIONS.model, field: CREDIT_NOTE_POSITIONS.parentField },
  ]);
  if (typeof creditNote.creditNoteNumber === "string") {
    releaseNumber(tenant, "creditNote", creditNote.creditNoteNumber);
  }
}
