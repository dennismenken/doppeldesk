import { notFound } from "../../lib/errors.ts";
import { isPlainObject, type PlainObject } from "../../lib/object.ts";
import { startOfBerlinDay, toIso } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { defaultAddressFields } from "../shared/contacts.ts";
import { assertPositionDiscount } from "../shared/discounts.ts";
import { createDocument, DISCOUNTS } from "../shared/documents.ts";
import { isTrue } from "../shared/list.ts";
import { toNumber } from "../shared/money.ts";
import { assertNumberAvailable, assignNumber, type NumberRangeKey } from "../shared/numbering.ts";
import { nextPositionNumber } from "../shared/positions.ts";
import { isRefTo, refId, toRef } from "../shared/refs.ts";
import { assertTaxRates } from "../shared/taxRules.ts";
import { deletedIds, expectedRefError, isBlank, listOf, missingParameters } from "../shared/validation.ts";
import {
  CANCELLATION_NUMBER_RANGE,
  INVOICE,
  INVOICE_NUMBER_RANGE,
  INVOICE_NUMBERED,
  INVOICE_POS,
  INVOICE_STATUS,
  REMINDER_NUMBER_RANGE,
} from "./constants.ts";
import { assertNotEnshrined, requireInvoice } from "./guards.ts";
import { assertDeliveryDate, headerUpdate, normalizeHeader } from "./header.ts";
import {
  assertHeaderDiscounts,
  computePosition,
  invoiceDiscounts,
  invoicePositions,
  positionClientFields,
  recalculateInvoice,
} from "./positions.ts";

/**
 * saveInvoice body fields the request value check skips: the spec declares deliveryDateUntil
 * as integer, the header normalization reads it like the other date fields (any date input).
 */
export const SAVE_INVOICE_UNVALIDATED_FIELDS: readonly string[] = ["invoice.deliveryDateUntil"];

/** Result of the invoice factory: the stored invoice and all its positions. */
export interface SavedInvoice {
  invoice: Doc;
  invoicePos: Doc[];
}

/**
 * POST /Invoice/Factory/saveInvoice. Creates an invoice with positions and discounts,
 * or updates one when invoice.id is given.
 * Live-verified: the header needs objectName and mapAll:true, otherwise HTTP 400
 * "invoice expected array with 'id' and 'objectName'"; an update with id but without
 * mapAll answers 201 and changes nothing.
 */
export function saveInvoice(tenant: Tenant, body: PlainObject): SavedInvoice {
  const header = body.invoice;
  if (!isPlainObject(header) || header.objectName !== INVOICE) throw expectedRefError("invoice", header);
  const id = refId(header.id);
  if (id !== undefined) {
    const existing = requireInvoice(tenant, id);
    if (!isTrue(header.mapAll)) return { invoice: existing, invoicePos: invoicePositions(tenant, id) };
    return updateInvoice(tenant, existing, header, body);
  }
  if (!isTrue(header.mapAll)) throw expectedRefError("invoice", header);

  const positions = readPositionSaves(body.invoicePosSave);
  const unknownDelete = deletedIds("invoicePosDelete", body.invoicePosDelete, INVOICE_POS)[0];
  if (unknownDelete !== undefined) throw notFound(INVOICE_POS, unknownDelete);
  const discounts = readDiscountSaves(body.discountSave);
  const normalized = normalizeHeader(tenant, header, true);
  const withAddress = isTrue(body.takeDefaultAddress)
    ? { ...normalized, ...defaultAddressFields(tenant, normalized) }
    : normalized;
  return createInvoice(tenant, { ...withAddress, status: header.status }, positions, discounts);
}

/**
 * Creates an invoice from normalized header data and position/discount input
 * (service for seeds and other modules; no factory envelope checks). The invoice
 * is a draft (100); a recurring invoice (WKR) may start deactivated (50). Other
 * status values are ignored (assumption: Update 2.0 only creates drafts, the spec
 * does not say whether other values fail or are ignored). The number comes from the
 * shared number range unless the header carries one; numbers are unique (422).
 */
