import { createDocument } from "../../domain/shared/documents.ts";
import { roundMoney } from "../../domain/shared/money.ts";
import { toRef } from "../../domain/shared/refs.ts";
import type { PlainObject } from "../../lib/object.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { CATEGORY, UNITY } from "./reference.ts";
import { enterDay } from "./timeline.ts";

/** The parts (products and services) later demo documents refer to. */
export interface DemoParts {
  webdesign: Doc;
  consulting: Doc;
  maintenance: Doc;
  notebook: Doc;
  book: Doc;
  coffee: Doc;
}

interface PartInput {
  name: string;
  partNumber: string;
  text: string;
  category: number;
  unity: number;
  priceNet: number;
  pricePurchase: number | null;
  taxRate: number;
  stock: number;
}

/** Days before the reference day at which the parts are created. */
const CREATED_DAYS_BEFORE = 178;

/** Creates 3 services (19%) and 3 goods (two at 19%, books and food at 7%). */
export function seedParts(tenant: Tenant): DemoParts {
  enterDay(tenant, CREATED_DAYS_BEFORE);
  const service = {
    category: CATEGORY.partService,
    pricePurchase: null,
    stock: 0,
    taxRate: 19,
  } as const;
  return {
    webdesign: insertPart(tenant, {
      ...service,
      name: "Webdesign Stundensatz",
      partNumber: "DL-1001",
      text: "Konzeption und Umsetzung von Webseiten",
      unity: UNITY.hour,
      priceNet: 95,
    }),
    consulting: insertPart(tenant, {
      ...service,
      name: "Beratung Tagessatz",
      partNumber: "DL-1002",
      text: "Fachliche Beratung vor Ort oder remote",
      unity: UNITY.days,
      priceNet: 720,
    }),
    maintenance: insertPart(tenant, {
      ...service,
      name: "Website-Wartung",
      partNumber: "DL-1003",
      text: "Monatliche Pflege, Updates und Sicherung",
      unity: UNITY.month,
      priceNet: 149,
    }),
    notebook: insertPart(tenant, {
      name: "Notizbuch A5, liniert",
      partNumber: "WA-2001",
      text: "192 Seiten, Fadenheftung",
      category: CATEGORY.partStandard,
      unity: UNITY.piece,
      priceNet: 12.5,
      pricePurchase: 6.2,
      taxRate: 19,
      stock: 120,
    }),
    book: insertPart(tenant, {
      name: "Fachbuch Buchführung kompakt",
      partNumber: "WA-2002",
      text: "Taschenbuch, 280 Seiten",
      category: CATEGORY.partStandard,
      unity: UNITY.piece,
      priceNet: 34.9,
      pricePurchase: 21.5,
      taxRate: 7,
      stock: 40,
    }),
    coffee: insertPart(tenant, {
      name: "Bio-Kaffee Bohnen 1 kg",
      partNumber: "WA-2003",
      text: "Fair gehandelt, mittlere Röstung",
      category: CATEGORY.partStandard,
      unity: UNITY.piece,
      priceNet: 18.9,
      pricePurchase: 11.4,
      taxRate: 7,
      stock: 45,
    }),
  };
}

/**
 * A position of a sales document taken from a part: name, text, unit, tax rate and price
 * (net or gross, matching the document's showNet). Overrides win over the part values.
 */
export function partPosition(
  part: Doc,
  quantity: number,
  options: { gross?: boolean; overrides?: PlainObject } = {},
): PlainObject {
  return {
    part: toRef(part.id, "Part"),
    name: part.name,
    text: part.text,
    quantity,
    unity: part.unity,
    taxRate: part.taxRate,
    price: options.gross === true ? part.priceGross : part.priceNet,
    ...options.overrides,
  };
}

function insertPart(tenant: Tenant, input: PartInput): Doc {
  return createDocument(
    tenant,
    "Part",
    {
      name: input.name,
      partNumber: input.partNumber,
      text: input.text,
      category: toRef(input.category, "Category"),
      unity: toRef(input.unity, "Unity"),
      price: input.priceNet,
      priceNet: input.priceNet,
      priceGross: roundMoney(input.priceNet * (1 + input.taxRate / 100)),
      pricePurchase: input.pricePurchase,
      taxRate: input.taxRate,
      stock: input.stock,
      stockEnabled: input.stock > 0,
      status: "100",
      internalComment: null,
    },
    {},
  );
}
