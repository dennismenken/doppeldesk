import { notFound } from "../../lib/errors.ts";
import type { PlainObject } from "../../lib/object.ts";
import { toIso } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { defaultAddressFields } from "../shared/contacts.ts";
import { createDocument } from "../shared/documents.ts";
import { isTrue } from "../shared/list.ts";
import { assertNumberAvailable, assignNumber } from "../shared/numbering.ts";
import { nextPositionNumber } from "../shared/positions.ts";
import { readRef, refId } from "../shared/refs.ts";
import { assertTaxRates } from "../shared/taxRules.ts";
import {
  deletedIds,
  expectedRefError,
  factoryPart,
  isBlank,
  listOf,
  validationError,
} from "../shared/validation.ts";
import { CREDIT_NOTE, CREDIT_NOTE_NUMBERED, CREDIT_NOTE_POS, CREDIT_NOTE_STATUS } from "./constants.ts";
import {
  assertBookingCategoryRules,
  assertCreateRequirements,
  assertNotEnshrined,
  assertReferencesExist,
  headUpdate,
  isNetMode,
  normalizeHead,
} from "./head.ts";
import {
  creditNotePositions,
  insertPosition,
  normalizePosition,
  recalculateCreditNote,
} from "./positions.ts";

/** One position write of an update: a new position (no target) or a change of a stored one. */
interface PositionSave {
  target: Doc | undefined;
  fields: PlainObject;
}

/** A credit note with its positions, as the factory endpoints return it. */
export interface SavedCreditNote {
  creditNote: Doc;
  creditNotePos: Doc[];
}

/**
 * Creates or updates a credit note like POST /CreditNote/Factory/saveCreditNote.
 * Factory rules (live-verified for invoices, applied the same way here): the head and every
 * position need "objectName" and "mapAll: true", otherwise 400. A head with "id" updates;
 * without "mapAll" an update is ignored silently and the unchanged credit note comes back.
 * New credit notes are always drafts (status 100) and need at least one position.
 */
export function saveCreditNote(tenant: Tenant, body: PlainObject): SavedCreditNote {
  const headInput = factoryPart("creditNote", body.creditNote, CREDIT_NOTE);
  const positionInputs = listOf(body.creditNotePosSave).map((position) =>
    factoryPart("creditNotePosSave", position, CREDIT_NOTE_POS),
  );
  const deletions = deletedIds("creditNotePosDelete", body.creditNotePosDelete, CREDIT_NOTE_POS);
  const id = refId(headInput.id);
  if (id === undefined) {
    if (!isTrue(headInput.mapAll)) throw expectedRefError("creditNote", headInput);
    return createFromFactory(tenant, body, headInput, positionInputs);
  }
  const existing = tenant.store.collection(CREDIT_NOTE).require(id);
  if (!isTrue(headInput.mapAll))
    return { creditNote: existing, creditNotePos: creditNotePositions(tenant, id) };
  return updateFromFactory(tenant, existing, headInput, positionInputs, deletions);
}

/**
 * Inserts a draft credit note with positions from already normalized fields: assigns the
 * number (a given number is kept when it is still free, else 422), stamps defaults and computes all sums. Shared by the
 * factory and the createFrom* endpoints.
 */
export function insertCreditNote(
  tenant: Tenant,
  head: PlainObject,
  positions: readonly PlainObject[],
): SavedCreditNote {
  const date = head.creditNoteDate;
  const creditNoteNumber = assignNumber(tenant, "creditNote", CREDIT_NOTE_NUMBERED, head.creditNoteNumber);
  const creditNote = createDocument(tenant, CREDIT_NOTE, head, {
    defaults: {
      // Assumption: default header like the invoice default ("Rechnung Nr. RE-1001").
      header: `Gutschrift Nr. ${creditNoteNumber}`,
      deliveryDate: date,
      showNet: true,
      smallSettlement: false,
      origin: null,
      sendDate: null,
      sendType: null,
      payDate: null,
      paidAmount: 0,
      enshrined: null,
    },
    overrides: {
      creditNoteNumber,
      status: String(CREDIT_NOTE_STATUS.draft),
      // Assumption: without an authenticated user concept the contact person is the creating user.
      createUser: readRef(head.contactPerson, "SevUser") ?? null,
    },
  });
  positions.forEach((fields, index) => {
    insertPosition(tenant, creditNote, fields, index);
  });
  const calculated = recalculateCreditNote(tenant, creditNote.id);
  return { creditNote: calculated, creditNotePos: creditNotePositions(tenant, creditNote.id) };
}

/**
 * Updates head fields of an existing credit note (PUT /CreditNote/{id}): enshrined credit
 * notes are refused with 422, status and sums cannot be set, totals are recomputed.
 */
