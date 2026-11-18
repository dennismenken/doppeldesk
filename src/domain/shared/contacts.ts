import type { PlainObject } from "../../lib/object.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { type Ref, readRef, refId } from "./refs.ts";

/** The stored contact a reference points to, if any. */
export function contactOf(tenant: Tenant, value: unknown): Doc | undefined {
  const id = refId(value);
  return id === undefined ? undefined : tenant.store.collection("Contact").get(id);
}

/** Display name of a contact: organisation name or "surename familyname" ("" when unknown). */
export function contactName(contact: Doc | undefined): string {
  if (contact === undefined) return "";
  if (isFilled(contact.name)) return String(contact.name);
  return [contact.surename, contact.familyname].filter(isFilled).join(" ");
}

/** E-mail address of the SevUser a contactPerson reference points to, or null. */
export function userEmail(tenant: Tenant, contactPerson: unknown): string | null {
  const id = refId(contactPerson);
  const user = id === undefined ? undefined : tenant.store.collection("SevUser").get(id);
  return typeof user?.email === "string" ? user.email : null;
}

/** Address text and country of a contact's default address (factory flag takeDefaultAddress). */
interface DefaultAddress {
  address: string;
  country: Ref | undefined;
}

/**
 * The first stored address of the contact as document address. Lines are
 * "name\nstreet\nzip city" as in the spec example (the address name, else the contact
 * name). Assumption: the country is not appended to the text, it is returned separately
 * for addressCountry.
 */
function defaultAddress(tenant: Tenant, contactValue: unknown): DefaultAddress | undefined {
  const contact = contactOf(tenant, contactValue);
  if (contact === undefined) return undefined;
  const address = tenant.store
    .collection("ContactAddress")
    .findOne((candidate) => refId(candidate.contact) === contact.id);
  if (address === undefined) return undefined;
  const name = isFilled(address.name) ? String(address.name) : contactName(contact);
  const cityLine = [address.zip, address.city].filter(isFilled).join(" ");
  const lines = [name, address.street, cityLine].filter(isFilled).map(String);
  return { address: lines.join("\n"), country: readRef(address.country, "StaticCountry") };
}

/**
 * Header fields takeDefaultAddress sets: the address text and, when the header has no
 * addressCountry yet, the country of the address. Empty when the contact has no address.
 */
export function defaultAddressFields(tenant: Tenant, header: PlainObject): PlainObject {
  const found = defaultAddress(tenant, header.contact);
  if (found === undefined) return {};
  const fields: PlainObject = { address: found.address };
  const hasCountry = header.addressCountry !== undefined && header.addressCountry !== null;
  if (found.country !== undefined && !hasCountry) fields.addressCountry = found.country;
  return fields;
}

function isFilled(value: unknown): boolean {
  return (typeof value === "string" && value.trim() !== "") || typeof value === "number";
}
