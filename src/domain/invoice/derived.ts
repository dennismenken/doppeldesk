import { isPlainObject, type PlainObject } from "../../lib/object.ts";
import { startOfBerlinDay, toIso } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { ORDER, ORDER_STATUS, orderPositions, setOrderStatus } from "../order/index.ts";
import { patchDocument } from "../shared/documents.ts";
import { isTrue } from "../shared/list.ts";
import { MONEY_TOLERANCE, roundMoney, toNumber } from "../shared/money.ts";
import { isRefTo, toRef } from "../shared/refs.ts";
import {
  invalidParameter,
  isBlank,
  isOneOf,
  missingParameters,
  requireRefTo,
  validationError,
} from "../shared/validation.ts";
import { cancellationOf } from "./cancellation.ts";
import { INVOICE, INVOICE_STATUS } from "./constants.ts";
import { createInvoice, type SavedInvoice } from "./factory.ts";
import { requireInvoice, statusOf, typeOf } from "./guards.ts";

/** Header fields an invoice takes over from its order. */
const ORDER_HEADER_FIELDS = [
  "contact",
  "contactPerson",
  "address",
  "addressCountry",
  "smallSettlement",
  "taxRate",
  "taxRule",
  "taxSet",
  "taxText",
  "taxType",
  "currency",
  "showNet",
  "headText",
  "footText",
  "customerInternalNote",
] as const;

/** Position fields an invoice position takes over from an order position. */
const ORDER_POSITION_FIELDS = [
  "part",
  "quantity",
  "price",
  "name",
  "unity",
  "text",
  "discount",
  "taxRate",
] as const;

/** partialType values: spec enum RE, TR, AR; the spec prose also names ER (final invoice). */
const PARTIAL_TYPES = ["RE", "TR", "AR", "ER"] as const;

/** Amount types of a partial invoice (spec enum of createInvoiceFromOrder "type"). */
const AMOUNT_TYPES = ["percentage", "net", "gross"] as const;

/** Assumption: payment deadline of a reminder, in days after its creation. */
const REMINDER_DEADLINE_DAYS = 14;

/**
 * POST /Invoice/Factory/createInvoiceFromOrder. Reads the order and its positions
 * from the store (collections "Order" and "OrderPos") and creates a draft invoice with
 * origin on the order. Without "type"/"amount" all non-optional positions are taken
 * over. Assumptions: "percentage" scales every position price, "net"/"gross" create a
 * single position over the amount with the tax rate of the first order position.
 */
export function createInvoiceFromOrder(tenant: Tenant, input: PlainObject): SavedInvoice {
  const orderRef = requireRefTo("order", input.order, ORDER);
  const order = tenant.store.collection(ORDER).require(orderRef.id);
  const partialType = input.partialType ?? "RE";
  if (!isOneOf(PARTIAL_TYPES, partialType)) throw invalidParameter("partialType", { allowed: PARTIAL_TYPES });
  const partial = readPartialAmount(tenant, order, input);

  const sourcePositions = orderPositions(tenant, order.id).filter((pos) => !isTrue(pos.optional));
  const header: PlainObject = {};
  for (const field of ORDER_HEADER_FIELDS) {
    if (order[field] !== undefined) header[field] = order[field];
  }
  header.invoiceType = partialType;
  header.origin = toRef(order.id, ORDER);

  let positions = sourcePositions.map((pos) => pick(pos, ORDER_POSITION_FIELDS));
  if (partial?.type === "percentage") {
    const { amount } = partial;
    positions = positions.map((pos) => ({ ...pos, price: roundMoney((toNumber(pos.price) * amount) / 100) }));
  } else if (partial !== undefined) {
    header.showNet = partial.type === "net";
    positions = [
      {
        name: `${partialType === "AR" ? "Abschlagsrechnung" : "Teilrechnung"} zu Auftrag ${String(order.orderNumber ?? order.id)}`,
        quantity: 1,
        price: partial.amount,
        taxRate: sourcePositions[0]?.taxRate ?? order.taxRate ?? 0,
      },
    ];
  }

  const saved = createInvoice(tenant, header, positions);
  // Spec order status table: 750 "partially calculated", 1000 "calculated".
  // Assumption: TR/AR invoices set 750, RE/ER set 1000.
  const partiallyCalculated = partialType === "TR" || partialType === "AR";
  setOrderStatus(
    tenant,
    order.id,
    partiallyCalculated ? ORDER_STATUS.partiallyCalculated : ORDER_STATUS.calculated,
  );
  return saved;
}

/** Partial amount of createInvoiceFromOrder: "percentage" of the order or a "net"/"gross" amount. */
interface PartialAmount {
  type: (typeof AMOUNT_TYPES)[number];
  amount: number;
}

