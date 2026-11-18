import type { PlainObject } from "../../lib/object.ts";
import { toIso } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { assertPositionDiscount } from "../shared/discounts.ts";
import { clientFields, createDocument } from "../shared/documents.ts";
import {
  computeDocumentTotals,
  computePositionSums,
  type PositionSums,
  roundMoney,
  toNumber,
} from "../shared/money.ts";
import { positionsOf } from "../shared/positions.ts";
import { toRef } from "../shared/refs.ts";
import { isBlank, missingParameters, requireRefTo } from "../shared/validation.ts";
import { CREDIT_NOTE, CREDIT_NOTE_POS, CREDIT_NOTE_POSITIONS, POSITION_SERVER_FIELDS } from "./constants.ts";
import { isNetMode } from "./head.ts";

/** Stored positions of a credit note ordered by positionNumber, then id. */
export function creditNotePositions(tenant: Tenant, creditNoteId: string): Doc[] {
  return positionsOf(tenant, CREDIT_NOTE_POSITIONS, creditNoteId);
}

/**
 * Normalizes client position fields into stored fields (derived sums are recomputed by
 * recalculateCreditNote). Without "existing" the position is new and quantity, taxRate
 * and unity are required (spec "Model_creditNotePos.required"). The unit price comes from
 * "price"; Assumption: without it the net or gross unit price is taken depending on showNet.
 */
export function normalizePosition(
  input: PlainObject,
  existing: Doc | undefined,
  netMode: boolean,
): PlainObject {
  const fields: PlainObject = {};
  for (const [key, value] of Object.entries(clientFields(input))) {
    if (POSITION_SERVER_FIELDS.has(key) || key === "price") continue;
    fields[key] = value;
  }
  if (existing === undefined) {
    const missing = ["unity", "taxRate", "quantity"].filter((key) => isBlank(fields[key]));
    if (missing.length > 0) throw missingParameters(missing, 422);
  }
  if (!isBlank(fields.unity)) fields.unity = requireRefTo("unity", fields.unity, "Unity");
  if (!isBlank(fields.part)) fields.part = requireRefTo("part", fields.part, "Part");
  assertPositionDiscount(fields.discount);
  if (!isBlank(fields.quantity)) fields.quantity = toNumber(fields.quantity);
  if (!isBlank(fields.taxRate)) fields.taxRate = toNumber(fields.taxRate);
  const price = [input.price, netMode ? input.priceNet : input.priceGross].find((value) => !isBlank(value));
  if (price !== undefined) fields.price = toNumber(price);
  else if (existing === undefined) fields.price = 0;
  return fields;
}

/** Inserts a new position with its derived amounts. */
export function insertPosition(
  tenant: Tenant,
  creditNote: Doc,
  fields: PlainObject,
  positionNumber: number,
): Doc {
  return createDocument(tenant, CREDIT_NOTE_POS, fields, {
    defaults: { positionNumber, discount: null, optional: false },
    overrides: { creditNote: toRef(creditNote.id, CREDIT_NOTE) },
  });
}

/**
 * Recomputes all position amounts and the header totals of a credit note from the stored
 * unit prices, quantities, tax rates and discounts, using the credit note's net or gross
 * mode. Amounts stay positive (live-verified for positions). Writes only what changed.
 */
export function recalculateCreditNote(tenant: Tenant, creditNoteId: string): Doc {
  const collection = tenant.store.collection(CREDIT_NOTE);
  const creditNote = collection.require(creditNoteId);
  const mode = isNetMode(creditNote) ? "net" : "gross";
  const now = toIso(tenant.clock.now());
  const sums: PositionSums[] = [];
  for (const position of creditNotePositions(tenant, creditNote.id)) {
    const computed = computePositionSums({
      quantity: toNumber(position.quantity),
      price: toNumber(position.price),
      taxRate: toNumber(position.taxRate),
      discount: toNumber(position.discount),
      mode,
    });
    sums.push(computed);
    const derived: PlainObject = {
      priceNet: computed.priceNet,
      priceGross: computed.priceGross,
      priceTax: computed.priceTax,
      sumNet: computed.sumNet,
      sumGross: computed.sumGross,
      sumTax: computed.sumTax,
      sumDiscount: computed.sumDiscount,
    };
    if (Object.entries(derived).some(([key, value]) => position[key] !== value)) {
      tenant.store.collection(CREDIT_NOTE_POS).update(position.id, { ...derived, update: now });
    }
  }
  const totals = computeDocumentTotals(sums, mode);
  const header: PlainObject = {
    sumNet: totals.sumNet,
    sumTax: totals.sumTax,
    sumGross: totals.sumGross,
    sumDiscounts: totals.sumDiscounts,
    sumNetForeignCurrency: totals.sumNet,
    sumTaxForeignCurrency: totals.sumTax,
    sumGrossForeignCurrency: totals.sumGross,
    sumDiscountsForeignCurrency: totals.sumDiscounts,
  };
  if (Object.entries(header).every(([key, value]) => creditNote[key] === value)) return creditNote;
  const updated = collection.update(creditNote.id, { ...header, update: now });
  return updated ?? creditNote;
}

/** Open amount of a credit note: gross sum minus what has been booked. */
export function openAmount(creditNote: Doc): number {
  return roundMoney(toNumber(creditNote.sumGross) - toNumber(creditNote.paidAmount));
}
