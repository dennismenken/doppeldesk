import type { PlainObject } from "../../lib/object.ts";
import { compareIds, type Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { toNumber } from "./money.ts";
import { isRefTo, refId } from "./refs.ts";
import { isBlank } from "./validation.ts";

/** Where the positions of a document type live, e.g. InvoicePos.invoice -> Invoice. */
export interface PositionModel {
  /** Collection of the positions, e.g. "InvoicePos". */
  model: string;
  /** Field of a position that references its document, e.g. "invoice". */
  parentField: string;
  /** Collection of the documents, e.g. "Invoice". */
  parentModel: string;
}

/** Positions of a document ordered by positionNumber (missing numbers last), then id. */
export function positionsOf(tenant: Tenant, positions: PositionModel, documentId: string): Doc[] {
  return tenant.store
    .collection(positions.model)
    .find((position) => isRefTo(position[positions.parentField], positions.parentModel, documentId))
    .sort(comparePositions);
}

/** Orders positions by positionNumber (missing numbers last), then by id. */
export function comparePositions(a: Doc, b: Doc): number {
  const left = isBlank(a.positionNumber) ? Number.POSITIVE_INFINITY : toNumber(a.positionNumber);
  const right = isBlank(b.positionNumber) ? Number.POSITIVE_INFINITY : toNumber(b.positionNumber);
  if (left !== right) return left < right ? -1 : 1;
  return compareIds(a, b);
}

/**
 * Order of a position list across documents (GET /InvoicePos and the like): grouped by
 * document (ascending id), then in document order, so limit/offset pages are stable and
 * never interleave the positions of different documents.
 */
export function documentPositionOrder(positions: PositionModel): (a: Doc, b: Doc) => number {
  const parentId = (position: Doc): string => refId(position[positions.parentField]) ?? "";
  return (a, b) => parentId(a).localeCompare(parentId(b), "en", { numeric: true }) || comparePositions(a, b);
}

/** Next free positionNumber after the highest one (0-based; assumption: sevDesk numbers from 0). */
export function nextPositionNumber(positions: readonly Readonly<PlainObject>[]): number {
  return (
    positions.reduce((highest, position) => Math.max(highest, toNumber(position.positionNumber, -1)), -1) + 1
  );
}
