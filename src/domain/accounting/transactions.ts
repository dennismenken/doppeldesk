import type { DateTime } from "luxon";
import { ApiError } from "../../lib/errors.ts";
import type { PlainObject } from "../../lib/object.ts";
import { BERLIN_ZONE, parseDateInput, toIso, toIsoDate } from "../../lib/time.ts";
import { pathParam } from "../../routes/context.ts";
import { listModel } from "../../routes/generic.ts";
import type { RouteContext, RouteDefinition, RouteResult } from "../../routes/types.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import {
  CHECK_ACCOUNT,
  CHECK_ACCOUNT_TRANSACTION,
  syncBalance,
  transactionAmount,
} from "../shared/checkAccounts.ts";
import { createDocument, patchDocument, updateDocument } from "../shared/documents.ts";
import { anyDateFilter, containsFilter } from "../shared/filters.ts";
import { isTrue } from "../shared/list.ts";
import { roundMoney, toNumber } from "../shared/money.ts";
import { referencesTo, referencingModels } from "../shared/references.ts";
import { refId } from "../shared/refs.ts";
import { blankFields, invalidParameter, missingParameters, validationError } from "../shared/validation.ts";
import { dateField, refField } from "./common.ts";

/** Request status values for transactions: created, linked, private, booked. */
const REQUEST_STATUSES: readonly number[] = [100, 200, 300, 400];

/** Status "booked" and "auto-booked without user confirmation". */
const BOOKED_STATUSES: ReadonlySet<number> = new Set([350, 400]);

const REQUIRED_FIELDS = ["valueDate", "checkAccount", "amount", "status", "payeePayerName"] as const;

/** Fields a booking depends on; they stay fixed while a document is booked on the transaction. */
const BOOKED_FIELDS = ["amount", "checkAccount", "valueDate", "status"] as const;

/** Field of the booking logs (InvoiceLog, CreditNoteLog, VoucherLog) that links the transaction. */
const BOOKING_LINK_FIELD = "checkAccountTransaction";

/** Sum of the transactions of an account with a value date up to the end of the given day (Berlin). */
export function balanceAt(tenant: Tenant, accountId: string, day: DateTime): number {
  const limit = day.setZone(BERLIN_ZONE).endOf("day").toMillis();
  const total = tenant.store
    .collection(CHECK_ACCOUNT_TRANSACTION)
    .find((transaction) => refId(transaction.checkAccount) === accountId)
    .filter((transaction) => {
      const value = parseDateInput(transaction.valueDate)?.toMillis();
      return value !== undefined && value <= limit;
    })
    .reduce((sum, transaction) => sum + transactionAmount(transaction), 0);
  return roundMoney(total);
}

/** Normalizes the fields of a create or update body that need conversion; absent keys stay absent. */
function normalizeFields(tenant: Tenant, input: PlainObject): PlainObject {
  const result: PlainObject = { ...input };
  if ("valueDate" in input) result.valueDate = dateField(input.valueDate, "valueDate");
  if ("entryDate" in input) result.entryDate = dateField(input.entryDate, "entryDate");
  if ("amount" in input) {
    const amount = toNumber(input.amount, Number.NaN);
    if (!Number.isFinite(amount)) throw invalidParameter("amount");
    result.amount = amount;
  }
  if ("status" in input) {
    const status = Number(input.status);
    if (!REQUEST_STATUSES.includes(status)) {
      throw invalidParameter("status", { allowed: REQUEST_STATUSES, status: 422 });
    }
    result.status = status;
  }
  if ("checkAccount" in input) {
    const account = refField(input.checkAccount, CHECK_ACCOUNT);
    if (account === null) throw missingParameters(["checkAccount"]);
    tenant.store.collection(CHECK_ACCOUNT).require(account.id);
    result.checkAccount = account;
  }
  for (const key of ["sourceTransaction", "targetTransaction"] as const) {
    if (key in input) result[key] = refField(input[key], CHECK_ACCOUNT_TRANSACTION);
  }
  return result;
}

function createTransaction(context: RouteContext): RouteResult {
  const { tenant, input } = context;
  const missing = blankFields(input, REQUIRED_FIELDS);
  if (missing.length > 0) throw missingParameters(missing);
  const fields = normalizeFields(tenant, input);
  const transaction = createDocument(tenant, CHECK_ACCOUNT_TRANSACTION, fields, {
    defaults: { enshrined: null },
  });
  syncBalance(tenant, refId(transaction.checkAccount) ?? "");
  return { objects: transaction };
}

/**
 * A transaction a document is booked on (bookAmount) keeps amount, account, value date and
 * status until the document is reset (resetToOpen/resetToDraft unlink it): 422, so that the
 * paid amount of the document and the account balance stay consistent.
 * Assumption: sevDesk refuses such changes; status and wording are not verified.
 */
