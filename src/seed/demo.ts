import { syncBalance } from "../domain/shared/checkAccounts.ts";
import type { Tenant } from "../tenant/tenant.ts";
import { seedBasic } from "./basic.ts";
import { seedContacts } from "./demo/contacts.ts";
import { seedCreditNotes } from "./demo/creditNotes.ts";
import { seedInvoices } from "./demo/invoices.ts";
import { seedOrders } from "./demo/orders.ts";
import { seedParts } from "./demo/parts.ts";
import { CHECK_ACCOUNT } from "./demo/reference.ts";
import { seedVouchers } from "./demo/vouchers.ts";

/**
 * Basic seed plus a small synthetic business dataset (contacts, parts, orders, invoices in
 * every status, credit notes, vouchers, bank transactions). Documents are created through the
 * domain services, with the tenant clock frozen on fixed days in 2026 (see demo/timeline.ts),
 * so numbers, sums and relations are consistent and the result never depends on the real time.
 * The clock returns to its previous state afterwards.
 */
export function seedDemo(tenant: Tenant): void {
  seedBasic(tenant);
  const previousClock = tenant.clock.state;
  try {
    const contacts = seedContacts(tenant);
    const parts = seedParts(tenant);
    const orders = seedOrders(tenant, contacts, parts);
    const invoices = seedInvoices(tenant, contacts, parts, orders);
    seedCreditNotes(tenant, contacts, invoices);
    seedVouchers(tenant, contacts);
    for (const accountId of Object.values(CHECK_ACCOUNT)) syncBalance(tenant, accountId);
  } finally {
    tenant.clock.restore(previousClock);
  }
}
