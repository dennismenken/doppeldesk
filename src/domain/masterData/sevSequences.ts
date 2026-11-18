import type { PlainObject } from "../../lib/object.ts";
import type { RouteContext, RouteDefinition, RouteResult } from "../../routes/types.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { peekFreeCustomerNumber } from "../contact/index.ts";
import { textValue } from "../contact/validation.ts";
import { CREDIT_NOTE_NUMBERED } from "../creditNote/constants.ts";
import { INVOICE_NUMBER_RANGE, INVOICE_NUMBERED, INVOICE_TYPES } from "../invoice/constants.ts";
import { NUMBER_RANGE_BY_TYPE, ORDER_NUMBERED, ORDER_TYPES } from "../order/constants.ts";
import { listDocuments } from "../shared/list.ts";
import { NUMBER_RANGES, type NumberRangeKey, peekFreeNumber } from "../shared/numbering.ts";
import { toRef } from "../shared/refs.ts";
import { invalidParameter, isBlank, missingParameters } from "../shared/validation.ts";

const MODEL = "SevSequence";

/** One number range as SevSequence: which object and type it numbers. */
interface SequenceDefinition {
  id: string;
  forObject: string;
  /** Sequence type as getByType expects it ("RE", "CN", "AN", ...). */
  type: string;
  /** Further document types that draw from the same range (e.g. SR and MA from RE). */
  sharedBy: readonly string[];
  range: NumberRangeKey;
  next(tenant: Tenant): string;
}

const documentNext =
  (range: NumberRangeKey, numbered: Parameters<typeof peekFreeNumber>[2]) =>
  (tenant: Tenant): string =>
    peekFreeNumber(tenant, range, numbered);

/**
 * The number ranges of shared/numbering.ts as SevSequence objects. The spec names
 * "GET /SevSequence/Factory/getByType?objectType=Invoice&type=RE" (credit notes: type=CN)
 * in its prose but declares neither the path nor a schema. Assumptions: the ids, the
 * field names (forObject, type, format, nextSequence) and the type of the customer
 * number range ("KD") are not verified; the content follows DoppelDesk's own ranges.
 */
const SEQUENCES: readonly SequenceDefinition[] = [
  {
    id: "1",
    forObject: "Invoice",
    type: "RE",
    sharedBy: INVOICE_TYPES.filter((type) => type !== "RE"),
    range: INVOICE_NUMBER_RANGE,
    next: documentNext(INVOICE_NUMBER_RANGE, INVOICE_NUMBERED),
  },
  {
    id: "2",
    forObject: "CreditNote",
    type: "CN",
    sharedBy: [],
    range: "creditNote",
    next: documentNext("creditNote", CREDIT_NOTE_NUMBERED),
  },
  ...ORDER_TYPES.map(
    (type, index): SequenceDefinition => ({
      id: String(3 + index),
      forObject: "Order",
      type,
      sharedBy: [],
      range: NUMBER_RANGE_BY_TYPE[type],
      next: documentNext(NUMBER_RANGE_BY_TYPE[type], ORDER_NUMBERED),
    }),
  ),
  {
    id: String(3 + ORDER_TYPES.length),
    forObject: "Contact",
    type: "KD",
    sharedBy: [],
    range: "customer",
    next: peekFreeCustomerNumber,
  },
];

/** A sequence as API object; nextSequence is the number part of the next free number. */
function present(tenant: Tenant, sequence: SequenceDefinition): PlainObject & { id: string } {
  const { prefix } = NUMBER_RANGES[sequence.range];
  return {
    id: sequence.id,
    objectName: MODEL,
    forObject: sequence.forObject,
    type: sequence.type,
    format: `${prefix}[%NUMBER%]`,
    nextSequence: sequence.next(tenant).slice(prefix.length),
    sevClient: toRef(tenant.sevClientId, "SevClient"),
  };
}

function listSequences(context: RouteContext): RouteResult {
  return listDocuments(
    SEQUENCES.map((sequence) => present(context.tenant, sequence)),
    context.query,
  );
}

/**
 * GET /SevSequence/Factory/getByType?objectType=Invoice&type=RE: the sequence numbering that
 * object type and document type. Without type, the first sequence of the object type.
 * Assumption: answers the single SevSequence object (shape not documented).
 */
function getByType(context: RouteContext): RouteResult {
  const { query } = context;
  const objectType = textValue(query.objectType);
  if (objectType === undefined) throw missingParameters(["objectType"]);
  const type = isBlank(query.type) ? undefined : textValue(query.type);
  const candidates = SEQUENCES.filter((sequence) => sequence.forObject === objectType);
  if (candidates.length === 0) {
    throw invalidParameter("objectType", { allowed: [...new Set(SEQUENCES.map((s) => s.forObject))] });
  }
  const sequence =
    type === undefined
      ? candidates[0]
      : candidates.find((candidate) => candidate.type === type || candidate.sharedBy.includes(type));
  if (sequence === undefined) {
    throw invalidParameter("type", { allowed: candidates.flatMap((c) => [c.type, ...c.sharedBy]) });
  }
  return { objects: present(context.tenant, sequence) };
}

export const sevSequenceRoutes: readonly RouteDefinition[] = [
  { method: "GET", path: `/${MODEL}`, handler: listSequences },
  { method: "GET", path: `/${MODEL}/Factory/getByType`, handler: getByType },
];
