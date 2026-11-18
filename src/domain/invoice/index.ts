import type { DomainModule } from "../../routes/types.ts";
import { invoiceRoutes } from "./routes.ts";

/** Invoices and their positions: saveInvoice factory, status transitions, booking, cancellation (SR), list filters. */
export const invoiceModule: DomainModule = {
  name: "invoice",
  models: ["Invoice", "InvoicePos", "InvoiceLog", "Discounts"],
  routes: invoiceRoutes,
};

// Services for seeds and other domain modules.
export { bookInvoiceAmount, isPartiallyPaid } from "./booking.ts";
export { cancelInvoice, cancellationOf } from "./cancellation.ts";
export { INVOICE_PAYABLE, INVOICE_SENDABLE, INVOICE_STATUS } from "./constants.ts";
export { createInvoiceFromOrder, createInvoiceReminder } from "./derived.ts";
export { createInvoice, type SavedInvoice, saveInvoice } from "./factory.ts";
export { normalizeHeader } from "./header.ts";
export { invoicePositions, invoiceTotals } from "./positions.ts";
export {
  deleteInvoice,
  enshrineInvoice,
  resetInvoiceToDraft,
  resetInvoiceToOpen,
  sendInvoice,
  sendInvoiceViaEmail,
} from "./status.ts";
