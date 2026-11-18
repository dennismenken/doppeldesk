import { badRequest } from "../../lib/errors.ts";
import type { RouteDefinition } from "../../routes/types.ts";
import { paginate } from "../shared/list.ts";
import { validationError } from "../shared/validation.ts";

interface TaxRuleGuide {
  name: string;
  description: string;
  id: number;
  taxRates: string[];
}

interface ReceiptGuide {
  accountDatevId: number;
  accountNumber: string;
  accountName: string;
  description: string;
  allowedTaxRules: TaxRuleGuide[];
  allowedReceiptTypes: string[];
}

/*
 * Static guidance. Assumption: an illustrative excerpt of the SKR04 chart of accounts, not
 * the real sevDesk catalogue. Rule 1 and its name come from the spec example; names of the
 * other rules are invented placeholders, ids and rates follow the spec's tax rule table.
 */
const REVENUE_RULE: TaxRuleGuide = {
  name: "USTPFL_UMS_EINN",
  description: "Umsatzsteuerpflichtige Umsätze",
  id: 1,
  taxRates: ["ZERO", "SEVEN", "NINETEEN"],
};
const TAX_FREE_REVENUE_RULE: TaxRuleGuide = {
  name: "UMS_EINN_STFREI_4",
  description: "Steuerfreie Umsätze §4 UStG",
  id: 4,
  taxRates: ["ZERO"],
};
const EXPENSE_RULE: TaxRuleGuide = {
  name: "VORSTABZFAEH_AUFW",
  description: "Vorsteuerabziehbare Aufwendungen",
  id: 9,
  taxRates: ["ZERO", "SEVEN", "NINETEEN"],
};
const NON_DEDUCTIBLE_EXPENSE_RULE: TaxRuleGuide = {
  name: "NICHT_VORSTABZFAEH_AUFW",
  description: "Nicht vorsteuerabziehbare Aufwendungen",
  id: 10,
  taxRates: ["ZERO"],
};

const GUIDES: readonly ReceiptGuide[] = [
  {
    accountDatevId: 1,
    accountNumber: "4400",
    accountName: "Erlöse 19 % USt",
    description: "Einnahmen aus dem Verkauf von Waren und Dienstleistungen",
    allowedTaxRules: [REVENUE_RULE, TAX_FREE_REVENUE_RULE],
    allowedReceiptTypes: ["REVENUE"],
  },
  {
    accountDatevId: 2,
    accountNumber: "4300",
    accountName: "Erlöse 7 % USt",
    description: "Einnahmen aus Leistungen mit ermäßigtem Steuersatz",
    allowedTaxRules: [REVENUE_RULE],
    allowedReceiptTypes: ["REVENUE"],
  },
  {
    accountDatevId: 3,
    accountNumber: "6815",
    accountName: "Bürobedarf",
    description: "Ausgaben für Büromaterial und Kleinbedarf",
    allowedTaxRules: [EXPENSE_RULE, NON_DEDUCTIBLE_EXPENSE_RULE],
    allowedReceiptTypes: ["EXPENSE"],
  },
  {
    accountDatevId: 4,
    accountNumber: "6805",
    accountName: "Telefon",
    description: "Ausgaben für Telefon und Internet",
    allowedTaxRules: [EXPENSE_RULE, NON_DEDUCTIBLE_EXPENSE_RULE],
    allowedReceiptTypes: ["EXPENSE"],
  },
  {
    accountDatevId: 5,
    accountNumber: "6300",
    accountName: "Sonstige betriebliche Aufwendungen",
    description: "Ausgaben, die keinem anderen Konto zugeordnet werden",
    allowedTaxRules: [EXPENSE_RULE, NON_DEDUCTIBLE_EXPENSE_RULE],
    allowedReceiptTypes: ["EXPENSE"],
  },
];

const GUIDANCE_PATH = "/ReceiptGuidance";

function byType(type: string): ReceiptGuide[] {
  return GUIDES.filter((guide) => guide.allowedReceiptTypes.includes(type));
}

/*
 * Placeholder dictionary of the text parser. Assumption: BANK_NUMBER/[%BIC%] comes from the
 * spec example; the remaining keys are an illustrative selection of sevDesk placeholders.
 */