export function updateCreditNoteHead(tenant: Tenant, id: string, input: PlainObject): Doc {
  const collection = tenant.store.collection(CREDIT_NOTE);
  const existing = collection.require(id);
  assertNotEnshrined(existing);
  const patch = headUpdate(existing, normalizeHead(input));
  assertBookingCategoryRules({ ...existing, ...patch });
  assertReferencesExist(tenant, patch);
  assertCreditNoteNumberAvailable(tenant, patch, id);
  collection.update(id, { ...patch, update: toIso(tenant.clock.now()) });
  return recalculateCreditNote(tenant, id);
}

/** 422 when a changed credit note number is used by another credit note. */
function assertCreditNoteNumberAvailable(tenant: Tenant, patch: PlainObject, id: string): void {
  if (!isBlank(patch.creditNoteNumber)) {
    assertNumberAvailable(tenant, CREDIT_NOTE_NUMBERED, String(patch.creditNoteNumber), id);
  }
}

function createFromFactory(
  tenant: Tenant,
  body: PlainObject,
  headInput: PlainObject,
  positionInputs: readonly PlainObject[],
): SavedCreditNote {
  for (const position of positionInputs) {
    if (!isTrue(position.mapAll)) throw expectedRefError("creditNotePosSave", position);
  }
  const head = normalizeHead(headInput);
  assertCreateRequirements(head);
  assertBookingCategoryRules(head);
  assertReferencesExist(tenant, head);
  // Assumption: creating a credit note without any position is refused (required since API release 4.159).
  if (positionInputs.length === 0) throw validationError("A credit note needs at least one position");
  const netMode = isNetMode(head);
  const positions = positionInputs.map((position) => normalizePosition(position, undefined, netMode));
  assertTaxRates(head, positions);
  const address =
    isTrue(body.takeDefaultAddress) && isBlank(head.address) ? defaultAddressFields(tenant, head) : {};
  return insertCreditNote(tenant, { ...head, ...address }, positions);
}

function updateFromFactory(
  tenant: Tenant,
  existing: Doc,
  headInput: PlainObject,
  positionInputs: readonly PlainObject[],
  deletions: readonly string[],
): SavedCreditNote {
  assertNotEnshrined(existing);
  const patch = headUpdate(existing, normalizeHead(headInput));
  assertBookingCategoryRules({ ...existing, ...patch });
  assertReferencesExist(tenant, patch);
  assertCreditNoteNumberAvailable(tenant, patch, existing.id);
  const current = creditNotePositions(tenant, existing.id);
  for (const deletedId of deletions) {
    if (!current.some((position) => position.id === deletedId)) throw notFound(CREDIT_NOTE_POS, deletedId);
  }
  const remaining = current.filter((position) => !deletions.includes(position.id));
  const netMode = isNetMode({ ...existing, ...patch });
  const saves = positionInputs.flatMap((input): PositionSave[] => {
    const positionId = refId(input.id);
    if (positionId === undefined) {
      if (!isTrue(input.mapAll)) throw expectedRefError("creditNotePosSave", input);
      return [{ target: undefined, fields: normalizePosition(input, undefined, netMode) }];
    }
    const target = remaining.find((position) => position.id === positionId);
    if (target === undefined) throw notFound(CREDIT_NOTE_POS, positionId);
    // Updating a position without mapAll is ignored silently, like the head.
    if (!isTrue(input.mapAll)) return [];
    return [{ target, fields: normalizePosition(input, target, netMode) }];
  });
  const created = saves.filter((save) => save.target === undefined).length;
  if (remaining.length + created === 0) throw validationError("A credit note needs at least one position");
  const changed = new Set(saves.flatMap((save) => save.target?.id ?? []));
  assertTaxRates({ ...existing, ...patch }, [
    ...remaining.filter((position) => !changed.has(position.id)),
    ...saves.map((save) => ({ ...save.target, ...save.fields })),
  ]);

  const now = toIso(tenant.clock.now());
  const positions = tenant.store.collection(CREDIT_NOTE_POS);
  const head =
    tenant.store.collection(CREDIT_NOTE).update(existing.id, { ...patch, update: now }) ?? existing;
  for (const deletedId of deletions) positions.delete(deletedId);
  let positionNumber = nextPositionNumber(remaining);
  for (const save of saves) {
    if (save.target !== undefined) {
      positions.update(save.target.id, { ...save.fields, update: now });
    } else {
      insertPosition(tenant, head, save.fields, positionNumber);
      positionNumber += 1;
    }
  }
  return {
    creditNote: recalculateCreditNote(tenant, existing.id),
    creditNotePos: creditNotePositions(tenant, existing.id),
  };
}
