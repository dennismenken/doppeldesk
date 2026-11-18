import { pathParam } from "../../routes/context.ts";
import { getModel, listModel } from "../../routes/generic.ts";
import type { RouteDefinition } from "../../routes/types.ts";
import { updateDocument } from "../shared/documents.ts";

/**
 * SevClient: the spec only declares PUT /SevClient/{id}/updateExportConfig; reading the
 * client is an extra route (assumption: real clients use GET /SevClient and GET /SevClient/{id}).
 */
export const sevClientRoutes: RouteDefinition[] = [
  { method: "GET", path: "/SevClient", handler: (context) => listModel(context, "SevClient") },
  {
    method: "GET",
    path: "/SevClient/{id}",
    handler: (context) => getModel(context, "SevClient", pathParam(context, "id")),
  },
  {
    method: "PUT",
    path: "/SevClient/{SevClientId}/updateExportConfig",
    handler: (context) => {
      const { accountantNumber, accountantClientNumber, accountingYearBegin } = context.input;
      updateDocument(context.tenant, "SevClient", pathParam(context, "SevClientId"), {
        accountantNumber,
        accountantClientNumber,
        accountingYearBegin,
      });
      return { objects: null };
    },
  },
];
