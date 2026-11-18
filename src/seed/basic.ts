import { readFileSync } from "node:fs";
import { toRef } from "../domain/shared/refs.ts";
import { isPlainObject, type PlainObject } from "../lib/object.ts";
import type { Tenant } from "../tenant/tenant.ts";

/**
 * Fixed stamp for all seeded reference data, so the seed is deterministic and does not
 * depend on the tenant clock.
 */
const SEED_STAMP = "2026-01-01T00:00:00+01:00";

/** Contact categories and other category object types (ids and names from the knowledge base). */
const CATEGORIES: readonly PlainObject[] = [
  { id: "2", objectType: "Contact", name: "Lieferant" },
  { id: "3", objectType: "Contact", name: "Kunde", translationCode: "CATEGORY_CUSTOMER" },
  { id: "4", objectType: "Contact", name: "Partner" },
  { id: "28", objectType: "Contact", name: "Interessent" },
  // Assumption: id 355842 may be account specific in real sevDesk; included for clients that expect it.
  { id: "355842", objectType: "Contact", name: "Zahlungsdienstleister" },
  { id: "43", objectType: "ContactAddress", name: "Arbeit" },
  { id: "44", objectType: "ContactAddress", name: "Privat" },
  { id: "45", objectType: "ContactAddress", name: " " },
  { id: "47", objectType: "ContactAddress", name: "Rechnungsanschrift" },
  { id: "48", objectType: "ContactAddress", name: "Lieferanschrift" },
  { id: "49", objectType: "ContactAddress", name: "Abholanschrift" },
  { id: "1", objectType: "Part", name: "Standard" },
  { id: "97430", objectType: "Part", name: "Dienstleistung" },
];

/** Names of CommunicationWayKey ids 1 to 8 (spec). */
const COMMUNICATION_WAY_KEYS: readonly string[] = [
  "Privat",
  "Arbeit",
  "Fax",
  "Mobil",
  " ",
  "Autobox",
  "Newsletter",
  "Rechnungsadresse",
];

/**
 * Units. Assumption: ids and most translation codes are synthetic. Only Stk (id 1,
 * UNITY_PIECE) and Std (UNITY_HOUR, id 9) are backed by third-party sources.
 */
const UNITIES: readonly PlainObject[] = [
  { id: "1", name: "Stk", translationCode: "UNITY_PIECE", uneceTradeUnitCode: "H87" },
  { id: "2", name: "Pauschal", translationCode: "UNITY_FLAT_RATE", uneceTradeUnitCode: "LS" },
  { id: "3", name: "km", translationCode: "UNITY_KILOMETER", uneceTradeUnitCode: "KMT" },
  { id: "4", name: "kg", translationCode: "UNITY_KILOGRAM", uneceTradeUnitCode: "KGM" },
  { id: "5", name: "m", translationCode: "UNITY_METER", uneceTradeUnitCode: "MTR" },
  { id: "6", name: "m²", translationCode: "UNITY_SQUARE_METER", uneceTradeUnitCode: "MTK" },
  { id: "7", name: "l", translationCode: "UNITY_LITER", uneceTradeUnitCode: "LTR" },
  { id: "8", name: "Tage", translationCode: "UNITY_DAYS", uneceTradeUnitCode: "DAY" },
  { id: "9", name: "Std", translationCode: "UNITY_HOUR", uneceTradeUnitCode: "HUR" },
  { id: "10", name: "Min", translationCode: "UNITY_MINUTE", uneceTradeUnitCode: "MIN" },
  { id: "11", name: "Monat", translationCode: "UNITY_MONTH", uneceTradeUnitCode: "MON" },
];

