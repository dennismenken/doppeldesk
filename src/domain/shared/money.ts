import { parseNumber } from "../../lib/coerce.ts";

/** Tolerance for comparing money amounts (half a cent). */
export const MONEY_TOLERANCE = 0.005;

/** Rounds half away from zero ("kaufmännisch") to the given decimals, free of float artifacts. */
export function roundMoney(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  const shifted = Number(`${Math.abs(value).toFixed(10)}e${decimals}`);
  const rounded = Number(`${Math.round(shifted)}e-${decimals}`);
  return rounded === 0 ? 0 : sign * rounded;
}

/** Converts request values (number or numeric string, comma as decimal separator allowed) to a number. */
export function toNumber(value: unknown, fallback = 0): number {
  return parseNumber(value) ?? fallback;
}

/** Input of one position. "price" is net in mode "net" and gross in mode "gross". */
export interface PositionInput {
  quantity: number;
  price: number;
  /** Percent, e.g. 19. */
  taxRate: number;
  /** Position discount in percent (assumption: sevDesk position discount is a percentage). */
  discount?: number;
  mode: "net" | "gross";
}

/** Computed amounts of one position (all rounded to 2 decimals). */
export interface PositionSums {
  priceNet: number;
  priceGross: number;
  priceTax: number;
  sumNet: number;
  sumGross: number;
  sumTax: number;
  /** Discount amount in the leading mode (net amount in mode "net", gross amount in mode "gross"). */
  sumDiscount: number;
  taxRate: number;
  mode: "net" | "gross";
}

/**
 * Computes unit prices and line sums of a position. The leading amount (net or gross)
 * is rounded first, the other side is derived so that net + tax = gross holds exactly.
 */
export function computePositionSums(input: PositionInput): PositionSums {
  const factor = 1 + input.taxRate / 100;
  const discountFactor = 1 - (input.discount ?? 0) / 100;
  if (input.mode === "net") {
    const priceNet = roundMoney(input.price);
    const priceGross = roundMoney(input.price * factor);
    const undiscounted = input.quantity * input.price;
    const sumNet = roundMoney(undiscounted * discountFactor);
    const sumTax = roundMoney(sumNet * (input.taxRate / 100));
    return {
      priceNet,
      priceGross,
      priceTax: roundMoney(priceGross - priceNet),
      sumNet,
      sumGross: roundMoney(sumNet + sumTax),
      sumTax,
      sumDiscount: discountAmount(undiscounted, input.discount),
      taxRate: input.taxRate,
      mode: "net",
    };
  }
  const priceGross = roundMoney(input.price);
  const priceNet = roundMoney(input.price / factor);
  const undiscounted = input.quantity * input.price;
  const sumGross = roundMoney(undiscounted * discountFactor);
  const sumNet = roundMoney(sumGross / factor);
  return {
    priceNet,
    priceGross,
    priceTax: roundMoney(priceGross - priceNet),
    sumNet,
    sumGross,
    sumTax: roundMoney(sumGross - sumNet),
    sumDiscount: discountAmount(undiscounted, input.discount),
    taxRate: input.taxRate,
    mode: "gross",
  };
}

/**
 * Discount amount of a position: the percentage of the undiscounted line amount, rounded on
 * its own. Deriving it as "undiscounted minus rounded sum" would report the rounding of the
 * line sum (e.g. 0.505 -> 0.51) as a discount of -0.01 on positions without any discount.
 */
function discountAmount(undiscounted: number, discountPercent = 0): number {
  return roundMoney((undiscounted * discountPercent) / 100);
}

/** Amounts of one tax rate within a document. */
export interface TaxGroup {
  taxRate: number;
  net: number;
  tax: number;
  gross: number;
}

/** Header totals of a document. */
export interface DocumentTotals {
  sumNet: number;
  sumTax: number;
  sumGross: number;
  sumDiscounts: number;
  taxes: TaxGroup[];
}

/**
 * Header totals over positions. Tax is computed per tax rate on the group sum of the
 * leading amount (net or gross), as invoices list it (assumption: matches sevDesk rounding).
 */
export function computeDocumentTotals(
  positions: readonly PositionSums[],
  mode: "net" | "gross",
): DocumentTotals {
  const groups = new Map<number, number>();
  for (const position of positions) {
    const leading = mode === "net" ? position.sumNet : position.sumGross;
    groups.set(position.taxRate, (groups.get(position.taxRate) ?? 0) + leading);
  }
  const taxes = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([taxRate, amount]): TaxGroup => {
      const leading = roundMoney(amount);
      if (mode === "net") {
        const tax = roundMoney(leading * (taxRate / 100));
        return { taxRate, net: leading, tax, gross: roundMoney(leading + tax) };
      }
      const net = roundMoney(leading / (1 + taxRate / 100));
      return { taxRate, net, tax: roundMoney(leading - net), gross: leading };
    });
  const sum = (pick: (group: TaxGroup) => number) =>
    roundMoney(taxes.reduce((total, group) => total + pick(group), 0));
  return {
    sumNet: sum((group) => group.net),
    sumTax: sum((group) => group.tax),
    sumGross: sum((group) => group.gross),
    sumDiscounts: roundMoney(positions.reduce((total, position) => total + position.sumDiscount, 0)),
    taxes,
  };
}
