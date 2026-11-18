import { bookVoucherAmount, saveVoucher } from "../../domain/accounting/index.ts";
import { toRef } from "../../domain/shared/refs.ts";
import type { PlainObject } from "../../lib/object.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import type { DemoContacts } from "./contacts.ts";
import { factoryObject } from "./factory.ts";
import { CHECK_ACCOUNT, DEDUCTIBLE_EXPENSE_RULE_ID } from "./reference.ts";
import { dayBefore, enterDay } from "./timeline.ts";

/** Voucher status codes: draft, registered (unpaid). */
const DRAFT = 50;
const OPEN = 100;

/**
 * Assumption: the demo has no seeded AccountDatev master data; sevDesk accounts are
 * chart-of-accounts specific, so this id only stands for "some booking account".
 */
const BOOKING_ACCOUNT_ID = 1;

interface ExpenseInput {
  /** Days before the reference day. */
  day: number;
  status: typeof DRAFT | typeof OPEN;
  supplier: Doc;
  description: string;
  sumNet: number;
  taxRate: number;
  paymentDeadlineDays: number;
}

/** Three expense vouchers, created in date order: one paid in cash, one registered and unpaid, one draft. */
export function seedVouchers(tenant: Tenant, contacts: DemoContacts): void {
  const paid = expense(tenant, {
    day: 80,
    status: OPEN,
    supplier: contacts.papierkontor,
    description: "Fachbücher und Kalender",
    sumNet: 56.07,
    taxRate: 7,
    paymentDeadlineDays: 14,
  });
  payInCash(tenant, paid, 60);
  expense(tenant, {
    day: 40,
    status: OPEN,
    supplier: contacts.buerowelt,
    description: "Lizenz Büro-Software 2026",
    sumNet: 420,
    taxRate: 19,
    paymentDeadlineDays: 30,
  });
  expense(tenant, {
    day: 12,
    status: DRAFT,
    supplier: contacts.papierkontor,
    description: "Büromaterial September",
    sumNet: 84.03,
    taxRate: 19,
    paymentDeadlineDays: 14,
  });
}

/** Creates a voucher with one position through the saveVoucher factory. */
function expense(tenant: Tenant, input: ExpenseInput): Doc {
  enterDay(tenant, input.day);
  const position: PlainObject = {
    accountDatev: toRef(BOOKING_ACCOUNT_ID, "AccountDatev"),
    net: true,
    sumNet: input.sumNet,
    taxRate: input.taxRate,
    comment: input.description,
  };
  return saveVoucher(tenant, {
    voucher: factoryObject("Voucher", {
      voucherType: "VOU",
      creditDebit: "C",
      status: input.status,
      supplier: toRef(input.supplier.id, "Contact"),
      description: input.description,
      voucherDate: dayBefore(input.day),
      deliveryDate: dayBefore(input.day),
      paymentDeadline: dayBefore(input.day - input.paymentDeadlineDays),
      taxRule: toRef(DEDUCTIBLE_EXPENSE_RULE_ID, "TaxRule"),
      taxType: "default",
      currency: "EUR",
    }),
    voucherPosSave: [factoryObject("VoucherPos", position)],
  }).voucher;
}

/** Books the full payment of a voucher on the cash register through the voucher bookAmount service. */
function payInCash(tenant: Tenant, voucher: Doc, day: number): void {
  enterDay(tenant, day);
  bookVoucherAmount(tenant, voucher.id, {
    amount: voucher.sumGross,
    date: tenant.clock.unixNow(),
    type: "FULL_PAYMENT",
    checkAccount: toRef(CHECK_ACCOUNT.cash, "CheckAccount"),
  });
}
