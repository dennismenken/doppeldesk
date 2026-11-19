import type { IncomingHttpHeaders } from "node:http";
import type { FastifyRequest } from "fastify";
import { isPlainObject } from "../lib/object.ts";

/**
 * API token of a request: "Authorization: <token>" (sevDesk style), tolerating a
 * "Bearer " prefix. sevDesk removed the "token" query parameter on 2025-04-29
 * (https://tech.sevdesk.com/api_news/posts/2025_02_06-authentication-method-removed/),
 * so a token passed that way does not authenticate.
 */
export function extractToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.trim() !== "") return header.trim().replace(/^Bearer\s+/i, "");
  return undefined;
}

/**
 * Query without the "token" parameter. Clients may still send it; it is stripped so it
 * never reaches handlers or the request log.
 */
export function queryWithoutToken(query: unknown): Record<string, unknown> {
  if (!isPlainObject(query)) return {};
  const { token: _token, ...rest } = query;
  return rest;
}

/** Headers that carry credentials; they never reach handlers or the request log. */
const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "x-doppeldesk-control-token",
]);

/** Request headers without credentials; repeated headers are joined with ", ". */
export function safeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || CREDENTIAL_HEADERS.has(name)) continue;
    result[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

const REDACTED = "[redacted]";

/**
 * URL with the value of the "token" query parameter replaced, for server logs.
 * Other parameters keep their original encoding.
 */
export function redactTokenInUrl(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  const parts = url
    .slice(queryStart + 1)
    .split("&")
    .map((part) => {
      const rawKey = part.split("=", 1)[0] ?? "";
      return decodeQueryKey(rawKey) === "token" ? `${rawKey}=${REDACTED}` : part;
    });
  return `${url.slice(0, queryStart)}?${parts.join("&")}`;
}

function decodeQueryKey(raw: string): string {
  const spaced = raw.replaceAll("+", " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}
