/** HTTP methods DoppelDesk routes can use. */
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Narrows an arbitrary method string (any case) to a supported method. */
export function toHttpMethod(value: string): HttpMethod | undefined {
  const upper = value.toUpperCase();
  return HTTP_METHODS.find((method) => method === upper);
}

/** Splits a path or template into non-empty segments. */
export function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

/** True for template segments like "{invoiceId}". */
export function isParamSegment(segment: string): boolean {
  return /^\{[^{}]+\}$/.test(segment);
}

/** Parameter names of a template in order, e.g. "/Invoice/{invoiceId}" -> ["invoiceId"]. */
export function paramNames(template: string): string[] {
  return splitPath(template)
    .filter(isParamSegment)
    .map((segment) => segment.slice(1, -1));
}

/** Template with all parameter names erased: "/Invoice/{invoiceId}" -> "/Invoice/{}". */
export function normalizeTemplate(template: string): string {
  return `/${splitPath(template)
    .map((segment) => (isParamSegment(segment) ? "{}" : segment))
    .join("/")}`;
}

/** Identity of a route independent of parameter names, e.g. "GET /Invoice/{}". */
export function routeKey(method: HttpMethod, template: string): string {
  return `${method} ${normalizeTemplate(template)}`;
}

/**
 * Fastify path with positional parameter names (":p0", ":p1"), so that routes whose
 * templates use different names for the same position never conflict in the router.
 */
export function toFastifyPath(prefix: string, template: string): string {
  let index = 0;
  const segments = splitPath(template).map((segment) => (isParamSegment(segment) ? `:p${index++}` : segment));
  return `${prefix}/${segments.join("/")}`;
}

/** True when a concrete path (without base path) matches a template. */
export function matchesTemplate(template: string, path: string): boolean {
  const expected = splitPath(template);
  const actual = splitPath(path);
  if (expected.length !== actual.length) return false;
  return expected.every((segment, index) => isParamSegment(segment) || segment === actual[index]);
}