const DICTIONARY_BY_OBJECT: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  Contact: [
    ["BANK_NUMBER", "[%BIC%]"],
    ["CONTACT_NAME", "[%KONTAKTNAME%]"],
    ["CUSTOMER_NUMBER", "[%KUNDENNUMMER%]"],
  ],
  Invoice: [
    ["INVOICE_NUMBER", "[%RECHNUNGSNUMMER%]"],
    ["INVOICE_DATE", "[%RECHNUNGSDATUM%]"],
    ["SUM_GROSS", "[%GESAMTSUMME%]"],
  ],
  CreditNote: [
    ["CREDIT_NOTE_NUMBER", "[%GUTSCHRIFTSNUMMER%]"],
    ["CREDIT_NOTE_DATE", "[%GUTSCHRIFTSDATUM%]"],
  ],
  Order: [
    ["ORDER_NUMBER", "[%AUFTRAGSNUMMER%]"],
    ["ORDER_DATE", "[%AUFTRAGSDATUM%]"],
  ],
  Letter: [["LETTER_DATE", "[%DATUM%]"]],
  Email: [["SENDER_NAME", "[%ABSENDER%]"]],
};

const DICTIONARY_OBJECTS = Object.keys(DICTIONARY_BY_OBJECT);

function dictionaryEntries(objectName: unknown, subObjectName: unknown) {
  if (typeof objectName !== "string" || !DICTIONARY_OBJECTS.includes(objectName)) {
    throw badRequest(
      `Invalid value given for 'objectName'. Allowed values are ${DICTIONARY_OBJECTS.join(", ")}.`,
    );
  }
  const names = objectName === "Email" ? ["Email", subObjectName] : [objectName];
  if (
    objectName === "Email" &&
    (typeof subObjectName !== "string" || !DICTIONARY_OBJECTS.includes(subObjectName))
  ) {
    throw badRequest("The parameter 'subObjectName' is required if 'objectName' is Email");
  }
  return names.map((name) => ({
    key: name,
    value: (DICTIONARY_BY_OBJECT[String(name)] ?? []).map(([key, value]) => ({ key, value })),
  }));
}

export const guidanceRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: `${GUIDANCE_PATH}/forAllAccounts`,
    handler: ({ query }) => paginate(GUIDES, query),
  },
  {
    method: "GET",
    path: `${GUIDANCE_PATH}/forAccountNumber`,
    handler: ({ query }) => {
      const number = String(query.accountNumber ?? "");
      const matches = GUIDES.filter((guide) => guide.accountNumber === number);
      if (matches.length === 0) throw validationError("The account you requested could not be found.");
      return paginate(matches, query);
    },
  },
  {
    method: "GET",
    path: `${GUIDANCE_PATH}/forTaxRule`,
    handler: ({ query }) => {
      const rule = Number(query.taxRule);
      const matches = GUIDES.filter((guide) => guide.allowedTaxRules.some((allowed) => allowed.id === rule));
      if (matches.length === 0)
        throw validationError("No account guides were found for the requested tax rule.");
      return paginate(matches, query);
    },
  },
  {
    method: "GET",
    path: `${GUIDANCE_PATH}/forRevenue`,
    handler: ({ query }) => paginate(byType("REVENUE"), query),
  },
  {
    method: "GET",
    path: `${GUIDANCE_PATH}/forExpense`,
    handler: ({ query }) => paginate(byType("EXPENSE"), query),
  },
  {
    method: "GET",
    path: "/Textparser/fetchDictionaryEntriesByType",
    handler: ({ query }) => ({ objects: dictionaryEntries(query.objectName, query.subObjectName) }),
  },
  {
    method: "GET",
    path: "/DocServer/getLetterpapersWithThumb",
    handler: () => ({
      objects: {
        result: "1",
        letterpapers: [
          // Assumption: one blank letterhead like the spec example, without image data.
          { id: "57d7ff34f23ada297d265f21", pdf: "", sevClient: "0", name: "Blanko", default: 1, img: "" },
        ],
      },
    }),
  },
  {
    method: "GET",
    path: "/DocServer/getTemplatesWithThumb",
    handler: () => ({
      objects: {
        result: "1",
        templates: ["Invoice", "CreditNote", "Order"].map((type, index) => ({
          id: `57986aee6bd2d53306068da${index + 1}`,
          name: "SEVDOC_TEMPLATE_STANDARD",
          translationCode: "SEVDOC_TEMPLATE_STANDARD",
          sevClient: "0",
          type,
          html: "",
          default: 1,
          premium: false,
        })),
      },
    }),
  },
];
