import { ApiError } from "../../lib/errors.ts";
import { parseDateInput } from "../../lib/time.ts";
import { pathParam } from "../../routes/context.ts";
import { deleteModel } from "../../routes/generic.ts";
import type { RouteContext, RouteDefinition, RouteResult } from "../../routes/types.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { CHECK_ACCOUNT_TRANSACTION } from "../shared/checkAccounts.ts";
import { createDocument, updateDocument } from "../shared/documents.ts";
import { isTrue } from "../shared/list.ts";
import { refId } from "../shared/refs.ts";
import { invalidParameter, isBlank, missingParameters, validationError } from "../shared/validation.ts";
import { balanceAt } from "./transactions.ts";

const MODEL = "CheckAccount";

const IMPORT_TYPES: readonly string[] = ["CSV", "MT940"];

/** Fields every check account response carries; the factories fill what they do not know. */
const ACCOUNT_DEFAULTS = {
  currency: "EUR",
  defaultAccount: "0",
  baseAccount: "0",
  status: 100,
  balance: 0,
  autoMapTransactions: "0",
} as const;

function readName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw missingParameters(["name"]);
  return value;
}

/**
 * Default accounting numbers when the client omits one (spec: nullable, "Ignore to use a
 * sensible default"). Assumption: the lowest free number from the spec examples upwards,
 * 1800 (bank, SKR04) for file import accounts and 3320 (SKR04) for clearing accounts.
 */
const DEFAULT_ACCOUNTING_NUMBER = { fileImport: 1800, clearing: 3320 } as const;

function isNumberTaken(tenant: Tenant, number: string): boolean {
  return (
    tenant.store.collection(MODEL).findOne((account) => String(account.accountingNumber) === number) !==
    undefined
  );
}

/**
 * The accounting number is optional; a given one must be numeric and unique over all
 * check accounts (spec), a missing one is the next free number from the default upwards.
 */
function readAccountingNumber(tenant: Tenant, value: unknown, fallbackStart: number): string {
  if (isBlank(value)) {
    let candidate = fallbackStart;
    while (isNumberTaken(tenant, String(candidate))) candidate++;
    return String(candidate);
  }
  const number = String(value);
  if (!/^\d+$/.test(number)) throw invalidParameter("accountingNumber", { status: 422 });
  if (isNumberTaken(tenant, number)) {
    // Assumption: the 422 wording is not verified; uniqueness is documented in the spec.
    throw validationError(`The accounting number ${number} is already used by another check account`);
  }
  return number;
}

/**
 * POST /CheckAccount/Factory/fileImportAccount: an "online" account fed by CSV or MT940
 * imports. Assumption: the import type is mandatory (spec lists CSV and MT940, 422 on others).
 */
export function createFileImportAccount(tenant: Tenant, input: Readonly<Record<string, unknown>>): Doc {
  const name = readName(input.name);
  const importType = input.importType;
  if (typeof importType !== "string" || !IMPORT_TYPES.includes(importType)) {
    throw invalidParameter("importType", { allowed: IMPORT_TYPES, status: 422 });
  }
  const accountingNumber = readAccountingNumber(
    tenant,
    input.accountingNumber,
    DEFAULT_ACCOUNTING_NUMBER.fileImport,
  );
  return createDocument(
    tenant,
    MODEL,
    {},
    {
      defaults: ACCOUNT_DEFAULTS,
      overrides: {
        name,
        type: "online",
        importType,
        accountingNumber,
        iban: typeof input.iban === "string" ? input.iban : null,
      },
    },
  );
}

/** POST /CheckAccount/Factory/clearingAccount: an "offline" clearing account. */
export function createClearingAccount(tenant: Tenant, input: Readonly<Record<string, unknown>>): Doc {
  const name = readName(input.name);
  const accountingNumber = readAccountingNumber(
    tenant,
    input.accountingNumber,
    DEFAULT_ACCOUNTING_NUMBER.clearing,
  );
  return createDocument(
    tenant,
    MODEL,
    {},
    { defaults: ACCOUNT_DEFAULTS, overrides: { name, type: "offline", accountingNumber } },
  );
}

function getBalanceAtDate(context: RouteContext): RouteResult {
  const { tenant, query } = context;
  const id = pathParam(context, "checkAccountId");
  tenant.store.collection(MODEL).require(id);
  if (isBlank(query.date)) throw missingParameters(["date"]);
  const day = parseDateInput(query.date);
  if (day === undefined) throw invalidParameter("date");
  return { objects: balanceAt(tenant, id, day) };
}

/**
 * DELETE /CheckAccount/{id}: 409 while transactions reference the account (the spec declares
 * 409 for all deletes), so that no transaction is left with a dangling account.
 * Assumption: sevDesk refuses instead of deleting the transactions; wording not verified.
 */
function deleteCheckAccount(context: RouteContext): RouteResult {
  const { tenant } = context;
  const id = pathParam(context, "checkAccountId");
  tenant.store.collection(MODEL).require(id);
  const hasTransactions = tenant.store
    .collection(CHECK_ACCOUNT_TRANSACTION)
    .findOne((transaction) => refId(transaction.checkAccount) === id);
  if (hasTransactions !== undefined) {
    throw new ApiError(409, "The check account has transactions and can not be deleted");
  }
  return deleteModel(context, MODEL, id);
}

/**
 * PUT /CheckAccount/{id}: generic merge, plus a single default account per client: setting
 * defaultAccount on one account clears it on the others. Assumption: sevDesk has at most one
 * default account; not verified.
 */
function updateCheckAccount(context: RouteContext): RouteResult {
  const { tenant } = context;
  const id = pathParam(context, "checkAccountId");
  const updated = updateDocument(tenant, MODEL, id, context.input);
  if (isTrue(updated.defaultAccount)) {
    const accounts = tenant.store.collection(MODEL);
    for (const other of accounts.find((account) => account.id !== id && isTrue(account.defaultAccount))) {
      accounts.update(other.id, { defaultAccount: typeof other.defaultAccount === "number" ? 0 : "0" });
    }
  }
  return { objects: updated };
}

export const checkAccountRoutes: readonly RouteDefinition[] = [
  { method: "PUT", path: "/CheckAccount/{checkAccountId}", handler: updateCheckAccount },
  { method: "DELETE", path: "/CheckAccount/{checkAccountId}", handler: deleteCheckAccount },
  {
    method: "POST",
    path: "/CheckAccount/Factory/fileImportAccount",
    handler: ({ tenant, input }) => ({ objects: createFileImportAccount(tenant, input) }),
  },
  {
    method: "POST",
    path: "/CheckAccount/Factory/clearingAccount",
    handler: ({ tenant, input }) => ({ objects: createClearingAccount(tenant, input) }),
  },
  { method: "GET", path: "/CheckAccount/{checkAccountId}/getBalanceAtDate", handler: getBalanceAtDate },
];