export function createInvoice(
  tenant: Tenant,
  header: PlainObject,
  positions: readonly PlainObject[],
  discounts: readonly PlainObject[] = [],
): SavedInvoice {
  const draft = applyHeaderDefaults(tenant, header);
  for (const position of positions) assertNewPosition(position);
  const computed = positions.map((position) => computePosition(positionClientFields(position), draft));
  assertDeliveryDate(draft);
  assertTaxRates(draft, computed);
  assertHeaderDiscounts(computed, discounts, draft);

  const invoiceType = String(draft.invoiceType);
  const invoiceNumber = assignNumber(
    tenant,
    numberRangeFor(invoiceType),
    INVOICE_NUMBERED,
    draft.invoiceNumber,
  );
  const deactivated = invoiceType === "WKR" && String(draft.status) === INVOICE_STATUS.deactivated;
  const invoice = createDocument(tenant, INVOICE, draft, {
    defaults: { header: defaultHeaderText(invoiceType, invoiceNumber) },
    overrides: {
      invoiceNumber,
      status: deactivated ? INVOICE_STATUS.deactivated : INVOICE_STATUS.draft,
      createUser: draft.contactPerson ?? null,
    },
  });
  computed.forEach((position, index) => {
    insertPosition(tenant, invoice.id, { positionNumber: index, ...position });
  });
  for (const discount of discounts) insertDiscount(tenant, invoice.id, discount);
  const stored = recalculateInvoice(tenant, invoice);
  return { invoice: stored, invoicePos: invoicePositions(tenant, stored.id) };
}

/** Stores a position of an invoice (computed fields must already be set). */
export function insertPosition(tenant: Tenant, invoiceId: string, data: PlainObject): Doc {
  return createDocument(tenant, INVOICE_POS, data, {
    overrides: { invoice: toRef(invoiceId, INVOICE) },
  });
}

/** Number range of an invoice type (see the constants for the assumptions). */
export function numberRangeFor(invoiceType: string): NumberRangeKey {
  if (invoiceType === "SR") return CANCELLATION_NUMBER_RANGE;
  if (invoiceType === "MA") return REMINDER_NUMBER_RANGE;
  return INVOICE_NUMBER_RANGE;
}

function updateInvoice(tenant: Tenant, existing: Doc, header: PlainObject, body: PlainObject): SavedInvoice {
  assertNotEnshrined(existing);
  const positions = tenant.store.collection(INVOICE_POS);
  const discounts = tenant.store.collection(DISCOUNTS);
  const patch = headerUpdate(existing, normalizeHeader(tenant, header, false));
  const merged: PlainObject = {
    ...existing,
    ...patch,
    ...(isTrue(body.takeDefaultAddress) ? defaultAddressFields(tenant, { ...existing, ...patch }) : {}),
  };

  const ownPosition = (posId: string): Doc => {
    const pos = positions.get(posId);
    if (pos === undefined || !isRefTo(pos.invoice, INVOICE, existing.id)) throw notFound(INVOICE_POS, posId);
    return pos;
  };
  const deletes = deletedIds("invoicePosDelete", body.invoicePosDelete, INVOICE_POS).map(ownPosition);
  const saves = readPositionSaves(body.invoicePosSave).map((data) => {
    const posId = refId(data.id);
    if (posId === undefined) assertNewPosition(data);
    return { target: posId === undefined ? undefined : ownPosition(posId), data: positionClientFields(data) };
  });
  const discountDeletes = deletedIds("discountDelete", body.discountDelete, DISCOUNTS).map((discountId) => {
    const discount = discounts.get(discountId);
    if (discount === undefined || !isRefTo(discount.object, INVOICE, existing.id)) {
      throw notFound(DISCOUNTS, discountId);
    }
    return discount;
  });
  const discountSaves = readDiscountSaves(body.discountSave);

  // Validate the resulting state before writing anything.
  const replaced = new Set([...deletes, ...saves.flatMap((save) => save.target ?? [])].map((pos) => pos.id));
  const resulting = [
    ...invoicePositions(tenant, existing.id).filter((pos) => !replaced.has(pos.id)),
    ...saves.map((save) => ({ ...save.target, ...save.data })),
  ].map((pos) => computePosition(pos, merged));
  assertDeliveryDate(merged);
  assertTaxRates(merged, resulting);
  const deletedDiscounts = new Set(discountDeletes.map((discount) => discount.id));
  assertHeaderDiscounts(
    resulting,
    [
      ...invoiceDiscounts(tenant, existing.id).filter((discount) => !deletedDiscounts.has(discount.id)),
      ...discountSaves,
    ],
    merged,
  );
  if (!isBlank(patch.invoiceNumber)) {
    assertNumberAvailable(tenant, INVOICE_NUMBERED, String(patch.invoiceNumber), existing.id);
  }

  const now = toIso(tenant.clock.now());
  const updated =
    tenant.store.collection(INVOICE).update(existing.id, { ...merged, update: now }) ?? existing;
  for (const pos of deletes) positions.delete(pos.id);
  for (const discount of discountDeletes) discounts.delete(discount.id);
  let positionNumber = nextPositionNumber(invoicePositions(tenant, existing.id));
  for (const save of saves) {
    if (save.target === undefined)
      insertPosition(tenant, existing.id, { positionNumber: positionNumber++, ...save.data });
    else positions.update(save.target.id, { ...save.data, update: now });
  }
  // Header changes (showNet, taxRate) can change the amounts of every position.
  for (const pos of invoicePositions(tenant, existing.id))
    positions.replace(pos.id, computePosition(pos, updated));
  for (const discount of discountSaves) insertDiscount(tenant, existing.id, discount);
  const stored = recalculateInvoice(tenant, updated);
  return { invoice: stored, invoicePos: invoicePositions(tenant, stored.id) };
}

