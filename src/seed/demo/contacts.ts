import { createContactDocument } from "../../domain/contact/index.ts";
import { createDocument } from "../../domain/shared/documents.ts";
import { refId, toRef } from "../../domain/shared/refs.ts";
import type { PlainObject } from "../../lib/object.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { CATEGORY, COMMUNICATION_WAY_KEY, COUNTRY } from "./reference.ts";
import { enterDay } from "./timeline.ts";

/** The contacts later demo documents refer to. All names, numbers and addresses are synthetic. */
export interface DemoContacts {
  nordlicht: Doc;
  rheinwerk: Doc;
  alpenblick: Doc;
  helvetia: Doc;
  sonnenhof: Doc;
  papierkontor: Doc;
  buerowelt: Doc;
  keller: Doc;
}

interface AddressInput {
  street: string;
  zip: string;
  city: string;
  country: number;
}

interface CommunicationWayInput {
  type: "EMAIL" | "PHONE" | "MOBILE";
  value: string;
  key: number;
}

interface ContactInput {
  fields: PlainObject;
  address: AddressInput;
  ways: readonly CommunicationWayInput[];
}

/** Days before the reference day at which the contacts are created. */
const CREATED_DAYS_BEFORE = 180;

/**
 * Creates 7 organisations and 3 persons with address and communication ways. Customer
 * numbers come from the number range of the contact module.
 */
export function seedContacts(tenant: Tenant): DemoContacts {
  enterDay(tenant, CREATED_DAYS_BEFORE);
  const insert = (input: ContactInput): Doc => insertContact(tenant, input);
  const customer = (fields: PlainObject): PlainObject => ({
    category: toRef(CATEGORY.customer, "Category"),
    status: 1000,
    defaultTimeToPay: 14,
    ...fields,
  });
  const supplier = (fields: PlainObject): PlainObject => ({
    category: toRef(CATEGORY.supplier, "Category"),
    status: 1000,
    ...fields,
  });

  const nordlicht = insert({
    fields: customer({ name: "Nordlicht Medien GmbH", vatNumber: "DE000000001" }),
    address: { street: "Speicherhof 12", zip: "20457", city: "Hamburg", country: COUNTRY.germany },
    ways: [
      { type: "EMAIL", value: "einkauf@nordlicht-medien.example", key: COMMUNICATION_WAY_KEY.work },
      { type: "PHONE", value: "+49 40 5550100", key: COMMUNICATION_WAY_KEY.work },
    ],
  });
  const rheinwerk = insert({
    fields: customer({ name: "Rheinwerk Maschinenbau GmbH", vatNumber: "DE000000002" }),
    address: { street: "Werftstraße 40", zip: "40213", city: "Düsseldorf", country: COUNTRY.germany },
    ways: [
      { type: "EMAIL", value: "buchhaltung@rheinwerk-maschinenbau.example", key: COMMUNICATION_WAY_KEY.work },
      { type: "PHONE", value: "+49 211 5550200", key: COMMUNICATION_WAY_KEY.work },
    ],
  });
  const alpenblick = insert({
    fields: customer({ name: "Alpenblick Tourismus GmbH", vatNumber: "ATU00000003", defaultTimeToPay: 30 }),
    address: { street: "Getreidegasse 8", zip: "5020", city: "Salzburg", country: COUNTRY.austria },
    ways: [
      { type: "EMAIL", value: "office@alpenblick-tourismus.example", key: COMMUNICATION_WAY_KEY.work },
      { type: "PHONE", value: "+43 662 5550300", key: COMMUNICATION_WAY_KEY.work },
    ],
  });
  const helvetia = insert({
    fields: customer({
      name: "Helvetia Datenservice AG",
      vatNumber: "CHE-000.000.004",
      defaultTimeToPay: 30,
    }),
    address: { street: "Limmatquai 22", zip: "8001", city: "Zürich", country: COUNTRY.switzerland },
    ways: [
      { type: "EMAIL", value: "finanzen@helvetia-datenservice.example", key: COMMUNICATION_WAY_KEY.work },
      { type: "PHONE", value: "+41 44 5550400", key: COMMUNICATION_WAY_KEY.work },
    ],
  });
  const sonnenhof = insert({
    fields: customer({ name: "Sonnenhof Biomarkt eG", vatNumber: "DE000000005" }),
    address: { street: "Marktplatz 3", zip: "79098", city: "Freiburg im Breisgau", country: COUNTRY.germany },
    ways: [
      { type: "EMAIL", value: "bestellung@sonnenhof-biomarkt.example", key: COMMUNICATION_WAY_KEY.work },
      { type: "PHONE", value: "+49 761 5550500", key: COMMUNICATION_WAY_KEY.work },
    ],
  });
  const papierkontor = insert({
    fields: supplier({ name: "Papierkontor Schmidt KG", vatNumber: "DE000000006" }),
    address: { street: "Buchbinderweg 7", zip: "04109", city: "Leipzig", country: COUNTRY.germany },
    ways: [
      { type: "EMAIL", value: "rechnung@papierkontor-schmidt.example", key: COMMUNICATION_WAY_KEY.work },
    ],
  });
  const buerowelt = insert({
    fields: supplier({ name: "Bürowelt Rhein-Main GmbH", vatNumber: "DE000000007" }),
    address: { street: "Gutenbergring 15", zip: "50667", city: "Köln", country: COUNTRY.germany },
    ways: [
      { type: "EMAIL", value: "service@buerowelt-rhein-main.example", key: COMMUNICATION_WAY_KEY.work },
      { type: "PHONE", value: "+49 221 5550700", key: COMMUNICATION_WAY_KEY.work },
    ],
  });

  // Persons: two belong to a customer organisation, one is a private customer.
  insert({
    fields: customer({
      surename: "Julia",
      familyname: "Brandt",
      gender: "w",
      parent: toRef(nordlicht.id, "Contact"),
    }),
    address: { street: "Speicherhof 12", zip: "20457", city: "Hamburg", country: COUNTRY.germany },
    ways: [
      { type: "EMAIL", value: "julia.brandt@nordlicht-medien.example", key: COMMUNICATION_WAY_KEY.work },
      { type: "MOBILE", value: "+49 171 5550801", key: COMMUNICATION_WAY_KEY.mobile },
    ],
  });
  insert({
    fields: customer({
      surename: "Markus",
      familyname: "Steiner",
      gender: "m",
      parent: toRef(alpenblick.id, "Contact"),
    }),
    address: { street: "Getreidegasse 8", zip: "5020", city: "Salzburg", country: COUNTRY.austria },
    ways: [
      {
        type: "EMAIL",
        value: "markus.steiner@alpenblick-tourismus.example",
        key: COMMUNICATION_WAY_KEY.work,
      },
      { type: "MOBILE", value: "+43 664 5550802", key: COMMUNICATION_WAY_KEY.mobile },
    ],
  });
  const keller = insert({
    fields: customer({ surename: "Anja", familyname: "Keller", academicTitle: "Dr.", gender: "w" }),
    address: { street: "Lindenallee 21", zip: "04103", city: "Leipzig", country: COUNTRY.germany },
    ways: [
      { type: "EMAIL", value: "anja.keller@kellerpost.example", key: COMMUNICATION_WAY_KEY.work },
      { type: "MOBILE", value: "+49 172 5550803", key: COMMUNICATION_WAY_KEY.mobile },
    ],
  });

  return { nordlicht, rheinwerk, alpenblick, helvetia, sonnenhof, papierkontor, buerowelt, keller };
}

