import {
  bookInvoiceAmount,
  cancelInvoice,
  createInvoiceFromOrder,
  enshrineInvoice,
  saveInvoice,
  sendInvoice,
  sendInvoiceViaEmail,
} from "../../domain/invoice/index.ts";
import { toNumber } from "../../domain/shared/money.ts";
import { toRef } from "../../domain/shared/refs.ts";
import type { PlainObject } from "../../lib/object.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { insertBankTransaction } from "./bank.ts";
import { type DemoContacts, primaryEmail } from "./contacts.ts";
import { factoryObject } from "./factory.ts";
import type { DemoOrders } from "./orders.ts";
import { type DemoParts, partPosition } from "./parts.ts";
import { CHECK_ACCOUNT, DOMESTIC, NOT_TAXABLE_ABROAD, type TaxRegime, USER_REF } from "./reference.ts";
import { dayBefore, enterDay } from "./timeline.ts";

/** Invoices of the demo that other demo documents build on. */
export interface DemoInvoices {
  /** A fully paid invoice with several tax rates, the source of the demo credit note. */
  paid: Doc;
}

/** Payment terms and texts of every demo invoice. */
const TIME_TO_PAY_DAYS = 14;
const HEAD_TEXT = "Vielen Dank für Ihren Auftrag. Wir berechnen Ihnen folgende Leistungen:";
const FOOT_TEXT = "Bitte überweisen Sie den Betrag innerhalb von 14 Tagen ohne Abzug.";

interface InvoiceInput {
  /** Days before the reference day. */
  day: number;
  customer: Doc;
  positions: readonly PlainObject[];
  regime?: TaxRegime;
  /** False for gross prices (private customers). */
  showNet?: boolean;
}

interface PaymentInput {
  /** Days before the reference day. */
  day: number;
  type: "FULL_PAYMENT" | "N";
  /** Account the payment is booked on; online accounts need the imported transaction. */
  account: string;
  /** Amount of a partial payment; a full payment books the gross sum. */
  amount?: number;
  transaction?: Doc;
}

/**
 * Eight invoices in every status, created in date order: paid (1), paid through the bank
 * account (2), cancelled with its cancellation invoice (3), partially paid (4), open (5, 6, 8)
 * and draft (7). Invoice 5 is derived from the order confirmation.
 */
export function seedInvoices(
  tenant: Tenant,
  contacts: DemoContacts,
  parts: DemoParts,
  orders: DemoOrders,
): DemoInvoices {
  const invoices = tenant.store.collection("Invoice");

  // 1: web design for Nordlicht, paid in full on the clearing account, then enshrined.
  const first = draftInvoice(tenant, {
    day: 140,
    customer: contacts.nordlicht,
    positions: [partPosition(parts.webdesign, 24), partPosition(parts.consulting, 2)],
  });
  send(tenant, first, "VPDF");
  const firstPaid = pay(tenant, first, { day: 120, type: "FULL_PAYMENT", account: CHECK_ACCOUNT.clearing });
  enterDay(tenant, 119);
  enshrineInvoice(tenant, firstPaid.id);

  // 2: Rheinwerk, three tax rates and a position discount, sent by mail, paid by bank transfer.
  const paid = draftInvoice(tenant, {
    day: 115,
    customer: contacts.rheinwerk,
    positions: [
      partPosition(parts.consulting, 3, { overrides: { discount: 10 } }),
      partPosition(parts.maintenance, 6),
      partPosition(parts.book, 5),
    ],
  });
  sendByMail(tenant, paid, contacts.rheinwerk);
  const transfer = insertBankTransaction(tenant, {
    day: 100,
    amount: toNumber(paid.sumGross),
    payeePayerName: "Rheinwerk Maschinenbau GmbH",
    purpose: `${String(paid.invoiceNumber)} Rechnung`,
  });
  pay(tenant, paid, { day: 100, type: "FULL_PAYMENT", account: CHECK_ACCOUNT.bank, transaction: transfer });

  // 3: goods for Sonnenhof, cancelled again (the cancellation invoice is created with it).
  const cancelled = draftInvoice(tenant, {
    day: 95,
    customer: contacts.sonnenhof,
    positions: [partPosition(parts.notebook, 40), partPosition(parts.coffee, 25)],
  });
  send(tenant, cancelled, "VP");
  enterDay(tenant, 85);
  cancelInvoice(tenant, cancelled.id);

  // 4: services for Helvetia (customer abroad, no tax), partially paid by bank transfer.
  const partial = draftInvoice(tenant, {
    day: 75,
    customer: contacts.helvetia,
    regime: NOT_TAXABLE_ABROAD,
    positions: [
      partPosition(parts.maintenance, 6, { overrides: { taxRate: 0 } }),
      partPosition(parts.consulting, 4, { overrides: { taxRate: 0 } }),
    ],
  });
  send(tenant, partial, "VPDF");

  // 5: invoice for the order confirmation of Sonnenhof, sent by mail and still open.
  enterDay(tenant, 60);
  const fromOrder = completeDraft(
    tenant,
    createInvoiceFromOrder(tenant, { order: toRef(orders.confirmation.id, "Order") }).invoice,
  );
  sendByMail(tenant, fromOrder, contacts.sonnenhof);

  const instalment = insertBankTransaction(tenant, {
    day: 50,
    amount: 2000,
    payeePayerName: "Helvetia Datenservice AG",
    purpose: `${String(partial.invoiceNumber)} Anzahlung`,
  });
  pay(tenant, partial, {
    day: 50,
    type: "N",
    amount: 2000,
    account: CHECK_ACCOUNT.bank,
    transaction: instalment,
  });

  // 6: Rheinwerk again, open; the matching bank transaction arrived but is not linked yet.
  const open = draftInvoice(tenant, {
    day: 35,
    customer: contacts.rheinwerk,
    positions: [partPosition(parts.consulting, 2), partPosition(parts.webdesign, 10)],
  });
  send(tenant, open, "VPDF");

  // 7: a draft for Nordlicht.
  draftInvoice(tenant, {
    day: 8,
    customer: contacts.nordlicht,
    positions: [partPosition(parts.maintenance, 3)],
  });
  insertBankTransaction(tenant, {
    day: 4,
    amount: toNumber(open.sumGross),
    payeePayerName: "Rheinwerk Maschinenbau GmbH",
    purpose: `${String(open.invoiceNumber)} Rechnung`,
  });

  // 8: private customer with gross prices, sent by post and open.
  const gross = draftInvoice(tenant, {
    day: 3,
    customer: contacts.keller,
    showNet: false,
    positions: [
      partPosition(parts.coffee, 3, { gross: true }),
      partPosition(parts.notebook, 5, { gross: true }),
    ],
  });
  send(tenant, gross, "VP");

  return { paid: invoices.require(paid.id) };
}

