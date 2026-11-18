import type { PlainObject } from "../../lib/object.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { createDocument } from "./documents.ts";
import { roundMoney, toNumber } from "./money.ts";
import { refId, toRef } from "./refs.ts";

export const CHECK_ACCOUNT = "CheckAccount";
export const CHECK_ACCOUNT_TRANSACTION = "CheckAccountTransaction";

/**
 * Transaction status "booked" (help center: the transaction becomes "Gebucht").
 * Assumption: API status 400 for automatically created and for linked transactions.
 */
export const BOOKED_TRANSACTION_STATUS = 400;
/** Status of an imported transaction that is not linked to any document. */
export const CREATED_TRANSACTION_STATUS = 100;

/** Check account types on which sevDesk creates booking transactions itself (spec). */
const SELF_BOOKING_TYPES: readonly string[] = ["offline", "register"];

/**
 * True when booking a document on the account creates the transaction automatically
 * (clearing and register accounts). Assumption: accounts without type count as offline.
 */
export function createsOwnTransactions(account: Doc): boolean {
  const type = account.type;
  return typeof type !== "string" || type === "" || SELF_BOOKING_TYPES.includes(type);
}

/** Amount of a stored transaction as number (0 when unusable). */
export function transactionAmount(transaction: Readonly<PlainObject>): number {
  return toNumber(transaction.amount);
}

/**
 * Recomputes the "balance" of a check account as the sum of all its transactions
 * (assumption: sevDesk balances only know the transactions stored in sevDesk).
 */
export function syncBalance(tenant: Tenant, accountId: string): void {
  const total = tenant.store
    .collection(CHECK_ACCOUNT_TRANSACTION)
    .find((transaction) => refId(transaction.checkAccount) === accountId)
    .reduce((sum, transaction) => sum + transactionAmount(transaction), 0);
  tenant.store.collection(CHECK_ACCOUNT).update(accountId, { balance: roundMoney(total) });
}

/** Describes a payment that is booked onto a clearing or register account. */
export interface PaymentInput {
  /** The check account the money moves on. */
  account: Doc;
  /** Signed amount: negative for money leaving the account. */
  amount: number;
  /** Booking date, ISO 8601. */
  date: string;
  purpose: string | null;
  payeePayerName: string;
}

/**
 * Creates the transaction sevDesk generates when a document is booked on a clearing or
 * register account and updates the account balance. Assumption: status 400 (booked),
 * entryDate equals valueDate.
 */
export function createPaymentTransaction(tenant: Tenant, input: PaymentInput): Doc {
  const transaction = createDocument(tenant, CHECK_ACCOUNT_TRANSACTION, {
    valueDate: input.date,
    entryDate: input.date,
    paymtPurpose: input.purpose,
    amount: roundMoney(input.amount),
    payeePayerName: input.payeePayerName,
    payeePayerAcctNo: null,
    payeePayerBankCode: null,
    checkAccount: toRef(input.account.id, CHECK_ACCOUNT),
    status: BOOKED_TRANSACTION_STATUS,
    sourceTransaction: null,
    targetTransaction: null,
    enshrined: null,
  });
  syncBalance(tenant, input.account.id);
  return transaction;
}