/** Tax rules of bookkeeping system 2.0 (ids, names and rates from the spec; codes from a third-party source). */
const TAX_RULES: readonly PlainObject[] = [
  { id: "1", name: "Umsatzsteuerpflichtige Umsätze", code: "USTPFL_UMS_EINN", taxRates: [0, 7, 19] },
  { id: "2", name: "Ausfuhren", code: "AUSFUHREN", taxRates: [0] },
  { id: "3", name: "Innergemeinschaftliche Lieferungen", code: "INNERGEM_LIEF", taxRates: [0, 7, 19] },
  { id: "4", name: "Steuerfreie Umsätze §4 UStG", code: "STFREIE_UMS_P4", taxRates: [0] },
  { id: "5", name: "Reverse Charge gem. §13b UStG", code: "REV_CHARGE_13B_1", taxRates: [0] },
  { id: "8", name: "Innergemeinschaftliche Erwerbe", code: "INNERGEM_ERWERB", taxRates: [0, 7, 19] },
  { id: "9", name: "Vorsteuerabziehbare Aufwendungen", code: "VORST_ABZUGSF_AUFW", taxRates: [0, 7, 19] },
  { id: "10", name: "Nicht vorsteuerabziehbare Aufwendungen", code: null, taxRates: [0] },
  { id: "11", name: "Steuer nicht erhoben nach §19 UStG", code: null, taxRates: [0] },
  {
    id: "12",
    name: "Reverse Charge §13b Abs. 2 mit Vorsteuerabzug",
    code: "REV_CHARGE_13B_MIT_VORST_ABZUG_0",
    taxRates: [0],
  },
  {
    id: "13",
    name: "Reverse Charge §13b ohne Vorsteuerabzug",
    code: "REV_CHARGE_13B_OHNE_VORST_ABZUG_0",
    taxRates: [0],
  },
  { id: "14", name: "Reverse Charge §13b Abs. 1 EU Umsätze", code: "REV_CHARGE_13B_EU_0", taxRates: [0] },
  { id: "15", name: "nicht steuerbare Steuerbewegungen", code: "NICHT_STEUERBAR_TAX", taxRates: [0] },
  { id: "16", name: "nicht steuerbare Aufwendungen", code: "NICHT_STEUERBAR_EXPENSE", taxRates: [0] },
  {
    id: "17",
    name: "Nicht im Inland steuerbare Leistung",
    code: "NICHT_IM_INLAND_STEUERBAR",
    taxRates: [0],
  },
  { id: "18", name: "One Stop Shop (Waren)", code: null, taxRates: null },
  { id: "19", name: "One Stop Shop (elektronische Leistung)", code: null, taxRates: null },
  { id: "20", name: "One Stop Shop (sonstige Leistung)", code: null, taxRates: null },
  { id: "21", name: "Reverse Charge gem. §18b UStG", code: "REV_CHARGE_13B_1_USTG", taxRates: [0] },
  { id: "22", name: "nicht steuerbare Einnahmen", code: "NICHT_STEUERBAR_REVENUE", taxRates: [0] },
];

/**
 * Synthetic default accounts. Assumption: a fresh sevDesk account has a default offline
 * clearing account; names, ids and the bank data below are invented.
 */
const CHECK_ACCOUNTS: readonly PlainObject[] = [
  {
    id: "1",
    name: "Verrechnungskonto",
    iban: null,
    type: "offline",
    defaultAccount: "1",
    baseAccount: "1",
    priority: "0",
    accountingNumber: "1200",
    bic: null,
  },
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

/** Reference data every account has (countries, units, users, check accounts, ...). Synthetic and deterministic. */
export function seedBasic(tenant: Tenant): void {
  const sevClient = toRef(tenant.sevClientId, "SevClient");
  const insertAll = (model: string, items: readonly PlainObject[], withClient = true): void => {
    const collection = tenant.store.collection(model);
    for (const item of items) {
      collection.insert({
        ...item,
        objectName: model,
        create: SEED_STAMP,
        update: SEED_STAMP,
        ...(withClient ? { sevClient } : {}),
      });
    }
  };

  insertAll(
    "SevClient",
    [
      {
        id: tenant.sevClientId,
        name: "Musterfirma GmbH",
        addressStreet: "Musterweg 5",
        addressZip: "10115",
        addressCity: "Berlin",
        bankIban: "DE00000000000000000000",
        bankBic: "MUSTDEFFXXX",
        contactEmail: "kontakt@musterfirma.example",
        contactPhone: "+49 30 0000000",
        taxNumber: "00/000/00000",
        vatNumber: "DE000000000",
        defaultCurrency: "EUR",
      },
    ],
    false,
  );
  insertAll("SevUser", [
    {
      id: "1",
      username: "max.mustermann@musterfirma.example",
      firstName: "Max",
      lastName: "Mustermann",
      fullname: "Max Mustermann",
      email: "max.mustermann@musterfirma.example",
      languageCode: "de",
      status: "100",
      clientOwner: "1",
      twoFactorAuth: "0",
    },
  ]);
  insertAll("StaticCountry", readStaticCountries(), false);
  insertAll(
    "Category",
    CATEGORIES.map((category) => ({ priority: "0", ...category })),
  );
  insertAll(
    "CommunicationWayKey",
    COMMUNICATION_WAY_KEYS.map((name, index) => ({
      id: String(index + 1),
      name,
      translationCode: name === "Arbeit" ? "COMM_WAY_KEY_WORK" : null,
    })),
    false,
  );
  insertAll("Unity", UNITIES);
  insertAll("TaxRule", TAX_RULES, false);
  insertAll(
    "CheckAccount",
    CHECK_ACCOUNTS.map((account) => ({
      importType: null,
      currency: "EUR",
      status: "100",
      balance: null,
      bankServer: null,
      autoMapTransactions: "1",
      autoSyncTransactions: "0",
      lastSync: null,
      ...account,
    })),
  );
}

/** Reads the bundled country list (src/seed/data/static-countries.json). */
function readStaticCountries(): PlainObject[] {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL("./data/static-countries.json", import.meta.url), "utf8"),
  );
  if (!Array.isArray(parsed) || !parsed.every(isPlainObject)) {
    throw new Error("src/seed/data/static-countries.json must contain an array of objects");
  }
  return parsed;
}