/** Creates a draft through the saveInvoice factory (header, positions, default address of the contact). */
function draftInvoice(tenant: Tenant, input: InvoiceInput): Doc {
  enterDay(tenant, input.day);
  const regime = input.regime ?? DOMESTIC;
  const saved = saveInvoice(tenant, {
    invoice: factoryObject("Invoice", {
      invoiceType: "RE",
      contact: toRef(input.customer.id, "Contact"),
      contactPerson: USER_REF,
      invoiceDate: dayBefore(input.day),
      deliveryDate: dayBefore(input.day + 7),
      deliveryDateUntil: dayBefore(input.day),
      discount: 0,
      timeToPay: TIME_TO_PAY_DAYS,
      taxRule: toRef(regime.ruleId, "TaxRule"),
      taxType: regime.taxType,
      taxRate: regime.taxRate,
      taxText: regime.taxText,
      currency: "EUR",
      showNet: input.showNet ?? true,
      headText: HEAD_TEXT,
      footText: FOOT_TEXT,
    }),
    invoicePosSave: input.positions.map((position) => factoryObject("InvoicePos", position)),
    takeDefaultAddress: true,
  });
  return saved.invoice;
}

/**
 * Fills in what the order does not carry (payment terms, texts) through a saveInvoice update,
 * as a user does before sending, so the invoice looks like the other demo invoices.
 */
function completeDraft(tenant: Tenant, invoice: Doc): Doc {
  return saveInvoice(tenant, {
    invoice: factoryObject("Invoice", {
      id: invoice.id,
      timeToPay: TIME_TO_PAY_DAYS,
      headText: HEAD_TEXT,
      footText: FOOT_TEXT,
    }),
  }).invoice;
}

/** sendBy: the draft becomes open and carries the send type. */
function send(tenant: Tenant, invoice: Doc, sendType: "VPR" | "VP" | "VM" | "VPDF"): Doc {
  return sendInvoice(tenant, invoice.id, { sendType, sendDraft: false });
}

/** sendViaEmail: the draft becomes open, the mail is stored as Email document. */
function sendByMail(tenant: Tenant, invoice: Doc, customer: Doc): void {
  sendInvoiceViaEmail(tenant, invoice.id, {
    toEmail: primaryEmail(tenant, customer),
    subject: `Rechnung ${String(invoice.invoiceNumber)}`,
    text: "Guten Tag,\n\nanbei erhalten Sie unsere Rechnung.\n\nFreundliche Grüße\nMax Mustermann",
  });
}

/** Books a payment; a full payment books the gross sum of the invoice. */
function pay(tenant: Tenant, invoice: Doc, payment: PaymentInput): Doc {
  enterDay(tenant, payment.day);
  bookInvoiceAmount(tenant, invoice.id, {
    amount: payment.amount ?? toNumber(invoice.sumGross),
    date: dayBefore(payment.day),
    type: payment.type,
    checkAccount: toRef(payment.account, "CheckAccount"),
    ...(payment.transaction === undefined
      ? {}
      : { checkAccountTransaction: toRef(payment.transaction.id, "CheckAccountTransaction") }),
  });
  return tenant.store.collection("Invoice").require(invoice.id);
}
