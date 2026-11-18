import { pathParam } from "../../routes/context.ts";
import { getModel, listModel } from "../../routes/generic.ts";
import type { RouteDefinition } from "../../routes/types.ts";

/**
 * Reference models the real sevDesk API serves but the OpenAPI spec does not describe.
 * Assumption: read-only here (list with limit/offset/countAll and equality filters,
 * plus get by id); their content comes from the seed or the state import.
 */
const READ_ONLY_MODELS = ["StaticCountry", "SevUser", "Category", "Unity", "TaxRule", "TaxSet"] as const;

function readOnlyRoutes(models: readonly string[]): RouteDefinition[] {
  return models.flatMap((model) => [
    { method: "GET" as const, path: `/${model}`, handler: (context) => listModel(context, model) },
    {
      method: "GET" as const,
      path: `/${model}/{id}`,
      handler: (context) => getModel(context, model, pathParam(context, "id")),
    },
  ]);
}

export const referenceRoutes: RouteDefinition[] = readOnlyRoutes(READ_ONLY_MODELS);
