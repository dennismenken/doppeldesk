import type { DateTime } from "luxon";
import type { PlainObject } from "../../lib/object.ts";
import { parseDateInput, startOfBerlinDay, toIso } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import {
  BOOKED_TRANSACTION_STATUS,
  CHECK_ACCOUNT,
  CHECK_ACCOUNT_TRANSACTION,
  CREATED_TRANSACTION_STATUS,
  createPaymentTransaction,
  createsOwnTransactions,
  syncBalance,
} from "./checkAccounts.ts";
import { contactName, contactOf } from "./contacts.ts";
import { createDocument, patchDocument } from "./documents.ts";
import { MONEY_TOLERANCE, roundMoney, toNumber } from "./money.ts";
import { isRefTo, readRef, refId, toRef } from "./refs.ts";
import {
  expectedRefError,
  invalidParameter,
  isBlank,
  isOneOf,
  missingParameters,
  validationError,
} from "./validation.ts";

/** Booking types of bookAmount (spec enum): full payment, partial ("N") and difference reasons. */
export const BOOKING_TYPES = ["FULL_PAYMENT", "N", "CB", "CF", "O", "OF", "MTC"] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

/**
 * Difference reasons (cash discount, currency fluctuation, other, other with fee, money
 * transit costs) book the difference away. Assumption: like FULL_PAYMENT they settle the
 * document even when the amount is below the open sum.
 */
const SETTLING_TYPES: readonly BookingType[] = ["FULL_PAYMENT", "CB", "CF", "O", "OF", "MTC"];

/**
 * How the booked amount must relate to the open amount per booking type. Help center:
 * an amount that differs from the open amount needs a difference reason, a partial
 * payment cannot exceed the open amount. The direction of CB/MTC (reduced) and OF (higher)
 * follows the spec descriptions; O and CF allow both. Assumption: violations are 422.
 */
const AMOUNT_RULES: Readonly<Record<BookingType, "equal" | "atMost" | "atLeast" | "any">> = {
  FULL_PAYMENT: "equal",
  N: "atMost",
  CB: "atMost",
  MTC: "atMost",
  OF: "atLeast",
  O: "any",
  CF: "any",
};

/**
 * Body fields of bookAmount the request value check skips: the spec declares "date" as integer
 * (unix timestamp, live-verified), DoppelDesk also reads the other date inputs (parseDateInput).
 */
export const BOOK_AMOUNT_UNVALIDATED_FIELDS: readonly string[] = ["date"];

/** Log fields that only serve unlinking and are not part of the API response. */
const INTERNAL_LOG_FIELDS = ["checkAccount", "checkAccountTransaction", "transactionCreated"] as const;

/** How bookAmount works for one document model (invoice, credit note, voucher). */
export interface PayableModel {
  /** Collection of the documents, e.g. "Invoice". */
  model: string;
  /** Collection of the booking log, e.g. "InvoiceLog". */
  logModel: string;
  /** Log field referencing the document (the spec names it "creditNote" in the InvoiceLog too). */
  logRef: string;
  /** Spelling of the amount field in the log ("ammountPayed" for invoices and credit notes). */
  logAmountField: string;
  /** Booking types the document supports (CF is not supported for credit notes and vouchers). */
  bookingTypes: readonly BookingType[];
  /** Statuses from which a booking is possible. */
  bookableStatuses: readonly number[];
  paidStatus: number;
  partiallyPaidStatus: number;
  /** +1 when money arrives on the account (income), -1 when it leaves (expense). */
  direction(document: Doc): 1 | -1;
  /** Purpose text of an automatically created transaction. */
  purpose(document: Doc): string | null;
  /** Name of the payee or payer of an automatically created transaction. */
  payee(tenant: Tenant, document: Doc): string;
}

/**
 * True for the partially paid status and for bookable (open) documents with payments; paid
 * documents count as not partially paid (spec of GET /Invoice/{id}/getIsPartiallyPaid).
 */
export function isPartiallyPaid(payable: PayableModel, document: Doc): boolean {
  const status = toNumber(document.status);
  if (status === payable.partiallyPaidStatus) return true;
  if (status === payable.paidStatus) return false;
  return toNumber(document.paidAmount) > 0;
}

/** Validated bookAmount body. */
interface BookingRequest {
  amount: number;
  date: DateTime;
  type: BookingType;
  account: Doc;
  transaction: Doc | undefined;
}