/**
 * Header defaults of a new invoice. Assumptions: invoiceDate today, currency EUR, net prices,
 * no small business regulation (like orders and credit notes).
 */
function applyHeaderDefaults(tenant: Tenant, header: PlainObject): PlainObject {
  return {
    invoiceType: "RE",
    currency: "EUR",
    discount: 0,
    showNet: true,
    smallSettlement: false,
    invoiceDate: toIso(startOfBerlinDay(tenant.clock.now())),
    paidAmount: 0,
    payDate: null,
    enshrined: null,
    sendDate: null,
    sendType: null,
    origin: null,
    ...withoutUndefined(header),
  };
}

/** Assumption: sevDesk's default header text ("Rechnung Nr. RE-1001"), per type. */
function defaultHeaderText(invoiceType: string, invoiceNumber: string): string {
  if (invoiceType === "SR") return `Stornorechnung Nr. ${invoiceNumber}`;
  if (invoiceType === "MA") return `Mahnung Nr. ${invoiceNumber}`;
  return `Rechnung Nr. ${invoiceNumber}`;
}

/** New positions need a quantity (spec: required in Model_InvoicePos). */
function assertNewPosition(position: PlainObject): void {
  if (isBlank(position.quantity)) throw missingParameters(["invoicePosSave[quantity]"], 422);
}

/**
 * invoicePosSave: list of positions, each with objectName "InvoicePos" and mapAll.
 * Assumption: positions without objectName/mapAll fail like the header does.
 */
function readPositionSaves(value: unknown): PlainObject[] {
  return listOf(value).map((item) => {
    if (!isPlainObject(item) || item.objectName !== INVOICE_POS || !isTrue(item.mapAll)) {
      throw expectedRefError("invoicePosSave", item);
    }
    assertPositionDiscount(item.discount);
    return item;
  });
}

/** discountSave: [{discount, text, percentage, value, objectName: "Discounts", mapAll}]. */
function readDiscountSaves(value: unknown): PlainObject[] {
  return listOf(value).map((item) => {
    if (!isPlainObject(item)) throw expectedRefError("discountSave", item);
    return item;
  });
}

function insertDiscount(tenant: Tenant, invoiceId: string, data: PlainObject): Doc {
  return createDocument(tenant, DISCOUNTS, data, {
    overrides: {
      object: toRef(invoiceId, INVOICE),
      discount: data.discount === undefined ? true : isTrue(data.discount),
      percentage: isTrue(data.percentage),
      value: toNumber(data.value),
    },
  });
}

function withoutUndefined(data: PlainObject): PlainObject {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}
