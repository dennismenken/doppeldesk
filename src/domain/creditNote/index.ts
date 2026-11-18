import type { DomainModule } from "../../routes/types.ts";
import { CREDIT_NOTE, CREDIT_NOTE_LOG, CREDIT_NOTE_POS } from "./constants.ts";
import { creditNoteRoutes } from "./routes.ts";

export { CREDIT_NOTE_PAYABLE, CREDIT_NOTE_SENDABLE } from "./constants.ts";
export {
  bookCreditNoteAmount,
  enshrineCreditNote,
  resetCreditNoteToDraft,
  resetCreditNoteToOpen,
  sendCreditNoteBy,
  sendCreditNoteViaEmail,
} from "./lifecycle.ts";
export { recalculateCreditNote } from "./positions.ts";
export { insertCreditNote, type SavedCreditNote, saveCreditNote } from "./save.ts";
export { createCreditNoteFromInvoice, createCreditNoteFromVoucher } from "./sources.ts";

/** Credit notes and their positions: saveCreditNote, createFromInvoice/createFromVoucher, status transitions, booking, draft deletion. */
export const creditNoteModule: DomainModule = {
  name: "creditNote",
  models: [CREDIT_NOTE, CREDIT_NOTE_POS, CREDIT_NOTE_LOG],
  routes: creditNoteRoutes,
};
