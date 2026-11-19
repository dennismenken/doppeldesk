import type { PlainObject } from "../lib/object.ts";
import type { Tenant } from "../tenant/tenant.ts";
import { checkAccount, insertSeedObjects, seedNone } from "./none.ts";

/**
 * Additional synthetic payment accounts of the basic seed (the base account comes from the
 * "none" seed). Assumption: names, ids and the bank data below are invented.
 */
const ADDITIONAL_CHECK_ACCOUNTS: readonly PlainObject[] = [
  {
    id: "2",
    name: "Musterbank Geschäftskonto",
    iban: "DE00000000000000000000",
    type: "online",
    defaultAccount: "0",
    baseAccount: "0",
    priority: "1",
    accountingNumber: "1800",
    bic: "MUSTDEFFXXX",
  },
  {
    id: "3",
    name: "Kasse",
    iban: null,
    type: "register",
    defaultAccount: "0",
    baseAccount: "0",
    priority: "2",
    accountingNumber: "1000",
    bic: null,
  },
];

/** Seed "basic": the "none" seed plus an online bank account and a register. */
export function seedBasic(tenant: Tenant): void {
  seedNone(tenant);
  insertSeedObjects(tenant, "CheckAccount", ADDITIONAL_CHECK_ACCOUNTS.map(checkAccount));
}
