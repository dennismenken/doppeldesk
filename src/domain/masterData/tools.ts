import type { RouteDefinition } from "../../routes/types.ts";

/**
 * Bookkeeping system version of the account. Assumption: DoppelDesk implements only the
 * current "2.0" tax logic (taxRule) and always reports it.
 */
export const BOOKKEEPING_SYSTEM_VERSION = "2.0";

export const toolsRoutes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/Tools/bookkeepingSystemVersion",
    handler: () => ({ objects: { version: BOOKKEEPING_SYSTEM_VERSION } }),
  },
];
