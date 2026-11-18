import type { RouteContext } from "./types.ts";

/**
 * Path parameter by the route template's own name. Throws when the template has no
 * such parameter (a programming error in the route definition, not a client error).
 */
export function pathParam(context: RouteContext, name: string): string {
  const value = context.params[name];
  if (value === undefined) throw new Error(`Route ${context.route.path} has no path parameter "${name}"`);
  return value;
}
