import type { PlainObject } from "../../lib/object.ts";
import { toIso } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { patchDocument } from "../shared/documents.ts";
import { bookAmount, unlinkPayments } from "../shared/payments.ts";
import { sendBy, sendViaEmail, UNSENT_FIELDS } from "../shared/sending.ts";
import { isBlank, validationError } from "../shared/validation.ts";
import { CREDIT_NOTE, CREDIT_NOTE_PAYABLE, CREDIT_NOTE_SENDABLE, CREDIT_NOTE_STATUS } from "./constants.ts";
import { assertNotEnshrined, isDraft, statusOf } from "./head.ts";

/** PUT /CreditNote/{id}/sendBy (shared sending rules): a draft becomes open (200). */
export function sendCreditNoteBy(tenant: Tenant, id: string, input: PlainObject): Doc {
  return sendBy(tenant, CREDIT_NOTE_SENDABLE, id, input);
}

/** POST /CreditNote/{id}/sendViaEmail: marks the credit note as sent (VM) and stores an Email document. */
export function sendCreditNoteViaEmail(tenant: Tenant, id: string, input: PlainObject): PlainObject {
  return sendViaEmail(tenant, CREDIT_NOTE_SENDABLE, id, input);
}

/** PUT /CreditNote/{id}/bookAmount (shared booking rules); returns the CreditNoteLog entry. */
export function bookCreditNoteAmount(tenant: Tenant, id: string, input: PlainObject): PlainObject {
  return bookAmount(tenant, CREDIT_NOTE_PAYABLE, id, input);
}

/** PUT /CreditNote/{id}/enshrine: sets "enshrined" to now; only for status 200 or higher, irreversible. */
export function enshrineCreditNote(tenant: Tenant, id: string): Doc {
  const creditNote = tenant.store.collection(CREDIT_NOTE).require(id);
  if (statusOf(creditNote) < CREDIT_NOTE_STATUS.open) {
    throw validationError("A credit note can only be enshrined if its status is open (200) or higher");
  }
  if (!isBlank(creditNote.enshrined)) throw validationError("The credit note is already enshrined");
  return patchDocument(tenant, CREDIT_NOTE, id, { enshrined: toIso(tenant.clock.now()) });
}

/**
 * PUT /CreditNote/{id}/resetToOpen: back to 200, payments are unlinked. Not possible for
 * drafts (use sendBy), enshrined credit notes or credit notes with an enshrined transaction.
 * Assumption: payDate and paidAmount are cleared.
 */
export function resetCreditNoteToOpen(tenant: Tenant, id: string): Doc {
  const creditNote = tenant.store.collection(CREDIT_NOTE).require(id);
  assertNotEnshrined(creditNote);
  if (isDraft(creditNote)) {
    throw validationError("The status cannot be raised to open by resetToOpen, use sendBy or sendViaEmail");
  }
  unlinkPayments(tenant, CREDIT_NOTE_PAYABLE, id);
  return patchDocument(tenant, CREDIT_NOTE, id, {
    status: String(CREDIT_NOTE_STATUS.open),
    payDate: null,
    paidAmount: 0,
  });
}

/**
 * PUT /CreditNote/{id}/resetToDraft: only from open (200) and not enshrined; higher states
 * need resetToOpen first. Assumption: the draft is unsent again (sendType, sendDate cleared).
 */
export function resetCreditNoteToDraft(tenant: Tenant, id: string): Doc {
  const creditNote = tenant.store.collection(CREDIT_NOTE).require(id);
  assertNotEnshrined(creditNote);
  if (statusOf(creditNote) !== CREDIT_NOTE_STATUS.open) {
    throw validationError("Only open credit notes (status 200) can be reset to draft, use resetToOpen first");
  }
  unlinkPayments(tenant, CREDIT_NOTE_PAYABLE, id);
  return patchDocument(tenant, CREDIT_NOTE, id, {
    status: String(CREDIT_NOTE_STATUS.draft),
    ...UNSENT_FIELDS,
  });
}