/** First stored e-mail address of a contact; the demo contacts always have one. */
export function primaryEmail(tenant: Tenant, contact: Doc): string {
  const way = tenant.store
    .collection("CommunicationWay")
    .findOne((candidate) => candidate.type === "EMAIL" && refId(candidate.contact) === contact.id);
  if (typeof way?.value !== "string") throw new Error(`Demo contact ${contact.id} has no e-mail address`);
  return way.value;
}

/** Postal address block ("name\nstreet\nzip city") and country reference of a contact's first address. */
export function postalAddress(tenant: Tenant, contact: Doc): { address: string; country: unknown } {
  const address = tenant.store
    .collection("ContactAddress")
    .findOne((candidate) => refId(candidate.contact) === contact.id);
  if (address === undefined) throw new Error(`Demo contact ${contact.id} has no address`);
  const name =
    typeof contact.name === "string"
      ? contact.name
      : `${String(contact.surename)} ${String(contact.familyname)}`;
  return {
    address: [name, address.street, `${String(address.zip)} ${String(address.city)}`].join("\n"),
    country: address.country,
  };
}

function insertContact(tenant: Tenant, input: ContactInput): Doc {
  const contact = createContactDocument(tenant, input.fields);
  const contactRef = toRef(contact.id, "Contact");
  createDocument(tenant, "ContactAddress", {
    contact: contactRef,
    street: input.address.street,
    zip: input.address.zip,
    city: input.address.city,
    country: toRef(input.address.country, "StaticCountry"),
    category: toRef(CATEGORY.billingAddress, "Category"),
  });
  for (const way of input.ways) {
    createDocument(tenant, "CommunicationWay", {
      contact: contactRef,
      type: way.type,
      value: way.value,
      key: toRef(way.key, "CommunicationWayKey"),
      main: true,
    });
  }
  return contact;
}
