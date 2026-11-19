import { badRequest } from "../lib/errors.ts";
import { matchesTemplate, normalizeTemplate } from "../lib/routePath.ts";

/** A request as seen by path patterns: concrete path (relative to the base path) and matched template. */
export interface PathTarget {
  path: string;
  route: string | null;
}

/**
 * Matches a path pattern used by faults and request-log filters:
 * - trailing "/*": the path segment and everything below it ("/Invoice/*" matches /Invoice,
 *   /Invoice/5 and /Invoice/5/bookAmount, but not /InvoicePos),
 * - other trailing "*": plain string prefix of the concrete path ("/Invoice*" also matches /InvoicePos),
 * - with "{...}": a route template ("/Invoice/{invoiceId}/cancelInvoice"), parameter names ignored,
 * - otherwise: the exact concrete path ("/Invoice/5/cancelInvoice").
 */
export function matchesPathPattern(pattern: string, target: PathTarget): boolean {
  const path = trimSlash(target.path);
  if (pattern.endsWith("/*")) {
    const base = trimSlash(pattern.slice(0, -2));
    return base === "/" || path === base || path.startsWith(`${base}/`);
  }
  if (pattern.endsWith("*")) return path.startsWith(trimSlash(pattern.slice(0, -1)));
  if (pattern.includes("{")) {
    if (target.route !== null && normalizeTemplate(pattern) === normalizeTemplate(target.route)) return true;
    return matchesTemplate(pattern, path);
  }
  return trimSlash(pattern) === path;
}

/**
 * Reads a user-supplied path pattern (faults, request-log filter): trimmed and relative
 * to the base path, with a leading slash ("Invoice/1/cancelInvoice" and
 * "/api/v1/Invoice/1/cancelInvoice" both become "/Invoice/1/cancelInvoice"). Throws ApiError 400 for patterns that could never match: a query string
 * or fragment (patterns match the path only) and a "*" anywhere but at the end (only a
 * trailing "*" is a wildcard, "{param}" stands for one segment).
 */
export function parsePathPattern(input: string, basePath: string, label: string): string {
  const pattern = input.trim();
  if (pattern === "") throw badRequest(`${label} is required`);
  if (/[?#]/.test(pattern)) {
    throw badRequest(`${label} must not contain a query string or fragment, patterns match the path only`);
  }
  if (pattern.slice(0, -1).includes("*")) {
    throw badRequest(
      `${label} may contain "*" only at the end, use a template such as /Invoice/{invoiceId}/cancelInvoice for one segment`,
    );
  }
  return stripBasePath(pattern.startsWith("/") ? pattern : `/${pattern}`, basePath);
}

/** Removes the base path prefix from a pattern with leading slash, if present. */
function stripBasePath(pattern: string, basePath: string): string {
  if (pattern === basePath) return "/";
  return pattern.startsWith(`${basePath}/`) ? pattern.slice(basePath.length) : pattern;
}

function trimSlash(path: string): string {
  const withLeading = path.startsWith("/") ? path : `/${path}`;
  return withLeading.length > 1 ? withLeading.replace(/\/+$/, "") : withLeading;
}