/**
 * Reads "type" and "amount" of createInvoiceFromOrder; undefined when neither is given (the
 * invoice takes over all positions). type and amount belong together (400 when one is
 * missing or unreadable). Assumptions (Update 2.0 forbids inconsistent partial invoices; the
 * exact rules and messages are not verified): the amount must be positive and must not exceed
 * what is left of the order (422). What is left is the order sum minus the invoices already
 * created from it (without cancelled ones), net for "net" and "percentage", gross for "gross".
 */
function readPartialAmount(tenant: Tenant, order: Doc, input: PlainObject): PartialAmount | undefined {
  if (isBlank(input.type) && isBlank(input.amount)) return undefined;
  if (isBlank(input.type)) throw missingParameters(["type"]);
  if (!isOneOf(AMOUNT_TYPES, input.type)) throw invalidParameter("type", { allowed: AMOUNT_TYPES });
  if (isBlank(input.amount)) throw missingParameters(["amount"]);
  const amount = toNumber(input.amount, Number.NaN);
  if (!Number.isFinite(amount)) throw invalidParameter("amount");
  if (amount <= 0) throw validationError("The amount of a partial invoice must be greater than 0");

  const field = input.type === "gross" ? "sumGross" : "sumNet";
  const orderTotal = toNumber(order[field]);
  const invoiced = tenant.store
    .collection(INVOICE)
    .find(
      (invoice) =>
        isRefTo(invoice.origin, ORDER, order.id) &&
        typeOf(invoice) !== "SR" &&
        cancellationOf(tenant, invoice.id) === undefined,
    )
    .reduce((sum, invoice) => sum + toNumber(invoice[field]), 0);
  const remaining = roundMoney(orderTotal - invoiced);
  const requested = input.type === "percentage" ? (orderTotal * amount) / 100 : amount;
  if (requested > remaining + MONEY_TOLERANCE) {
    throw validationError(
      `The ${input.type} amount ${amount} exceeds what is left of the order (${field} ${remaining})`,
    );
  }
  return { type: input.type, amount };
}

/**
 * POST /Invoice/Factory/createInvoiceReminder. Creates a payment reminder (MA) for an
 * open invoice: origin on the invoice, dunningLevel counting up, one position over the
 * open gross amount. The invoice comes from the body or the query (both declared).
 * Assumptions: only open or partially paid invoices can be dunned, the position carries
 * tax rate 0 (the open amount already includes tax, so no tax text), deadline 14 days, no reminder charge
 * (Update 2.0 forbids reminderCharge > 0), the original invoice takes over the dunningLevel.
 */
export function createInvoiceReminder(tenant: Tenant, input: PlainObject, query: PlainObject): SavedInvoice {
  const source = isPlainObject(input.invoice) ? input.invoice : query.invoice;
  const invoice = requireInvoice(tenant, requireRefTo("invoice", source, INVOICE).id);
  const status = statusOf(invoice);
  if (
    typeOf(invoice) === "SR" ||
    (status !== INVOICE_STATUS.open && status !== INVOICE_STATUS.partiallyPaid)
  ) {
    throw validationError("Only open invoices can be dunned");
  }

  const dunningLevel =
    tenant.store
      .collection(INVOICE)
      .find((doc) => typeOf(doc) === "MA" && isRefTo(doc.origin, INVOICE, invoice.id)).length + 1;
  const openAmount = roundMoney(toNumber(invoice.sumGross) - toNumber(invoice.paidAmount));
  const today = startOfBerlinDay(tenant.clock.now());
  const header: PlainObject = {
    contact: invoice.contact ?? null,
    contactPerson: invoice.contactPerson ?? null,
    address: invoice.address ?? null,
    addressCountry: invoice.addressCountry ?? null,
    currency: invoice.currency ?? "EUR",
    taxRule: invoice.taxRule ?? null,
    // The reminder charges no tax (rate 0), so the tax text of the invoice does not apply.
    taxText: null,
    taxType: invoice.taxType ?? null,
    taxRate: 0,
    showNet: false,
    invoiceType: "MA",
    origin: toRef(invoice.id, INVOICE),
    dunningLevel,
    reminderDebit: openAmount,
    reminderTotal: openAmount,
    reminderCharge: 0,
    reminderDeadline: toIso(today.plus({ days: REMINDER_DEADLINE_DAYS })),
  };
  const position = {
    name: `Offener Betrag aus Rechnung Nr. ${String(invoice.invoiceNumber ?? invoice.id)}`,
    quantity: 1,
    price: openAmount,
    taxRate: 0,
  };
  const saved = createInvoice(tenant, header, [position]);
  patchDocument(tenant, INVOICE, invoice.id, { dunningLevel });
  return saved;
}

function pick(doc: Doc, fields: readonly string[]): PlainObject {
  return Object.fromEntries(
    fields.filter((field) => doc[field] !== undefined).map((field) => [field, doc[field]]),
  );
}
