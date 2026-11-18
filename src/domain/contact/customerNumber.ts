import type { Tenant } from "../../tenant/tenant.ts";
import { NUMBER_RANGES, nextNumber } from "../shared/numbering.ts";
import { textValue } from "./validation.ts";

/** Customer numbers currently used by contacts of the tenant. */
export function usedCustomerNumbers(tenant: Tenant, exceptId?: string): Set<string> {
  const used = new Set<string>();
  for (const contact of tenant.store.collection("Contact").all()) {
    if (contact.id === exceptId) continue;
    const number = textValue(contact.customerNumber);
    if (number !== undefined) used.add(number);
  }
  return used;
}

/** True when no other contact uses the customer number. */
export function isCustomerNumberAvailable(
  tenant: Tenant,
  customerNumber: string,
  exceptId?: string,
): boolean {
  return !usedCustomerNumbers(tenant, exceptId).has(customerNumber);
}

/**
 * The customer number the next contact would get, without issuing it. Numbers that
 * contacts already use (e.g. assigned manually) are skipped.
 */
export function peekFreeCustomerNumber(tenant: Tenant): string {
  const { prefix, start } = NUMBER_RANGES.customer;
  const used = usedCustomerNumbers(tenant);
  const last = tenant.numberRanges.last("customer");
  let candidate = last === undefined ? start : last + 1;
  while (used.has(`${prefix}${candidate}`)) candidate += 1;
  return `${prefix}${candidate}`;
}

/** Issues the next free customer number and advances the range past it. */
export function issueCustomerNumber(tenant: Tenant): string {
  const used = usedCustomerNumbers(tenant);
  let candidate = nextNumber(tenant, "customer");
  while (used.has(candidate)) candidate = nextNumber(tenant, "customer");
  return candidate;
}
