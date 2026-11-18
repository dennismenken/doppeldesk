import type { PlainObject } from "../../lib/object.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { clientFields, DISCOUNTS } from "../shared/documents.ts";
import { isTrue } from "../shared/list.ts";
import {
  computeDocumentTotals,
  computePositionSums,
  type DocumentTotals,
  type PositionSums,
  roundMoney,
  toNumber,
} from "../shared/money.ts";
import { positionsOf } from "../shared/positions.ts";
import { isRefTo } from "../shared/refs.ts";
import { isBlank, validationError } from "../shared/validation.ts";
import { INVOICE, INVOICE_POSITIONS } from "./constants.ts";

/** Fields of a position that the server computes; client values for them are overwritten. */
const COMPUTED_POSITION_FIELDS = [
  "priceNet",
  "priceGross",
  "priceTax",
  "sumNet",
  "sumTax",
  "sumGross",
  "sumDiscount",
  "sumNetAccounting",
  "sumTaxAccounting",
  "sumGrossAccounting",
] as const;

/**
 * Whether position prices are net or gross. The spec ties it to "showNet" of the
 * invoice ("determines, if the price ... will be regarded as gross or net").
 * Assumption: a missing showNet means net prices.
 */
export function priceMode(invoice: PlainObject): "net" | "gross" {
  const showNet = invoice.showNet;
  return showNet === false || showNet === 0 || showNet === "0" || showNet === "false" ? "gross" : "net";
}

/** Positions of an invoice ordered by positionNumber (missing last), then id. */
export function invoicePositions(tenant: Tenant, invoiceId: string): Doc[] {
  return positionsOf(tenant, INVOICE_POSITIONS, invoiceId);
}

/** Header discounts/surcharges (discountSave) of an invoice. */
export function invoiceDiscounts(tenant: Tenant, invoiceId: string): Doc[] {
  return tenant.store.collection(DISCOUNTS).find((discount) => isRefTo(discount.object, INVOICE, invoiceId));
}

/**
 * Computes the stored fields of a position from its (merged) data: unit prices and
 * sums via the shared position math. "price" is the leading price (net or gross by
 * priceMode); when it is missing, priceNet/priceGross of the leading side is used.
 * Assumption: a position without taxRate inherits the header taxRate.
 */
export function computePosition(data: PlainObject, invoice: PlainObject): PlainObject {
  const mode = priceMode(invoice);
  const leadingFallback = mode === "net" ? data.priceNet : data.priceGross;
  const price = toNumber(data.price ?? leadingFallback);
  const taxRate = toNumber(data.taxRate ?? invoice.taxRate);
  const quantity = toNumber(data.quantity);
  const discount = toNumber(data.discount);
  const sums = computePositionSums({ quantity, price, taxRate, discount, mode });
  return {
    ...data,
    quantity,
    price: roundMoney(price),
    taxRate,
    discount,
    priceNet: sums.priceNet,
    priceGross: sums.priceGross,
    priceTax: sums.priceTax,
    sumNet: sums.sumNet,
    sumTax: sums.sumTax,
    sumGross: sums.sumGross,
    sumDiscount: sums.sumDiscount,
    sumNetAccounting: sums.sumNet,
    sumTaxAccounting: sums.sumTax,
    sumGrossAccounting: sums.sumGross,
  };
}

/**
 * Client data of a position without server stamps, computed amounts and the parent
 * reference (positions can not move to another invoice).
 */
export function positionClientFields(input: PlainObject): PlainObject {
  const result = clientFields(input);
  for (const field of COMPUTED_POSITION_FIELDS) delete result[field];
  delete result.invoice;
  return result;
}

/**
 * Recomputes the header sums of an invoice from its stored positions and header
 * discounts and stores them. Returns the updated invoice.
 */
export function recalculateInvoice(tenant: Tenant, invoice: Doc): Doc {
  const totals = invoiceTotals(tenant, invoice);
  const updated = tenant.store.collection(INVOICE).update(invoice.id, {
    sumNet: totals.sumNet,
    sumTax: totals.sumTax,
    sumGross: totals.sumGross,
    sumDiscounts: totals.sumDiscounts,
    sumNetAccounting: totals.sumNet,
    sumTaxAccounting: totals.sumTax,
    sumGrossAccounting: totals.sumGross,
    sumNetForeignCurrency: 0,
    sumTaxForeignCurrency: 0,
    sumGrossForeignCurrency: 0,
    sumDiscountsForeignCurrency: 0,
  });
  return updated ?? invoice;
}

