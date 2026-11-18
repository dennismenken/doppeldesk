import { isPlainObject } from "../lib/object.ts";
import type { OpenApiDocument, Schema } from "./types.ts";

/**
 * Known errors of the sevDesk spec, corrected in one place right after loading, so every
 * route (generic or domain) shapes responses alike. Each patch states its evidence. A patch
 * whose target is missing in a newer spec is skipped and reported as not applied.
 */
interface SpecPatch {
  id: string;
  description: string;
  /** Applies the patch; returns false when the target does not exist (nothing changed). */
  apply(document: OpenApiDocument): boolean;
}

const STRING_AMOUNT: Schema = { type: "string", readOnly: true };

/** Response schemas of document positions. */
const POSITION_RESPONSE_SCHEMAS = [
  "Model_InvoicePosResponse",
  "Model_creditNotePosResponse",
  "Model_OrderPosResponse",
] as const;

const SPEC_PATCHES: readonly SpecPatch[] = [
  {
    id: "invoice-position-quantity",
    description:
      "Model_InvoicePosResponse.quantity is declared boolean (example true); it is an amount and rendered as string like quantity of order and credit note positions",
    apply: (document) => {
      const quantity = schemas(document).Model_InvoicePosResponse?.properties?.quantity;
      if (quantity === undefined) return false;
      Object.assign(quantity, { type: "string", example: "1" });
      return true;
    },
  },
  {
    id: "position-sums",
    description:
      "Position responses lack sumNet, sumTax and sumGross; live invoice and credit note positions carry them (observed on the live API), order positions by assumption",
    apply: (document) => {
      let applied = false;
      for (const name of POSITION_RESPONSE_SCHEMAS) {
        const properties = schemas(document)[name]?.properties;
        if (properties === undefined) continue;
        for (const field of ["sumNet", "sumTax", "sumGross"]) properties[field] ??= { ...STRING_AMOUNT };
        applied = true;
      }
      return applied;
    },
  },
  {
    id: "ids-as-strings",
    description:
      'Some objects and references ({id, objectName}) declare id as integer (e.g. Model_PartResponse, sevClient of Contact, whose example is the string "0"); live references carry string ids, and an object id must equal the id of references to it',
    apply: (document) => {
      let applied = false;
      visitSchemas(document, (schema) => {
        const properties = schema.properties;
        const id = properties?.id;
        if (properties?.objectName === undefined || id === undefined || id.type !== "integer") return;
        id.type = "string";
        applied = true;
      });
      return applied;
    },
  },
];

/** Result of applying the patches: ids of applied and of skipped patches. */
export interface SpecPatchReport {
  applied: string[];
  skipped: string[];
}

/** Applies all known spec corrections to the (freshly parsed, unshared) document. */
export function applySpecPatches(document: OpenApiDocument): SpecPatchReport {
  const report: SpecPatchReport = { applied: [], skipped: [] };
  for (const patch of SPEC_PATCHES) {
    (patch.apply(document) ? report.applied : report.skipped).push(patch.id);
  }
  return report;
}

function schemas(document: OpenApiDocument): Record<string, Schema> {
  return document.components?.schemas ?? {};
}

/** Calls the visitor for every schema-like object in components and path responses. */
function visitSchemas(document: OpenApiDocument, visitor: (schema: Schema) => void): void {
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isPlainObject(node) || seen.has(node)) return;
    seen.add(node);
    if (isPlainObject(node.properties)) visitor(node as Schema);
    for (const value of Object.values(node)) visit(value);
  };
  visit(document.components);
  visit(document.paths);
}
