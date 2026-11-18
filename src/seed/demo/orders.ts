import {
  createOrderWithPositions,
  deriveOrder,
  ORDER_SENDABLE,
  ORDER_STATUS,
  setOrderStatus,
} from "../../domain/order/index.ts";
import { peekNumber } from "../../domain/shared/numbering.ts";
import { readRef, toRef } from "../../domain/shared/refs.ts";
import { markSent } from "../../domain/shared/sending.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { type DemoContacts, postalAddress } from "./contacts.ts";
import { type DemoParts, partPosition } from "./parts.ts";
import { DOMESTIC, USER_REF } from "./reference.ts";
import { dayBefore, enterDay } from "./timeline.ts";

/** The order chain of the demo: an estimate, the order confirmation derived from it and the delivery note. */
export interface DemoOrders {
  offer: Doc;
  confirmation: Doc;
  deliveryNote: Doc;
}

/** Days before the reference day of each step of the chain. */
const OFFER_DAY = 150;
const ACCEPTED_DAY = 146;
const CONFIRMATION_DAY = 145;
const DELIVERY_DAY = 62;

/**
 * Estimate (AN) for Sonnenhof Biomarkt, sent as PDF and accepted, then the order confirmation (AB)
 * derived from it and sent by mail, then the delivery note (LI) derived from the confirmation.
 */
export function seedOrders(tenant: Tenant, contacts: DemoContacts, parts: DemoParts): DemoOrders {
  const orders = tenant.store.collection("Order");
  const { address, country } = postalAddress(tenant, contacts.sonnenhof);

  enterDay(tenant, OFFER_DAY);
  const created = createOrderWithPositions(
    tenant,
    {
      orderType: "AN",
      contact: toRef(contacts.sonnenhof.id, "Contact"),
      contactPerson: USER_REF,
      orderDate: dayBefore(OFFER_DAY),
      address,
      addressCountry: readRef(country, "StaticCountry"),
      taxRule: toRef(DOMESTIC.ruleId, "TaxRule"),
      taxType: DOMESTIC.taxType,
      taxRate: DOMESTIC.taxRate,
      taxText: DOMESTIC.taxText,
      currency: "EUR",
      showNet: true,
      version: 0,
      header: `Angebot Nr. ${peekNumber(tenant, "offer")}`,
      headText: "Vielen Dank für Ihre Anfrage. Gern bieten wir Ihnen an:",
      footText: "Das Angebot ist 30 Tage gültig.",
      paymentTerms: "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
    },
    [partPosition(parts.notebook, 60), partPosition(parts.coffee, 40), partPosition(parts.book, 10)],
  );
  markSent(tenant, ORDER_SENDABLE, created.order, "VPDF");
  enterDay(tenant, ACCEPTED_DAY);
  const offer = requireDoc(setOrderStatus(tenant, created.order.id, ORDER_STATUS.accepted));

  enterDay(tenant, CONFIRMATION_DAY);
  const derived = deriveOrder(tenant, offer, "AB");
  markSent(tenant, ORDER_SENDABLE, derived.order, "VM");
  const confirmation = orders.require(derived.order.id);

  enterDay(tenant, DELIVERY_DAY);
  const delivery = deriveOrder(tenant, confirmation, "LI");
  markSent(tenant, ORDER_SENDABLE, delivery.order, "VP");

  return { offer, confirmation, deliveryNote: orders.require(delivery.order.id) };
}

function requireDoc(doc: Doc | undefined): Doc {
  if (doc === undefined) throw new Error("Demo order disappeared while seeding");
  return doc;
}