/**
 * Header totals over positions and discounts. Assumption: a header discount
 * (percentage of the leading sum or absolute value) is distributed over the tax
 * groups proportionally to their leading amount; surcharges ("discount": false)
 * add instead of subtract and do not count into sumDiscounts.
 */
export function invoiceTotals(tenant: Tenant, invoice: Doc): DocumentTotals {
  const mode = priceMode(invoice);
  const positions = invoicePositions(tenant, invoice.id).map((pos) => storedSums(pos, mode));
  const groups = new Map<number, number>();
  for (const sums of positions) groups.set(sums.taxRate, (groups.get(sums.taxRate) ?? 0) + leadingOf(sums));
  const leadingTotal = [...groups.values()].reduce((total, amount) => total + amount, 0);

  const adjustments: PositionSums[] = [];
  for (const discount of invoiceDiscounts(tenant, invoice.id)) {
    const amount = headerDiscountAmount(discount, leadingTotal);
    const reduces = isReduction(discount);
    for (const [taxRate, groupAmount] of groups) {
      const share = leadingTotal === 0 ? 0 : (amount * groupAmount) / leadingTotal;
      const signed = reduces ? -share : share;
      adjustments.push(adjustment(taxRate, signed, reduces ? share : 0, mode));
    }
  }
  return computeDocumentTotals([...positions, ...adjustments], mode);
}

/**
 * Header discounts (discountSave) must fit the computed positions of the invoice: a value of
 * at least 0, at most 100 for a percentage, and all discounts together at most the leading
 * total of the positions, so a discount never turns the invoice negative (orders reject
 * negative totals, spec news release 4.167). Surcharges are not limited. Assumption: 422 like
 * the other document rules, the wording is invented.
 */
export function assertHeaderDiscounts(
  positions: readonly PlainObject[],
  discounts: readonly PlainObject[],
  invoice: PlainObject,
): void {
  const mode = priceMode(invoice);
  const leadingTotal = positions.reduce((total, pos) => total + leadingOf(storedSums(pos, mode)), 0);
  let discounted = 0;
  for (const discount of discounts) {
    const value = isBlank(discount.value) ? 0 : toNumber(discount.value, Number.NaN);
    if (!(value >= 0) || (isTrue(discount.percentage) && value > 100)) {
      throw validationError("A discount must be at least 0 and a percentage at most 100");
    }
    if (isReduction(discount)) discounted += headerDiscountAmount(discount, leadingTotal);
  }
  if (discounted > 0 && roundMoney(discounted) > roundMoney(Math.max(leadingTotal, 0))) {
    throw validationError("The discounts must not exceed the total of the invoice positions");
  }
}

/** Amount of a header discount or surcharge: a percentage of the leading total or the value itself. */
function headerDiscountAmount(discount: PlainObject, leadingTotal: number): number {
  const value = toNumber(discount.value);
  return isTrue(discount.percentage) ? (leadingTotal * value) / 100 : value;
}

/** True for a discount, false for a surcharge ("discount": false). */
function isReduction(discount: PlainObject): boolean {
  return discount.discount === undefined || isTrue(discount.discount);
}

function leadingOf(sums: PositionSums): number {
  return sums.mode === "net" ? sums.sumNet : sums.sumGross;
}

function storedSums(pos: PlainObject, mode: "net" | "gross"): PositionSums {
  return {
    priceNet: toNumber(pos.priceNet),
    priceGross: toNumber(pos.priceGross),
    priceTax: toNumber(pos.priceTax),
    sumNet: toNumber(pos.sumNet),
    sumGross: toNumber(pos.sumGross),
    sumTax: toNumber(pos.sumTax),
    sumDiscount: toNumber(pos.sumDiscount),
    taxRate: toNumber(pos.taxRate),
    mode,
  };
}

function adjustment(taxRate: number, leading: number, discount: number, mode: "net" | "gross"): PositionSums {
  return {
    priceNet: 0,
    priceGross: 0,
    priceTax: 0,
    sumNet: mode === "net" ? leading : 0,
    sumGross: mode === "gross" ? leading : 0,
    sumTax: 0,
    sumDiscount: discount,
    taxRate,
    mode,
  };
}