function assertBookedFieldsUnchanged(tenant: Tenant, existing: Doc, fields: PlainObject): void {
  const booked = referencesTo(tenant, CHECK_ACCOUNT_TRANSACTION, existing.id).some(
    (reference) => reference.field === BOOKING_LINK_FIELD,
  );
  if (!booked) return;
  const changed = BOOKED_FIELDS.filter(
    (field) => field in fields && comparable(field, fields[field]) !== comparable(field, existing[field]),
  );
  if (changed.length > 0) {
    throw validationError(
      `The transaction is booked on a document, ${changed.join(", ")} can not be changed until the document is reset`,
    );
  }
}

/**
 * Comparable form of a booked field value: the account by id, the value date by Berlin
 * calendar day (updates store it at day precision), amount and status numerically.
 */
function comparable(field: (typeof BOOKED_FIELDS)[number], value: unknown): string {
  if (field === "checkAccount") return refId(value) ?? "";
  if (field === "valueDate") {
    const date = parseDateInput(value);
    return date === undefined ? "" : toIsoDate(date);
  }
  return String(toNumber(value, Number.NaN));
}

function updateTransaction(context: RouteContext): RouteResult {
  const { tenant, input } = context;
  const id = pathParam(context, "checkAccountTransactionId");
  const existing = tenant.store.collection(CHECK_ACCOUNT_TRANSACTION).require(id);
  if (existing.enshrined) throw validationError("The transaction is enshrined and can not be changed");
  const fields = normalizeFields(tenant, input);
  assertBookedFieldsUnchanged(tenant, existing, fields);
  const updated = updateDocument(tenant, CHECK_ACCOUNT_TRANSACTION, id, fields);
  for (const accountId of new Set([refId(existing.checkAccount), refId(updated.checkAccount)])) {
    if (accountId !== undefined) syncBalance(tenant, accountId);
  }
  return { objects: updated };
}

function deleteTransaction(context: RouteContext): RouteResult {
  const { tenant } = context;
  const id = pathParam(context, "checkAccountTransactionId");
  const collection = tenant.store.collection(CHECK_ACCOUNT_TRANSACTION);
  const existing = collection.require(id);
  if (existing.enshrined) throw validationError("The transaction is enshrined and can not be deleted");
  // The spec declares 409 for this DELETE. Assumption: a transaction a document is booked on
  // (or another transaction refers to) can not be deleted; the wording is not verified.
  const references = referencesTo(tenant, CHECK_ACCOUNT_TRANSACTION, id);
  if (references.length > 0) {
    throw new ApiError(
      409,
      `The transaction is linked to ${referencingModels(references)} and can not be deleted`,
    );
  }
  collection.delete(id);
  const accountId = refId(existing.checkAccount);
  if (accountId !== undefined) syncBalance(tenant, accountId);
  return { objects: [null] };
}

/**
 * PUT /CheckAccountTransaction/{id}/enshrine: from status 200, only once (422); the spec
 * declares {"objects": null}. Assumption: the 422 wording; the rule "from status 200" is documented.
 */
function enshrineTransaction(context: RouteContext): RouteResult {
  const { tenant } = context;
  const id = pathParam(context, "checkAccountTransactionId");
  const existing = tenant.store.collection(CHECK_ACCOUNT_TRANSACTION).require(id);
  if (existing.enshrined) throw validationError("The transaction is already enshrined");
  if (Number(existing.status) < 200) {
    throw validationError("Only linked transactions (status 200 or higher) can be enshrined");
  }
  patchDocument(tenant, CHECK_ACCOUNT_TRANSACTION, id, { enshrined: toIso(tenant.clock.now()) });
  return { objects: null };
}

function listTransactions(context: RouteContext): RouteResult {
  const amountFilter = (predicate: (amount: number) => boolean) => (doc: Doc, value: unknown) =>
    !isTrue(value) || predicate(transactionAmount(doc));
  return listModel(context, CHECK_ACCOUNT_TRANSACTION, {
    filters: {
      isBooked: (doc, value) => !isTrue(value) || BOOKED_STATUSES.has(Number(doc.status)),
      paymtPurpose: containsFilter("paymtPurpose"),
      payeePayerName: containsFilter("payeePayerName"),
      startDate: anyDateFilter("valueDate", ">="),
      endDate: anyDateFilter("valueDate", "<="),
      onlyCredit: amountFilter((amount) => amount > 0),
      onlyDebit: amountFilter((amount) => amount < 0),
    },
  });
}

export const transactionRoutes: readonly RouteDefinition[] = [
  { method: "GET", path: "/CheckAccountTransaction", handler: listTransactions },
  { method: "POST", path: "/CheckAccountTransaction", handler: createTransaction },
  { method: "PUT", path: "/CheckAccountTransaction/{checkAccountTransactionId}", handler: updateTransaction },
  {
    method: "DELETE",
    path: "/CheckAccountTransaction/{checkAccountTransactionId}",
    handler: deleteTransaction,
  },
  {
    method: "PUT",
    path: "/CheckAccountTransaction/{checkAccountTransactionId}/enshrine",
    handler: enshrineTransaction,
  },
];
