import { parseDateInput } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { type FieldFilter, matchesFieldFilter } from "../shared/list.ts";
import { refId } from "../shared/refs.ts";
import { tagsFilter } from "../shared/tags.ts";
import { textValue } from "./validation.ts";

/** True when the contact has a surename or familyname: such a contact is a person, otherwise an organisation. */
export function isPerson(contact: Doc): boolean {
  return textValue(contact.surename) !== undefined || textValue(contact.familyname) !== undefined;
}

function lower(value: unknown): string {
  return (textValue(value) ?? "").toLowerCase();
}

/** Addresses of a contact. */
function addressesOf(tenant: Tenant, contact: Doc): Doc[] {
  return tenant.store.collection("ContactAddress").find((address) => refId(address.contact) === contact.id);
}

function addressFilter(tenant: Tenant, field: "city" | "zip"): FieldFilter {
  return (contact, value) => {
    const wanted = lower(value);
    return wanted === "" || addressesOf(tenant, contact).some((address) => lower(address[field]) === wanted);
  };
}

function timestampFilter(field: "create" | "update", direction: "before" | "after"): FieldFilter {
  return (contact, value) => {
    const limit = parseDateInput(value);
    // An unparseable timestamp is ignored, like sevDesk ignores a malformed startDate.
    if (limit === undefined) return true;
    const actual = parseDateInput(contact[field]);
    if (actual === undefined) return false;
    return direction === "before" ? actual < limit : actual > limit;
  };
}

/** Filters of GET /Contact (everything the spec's filter table lists, plus the live-verified behavior). */
export function contactFilters(tenant: Tenant): Readonly<Record<string, FieldFilter | null>> {
  return {
    // Live-verified: case-insensitive substring over name, surename and familyname.
    name: (contact, value) => {
      const wanted = lower(value);
      if (wanted === "") return true;
      const fullName = `${lower(contact.surename)} ${lower(contact.familyname)}`;
      return [lower(contact.name), lower(contact.surename), lower(contact.familyname), fullName].some(
        (candidate) => candidate.includes(wanted),
      );
    },
    // Live-verified: exact match.
    customerNumber: (contact, value) => {
      const wanted = textValue(value);
      return wanted === undefined || textValue(contact.customerNumber) === wanted;
    },
    city: addressFilter(tenant, "city"),
    zip: addressFilter(tenant, "zip"),
    country: (contact, value) =>
      addressesOf(tenant, contact).some((address) => matchesFieldFilter(address.country, value)),
    // Assumption: several tags combine with OR for contacts.
    tags: tagsFilter(tenant, "Contact", "any"),
    createBefore: timestampFilter("create", "before"),
    createAfter: timestampFilter("create", "after"),
    updateBefore: timestampFilter("update", "before"),
    updateAfter: timestampFilter("update", "after"),
    orderByCustomerNumber: null,
  };
}

/** Comparator for orderByCustomerNumber=ASC|DESC; undefined keeps the default id order. */
export function customerNumberSort(order: unknown): ((a: Doc, b: Doc) => number) | undefined {
  if (typeof order !== "string") return undefined;
  const direction = order.toUpperCase();
  if (direction !== "ASC" && direction !== "DESC") return undefined;
  const sign = direction === "ASC" ? 1 : -1;
  return (a, b) =>
    sign *
    (textValue(a.customerNumber) ?? "").localeCompare(textValue(b.customerNumber) ?? "", "de", {
      numeric: true,
    });
}
