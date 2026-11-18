import {
  createCreditNoteFromInvoice,
  saveCreditNote,
  sendCreditNoteBy,
} from "../../domain/creditNote/index.ts";
import { toRef } from "../../domain/shared/refs.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import type { DemoContacts } from "./contacts.ts";
import { factoryObject } from "./factory.ts";
import type { DemoInvoices } from "./invoices.ts";
import { DOMESTIC, UNITY, USER_REF } from "./reference.ts";
import { dayBefore, enterDay } from "./timeline.ts";

/** Days before the reference day of the two credit notes. */
const FROM_INVOICE_DAY = 70;
const COMMISSION_DAY = 20;

/**
 * Two credit notes: one created from the paid demo invoice and sent (open), and a commission
 * credit note for Sonnenhof Biomarkt that stays a draft.
 */
export function seedCreditNotes(tenant: Tenant, contacts: DemoContacts, invoices: DemoInvoices): void {
  enterDay(tenant, FROM_INVOICE_DAY);
  const fromInvoice = createCreditNoteFromInvoice(tenant, {
    invoice: toRef(invoices.paid.id, "Invoice"),
  });
  sendCreditNoteBy(tenant, fromInvoice.creditNote.id, { sendType: "VPDF", sendDraft: false });

  enterDay(tenant, COMMISSION_DAY);
  saveCreditNote(tenant, {
    creditNote: factoryObject("CreditNote", {
      creditNoteDate: dayBefore(COMMISSION_DAY),
      contact: toRef(contacts.sonnenhof.id, "Contact"),
      contactPerson: USER_REF,
      bookingCategory: "PROVISION",
      taxRule: toRef(DOMESTIC.ruleId, "TaxRule"),
      taxType: DOMESTIC.taxType,
      taxRate: DOMESTIC.taxRate,
      taxText: DOMESTIC.taxText,
      currency: "EUR",
      showNet: true,
      headText: "Für die Vermittlung neuer Kunden im dritten Quartal schreiben wir Ihnen gut:",
    }),
    creditNotePosSave: [
      factoryObject("CreditNotePos", {
        name: "Vermittlungsprovision Q3 2026",
        quantity: 1,
        price: 320,
        taxRate: DOMESTIC.taxRate,
        unity: toRef(UNITY.flatRate, "Unity"),
      }),
    ],
    takeDefaultAddress: true,
  });
}
