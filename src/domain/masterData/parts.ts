import { ApiError, badRequest } from "../../lib/errors.ts";
import type { PlainObject } from "../../lib/object.ts";
import { pathParam } from "../../routes/context.ts";
import type { RouteContext, RouteDefinition, RouteResult } from "../../routes/types.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import {
  COMMON_DEPENDENTS,
  createDocument,
  deleteWithDependents,
  updateDocument,
} from "../shared/documents.ts";
import { toNumber } from "../shared/money.ts";
import {
  isReferenceIn,
  referencesTo,
  referencingModels,
  requireReferencedObjects,
} from "../shared/references.ts";
import { toRef } from "../shared/refs.ts";
import { isBlank, missingParameters, normalizeRefs, validationError } from "../shared/validation.ts";

const PART = "Part";

/** Required fields of Model_Part (spec). */
const REQUIRED_PART_FIELDS = ["taxRate", "unity", "stock", "name", "partNumber"] as const;

/** Tax rates a part can be created or changed with (spec, Update 2.0: "Parts", stricter validation). */
const ALLOWED_TAX_RATES: readonly number[] = [0, 7, 19];

/** Category 1 is "Standard" for parts (knowledge base, third-party source). */
const DEFAULT_PART_CATEGORY_ID = "1";

/** Part status 100 means active (knowledge base example). */
const ACTIVE_PART_STATUS = "100";

/** Reference fields of a part and the reference models they point to. */
const PART_REFS = { unity: "Unity", category: "Category" } as const;

/** Net price fields: the spec describes both "price" and "priceNet" as the net price. */
const NET_PRICE_FIELDS = ["price", "priceNet"] as const;

/**
 * Normalizes the references of a part body and answers 404 for a unity or category that does
 * not exist (both are reference models of the tenant, like the contact of a communication way).
 */
function partFields(tenant: Tenant, input: PlainObject): PlainObject {
  const fields = normalizeRefs(input, PART_REFS);
  requireReferencedObjects(tenant, fields, PART_REFS);
  return withMirroredNetPrice(fields);
}

/**
 * "price" and "priceNet" are both the net price (spec), so one given without the other sets
 * both. Assumption: priceGross is not derived, the spec says "until then the priceGross
 * parameter must be used".
 */
function withMirroredNetPrice(fields: PlainObject): PlainObject {
  const given = NET_PRICE_FIELDS.filter((key) => !isBlank(fields[key]));
  const [only] = given;
  if (given.length !== 1 || only === undefined) return fields;
  return { ...fields, price: fields[only], priceNet: fields[only] };
}

/** Required fields of a create (400 naming every missing one). */
function assertRequiredOnCreate(input: PlainObject): void {
  const missing = REQUIRED_PART_FIELDS.filter((field) => isBlank(input[field]));
  // Assumption: the exact sevDesk validation wording is unknown.
  if (missing.length > 0) throw missingParameters(missing);
}

/** An update must not clear a required field (400, like nulling the name of a contact). */
function assertRequiredKeptOnUpdate(input: PlainObject): void {
  const cleared = REQUIRED_PART_FIELDS.filter((field) => field in input && isBlank(input[field]));
  if (cleared.length > 0) throw missingParameters(cleared);
}

/**
 * Update 2.0 no longer creates or changes parts with a tax rate other than 0, 7 and 19 (spec,
 * "General stricter validation in PUT and POST endpoints"): 422. A blank value is not checked
 * here, the required-field rules answer it. Assumption: the message wording and that stored
 * parts with other rates stay as they are.
 */
function assertAllowedTaxRate(input: PlainObject): void {
  if (isBlank(input.taxRate)) return;
  const rate = toNumber(input.taxRate, Number.NaN);
  if (!ALLOWED_TAX_RATES.includes(rate)) {
    throw validationError(
      `Tax rate ${String(input.taxRate)} is not allowed for parts, allowed rates are ${ALLOWED_TAX_RATES.join(", ")}`,
    );
  }
}

/**
 * DELETE /Part/{partId} (extra route, missing in the spec): 409 while other objects reference
 * the part (positions of invoices, credit notes, orders, ...), so no reference dangles, like
 * for contacts; tag assignments are deleted with the part. Assumption: sevDesk refuses instead
 * of cascading; the wording is not verified.
 */
function deletePart(context: RouteContext): RouteResult {
  const { tenant } = context;
  const id = pathParam(context, "partId");
  tenant.store.collection(PART).require(id);
  const blocking = referencesTo(tenant, PART, id).filter(
    (reference) => !isReferenceIn(reference, COMMON_DEPENDENTS),
  );
  if (blocking.length > 0) {
    throw new ApiError(
      409,
      `The part is still referenced by ${referencingModels(blocking)} and can not be deleted`,
    );
  }
  deleteWithDependents(tenant, PART, id, []);
  return { objects: [null] };
}

/**
 * Parts: list and get are generic. Create validates the spec's required fields and the tax
 * rate (0, 7, 19) and applies defaults, update keeps them filled, create and update check unity and category (404) and
 * keep both net prices in sync, delete is an extra route (missing in the spec) that refuses
 * referenced parts, getStock reads the stored stock.
 * Assumption: "stock" is a plain stored field; invoices do not move it.
 */
export const partRoutes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/Part",
    handler: (context) => {
      assertRequiredOnCreate(context.input);
      assertAllowedTaxRate(context.input);
      const part = createDocument(context.tenant, PART, partFields(context.tenant, context.input), {
        defaults: {
          category: toRef(DEFAULT_PART_CATEGORY_ID, "Category"),
          stockEnabled: false,
          status: ACTIVE_PART_STATUS,
        },
      });
      return { objects: part };
    },
  },
  {
    method: "PUT",
    path: "/Part/{partId}",
    handler: (context) => {
      const id = pathParam(context, "partId");
      context.tenant.store.collection(PART).require(id);
      assertRequiredKeptOnUpdate(context.input);
      assertAllowedTaxRate(context.input);
      return {
        objects: updateDocument(context.tenant, PART, id, partFields(context.tenant, context.input)),
      };
    },
  },
  {
    method: "DELETE",
    path: "/Part/{partId}",
    handler: deletePart,
  },
  {
    method: "GET",
    path: "/Part/{partId}/getStock",
    handler: (context) => {
      const part = context.tenant.store.collection(PART).get(pathParam(context, "partId"));
      // Spec: 400 "Bad request. Part was not found".
      if (part === undefined) throw badRequest("Part was not found");
      return { objects: Math.trunc(toNumber(part.stock)) };
    },
  },
];