/**
 * PUT /<Model>/{id}/bookAmount for all payable documents. Body (live-verified for invoices):
 * amount, date (unix timestamp), type, checkAccount {id, objectName}; optional
 * checkAccountTransaction.
 * - Unknown check account or transaction: 404 "No Model_<X> with the id <id> was found" (live).
 * - Offline and register accounts get an automatically created transaction (spec); online
 *   accounts need an existing transaction of that account (spec: "you must provide a transaction").
 * - FULL_PAYMENT sets the paid status and payDate to the Berlin calendar day of the booking
 *   date (live for invoices). "N" below the open sum gives the partially paid status
 *   (spec 750); the difference reasons settle the document (assumption).
 * - The amount must fit the booking type (AMOUNT_RULES), otherwise 422.
 * Returns the public log entry.
 */
export function bookAmount(
  tenant: Tenant,
  payable: PayableModel,
  id: string,
  input: PlainObject,
): PlainObject {
  const document = tenant.store.collection(payable.model).require(id);
  const request = readBookingRequest(tenant, payable, input);
  const fromStatus = toNumber(document.status);
  if (!payable.bookableStatuses.includes(fromStatus)) {
    throw validationError(
      `Only documents with status ${payable.bookableStatuses.join(" or ")} can be booked, the status is ${fromStatus}`,
    );
  }

  assertAmountFitsType(request, openAmount(document));
  const created = request.transaction === undefined;
  const transaction = linkOrCreateTransaction(tenant, payable, document, request);
  const paidAmount = roundMoney(toNumber(document.paidAmount) + request.amount);
  const settled =
    SETTLING_TYPES.includes(request.type) ||
    Math.abs(paidAmount) + MONEY_TOLERANCE >= Math.abs(toNumber(document.sumGross));
  const toStatus = settled ? payable.paidStatus : payable.partiallyPaidStatus;
  patchDocument(tenant, payable.model, document.id, {
    status: storedStatus(document, toStatus),
    paidAmount,
    payDate: settled ? toIso(startOfBerlinDay(request.date)) : null,
  });
  const log = createDocument(tenant, payable.logModel, {
    additionalInformation: null,
    [payable.logRef]: toRef(document.id, payable.model),
    fromStatus,
    toStatus,
    [payable.logAmountField]: request.amount,
    bookingDate: toIso(request.date),
    checkAccount: toRef(request.account.id, CHECK_ACCOUNT),
    checkAccountTransaction: toRef(transaction.id, CHECK_ACCOUNT_TRANSACTION),
    transactionCreated: created,
  });
  return publicLog(log);
}

/**
 * Detaches all payments of a document (resetToOpen/resetToDraft: "Linked transactions will
 * be unlinked"). Transactions created by bookAmount are removed, linked transactions return
 * to status 100; balances are recomputed. The log entries stay as history. Throws 422 when
 * a linked transaction is enshrined (spec).
 */
export function unlinkPayments(tenant: Tenant, payable: PayableModel, documentId: string): void {
  const logs = tenant.store.collection(payable.logModel);
  const transactions = tenant.store.collection(CHECK_ACCOUNT_TRANSACTION);
  const linked = logs
    .find((log) => isRefTo(log[payable.logRef], payable.model, documentId))
    .flatMap((log) => {
      const transactionId = refId(log.checkAccountTransaction);
      return transactionId === undefined ? [] : [{ log, transaction: transactions.get(transactionId) }];
    });
  if (linked.some(({ transaction }) => !isBlank(transaction?.enshrined))) {
    throw validationError("A linked transaction is enshrined, the payments can not be unlinked");
  }
  for (const { log, transaction } of linked) {
    if (transaction !== undefined) {
      if (log.transactionCreated === true) transactions.delete(transaction.id);
      else transactions.update(transaction.id, { status: CREATED_TRANSACTION_STATUS });
      const accountId = refId(transaction.checkAccount);
      if (accountId !== undefined) syncBalance(tenant, accountId);
    }
    logs.update(log.id, { checkAccountTransaction: null });
  }
}

/** Gross amount still to be paid (sign-independent: credit notes and SR carry negative sums). */
function openAmount(document: Doc): number {
  return roundMoney(Math.abs(toNumber(document.sumGross)) - Math.abs(toNumber(document.paidAmount)));
}

/** 422 when the amount does not fit the booking type (see AMOUNT_RULES). */
function assertAmountFitsType(request: BookingRequest, open: number): void {
  const rule = AMOUNT_RULES[request.type];
  const below = request.amount < open - MONEY_TOLERANCE;
  const above = request.amount > open + MONEY_TOLERANCE;
  const violated =
    (rule === "equal" && (below || above)) || (rule === "atMost" && above) || (rule === "atLeast" && below);
  if (!violated) return;
  const expected = { equal: "equal to", atMost: "at most", atLeast: "at least", any: "" }[rule];
  throw validationError(
    `The amount ${request.amount} must be ${expected} the open amount ${open} for booking type ${request.type}`,
  );
}

/** Writes a status in the representation the document already uses (number or numeric string). */
export function storedStatus(document: Doc, status: number): number | string {
  return typeof document.status === "number" ? status : String(status);
}

function readBookingRequest(tenant: Tenant, payable: PayableModel, input: PlainObject): BookingRequest {
  const missing = ["amount", "date", "type", "checkAccount"].filter((key) => isBlank(input[key]));
  if (missing.length > 0) throw missingParameters(missing);
  const amount = toNumber(input.amount, Number.NaN);
  // Assumption: only positive amounts can be booked (the spec does not describe refunds here).
  if (!Number.isFinite(amount) || amount <= 0) throw invalidParameter("amount");
  const date = parseDateInput(input.date);
  if (date === undefined) throw invalidParameter("date");
  if (!isOneOf(BOOKING_TYPES, input.type)) throw invalidParameter("type", { allowed: BOOKING_TYPES });
  if (!payable.bookingTypes.includes(input.type)) {
    throw invalidParameter("type", { allowed: payable.bookingTypes, status: 422 });
  }
  const accountRef = readRef(input.checkAccount, CHECK_ACCOUNT);
  if (accountRef === undefined || accountRef.objectName !== CHECK_ACCOUNT) {
    throw expectedRefError("checkAccount", input.checkAccount);
  }
  const account = tenant.store.collection(CHECK_ACCOUNT).require(accountRef.id);
  return {
    amount: roundMoney(amount),
    date,
    type: input.type,
    account,
    transaction: readTransaction(tenant, account, input.checkAccountTransaction),
  };
}

/** The given transaction (must exist and belong to the account), or undefined when none is given. */
function readTransaction(tenant: Tenant, account: Doc, value: unknown): Doc | undefined {
  if (isBlank(value)) return undefined;
  const ref = readRef(value, CHECK_ACCOUNT_TRANSACTION);
  if (ref === undefined || ref.objectName !== CHECK_ACCOUNT_TRANSACTION) {
    throw expectedRefError("checkAccountTransaction", value);
  }
  const transaction = tenant.store.collection(CHECK_ACCOUNT_TRANSACTION).require(ref.id);
  if (refId(transaction.checkAccount) !== account.id) {
    throw validationError("The transaction does not belong to the given check account");
  }
  return transaction;
}

/** Links the given transaction (status booked) or creates one on clearing and register accounts. */
function linkOrCreateTransaction(
  tenant: Tenant,
  payable: PayableModel,
  document: Doc,
  request: BookingRequest,
): Doc {
  const transactions = tenant.store.collection(CHECK_ACCOUNT_TRANSACTION);
  if (request.transaction !== undefined) {
    return (
      transactions.update(request.transaction.id, { status: BOOKED_TRANSACTION_STATUS }) ??
      request.transaction
    );
  }
  if (!createsOwnTransactions(request.account)) {
    // Assumption: wording and status of the "logic error" the spec mentions for online accounts.
    throw validationError(
      "A check account transaction is required to book on a check account of type online",
    );
  }
  return createPaymentTransaction(tenant, {
    account: request.account,
    amount: payable.direction(document) * request.amount,
    date: toIso(request.date),
    purpose: payable.purpose(document),
    payeePayerName: payable.payee(tenant, document),
  });
}

function publicLog(log: Doc): PlainObject {
  const result: PlainObject = { ...log };
  for (const field of INTERNAL_LOG_FIELDS) delete result[field];
  return result;
}

/** Payee name of a document's contact (shared default for PayableModel.payee). */
export function contactPayee(field: string): (tenant: Tenant, document: Doc) => string {
  return (tenant, document) => contactName(contactOf(tenant, document[field]));
}
