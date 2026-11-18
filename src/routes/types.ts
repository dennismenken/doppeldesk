import type { Logger } from "../lib/logger.ts";
import type { PlainObject } from "../lib/object.ts";
import type { HttpMethod } from "../lib/routePath.ts";
import type { SpecIndex } from "../spec/specIndex.ts";
import type { Schema, SpecOperation } from "../spec/types.ts";
import type { Tenant } from "../tenant/tenant.ts";

/** Everything a route handler gets for one request. */
export interface RouteContext {
  /** The tenant selected by the API token. */
  tenant: Tenant;
  /** Path parameters by the route's own template names, e.g. {invoiceId: "5"}. */
  params: Readonly<Record<string, string>>;
  /** qs-parsed query ("contact[id]=1" -> {contact: {id: "1"}}), without "token". */
  query: PlainObject;
  /** Parsed body: JSON value, qs object for form data, Buffer for other content types, undefined if empty. */
  body: unknown;
  /** The body when it is a plain object, otherwise {} (convenience for JSON/form bodies). */
  input: PlainObject;
  /**
   * Request headers with lower-case names (e.g. "content-type", "host"). Credentials
   * (authorization, cookies, the control token) are never included.
   */
  headers: Readonly<Record<string, string>>;
  /** Spec operation for this method + path, if the spec declares it. */
  operation: SpecOperation | undefined;
  /** Route identity as registered. */
  route: { method: HttpMethod; path: string };
  /** Loaded spec (schemas, operations). */
  spec: SpecIndex;
  log: Logger;
}

/**
 * Handler result. The core wraps it as {"objects": ..., "total"?: ...} and shapes
 * "objects" with the route's response schema.
 */
export interface RouteResult {
  /** HTTP status; default is the spec's success status (or 200, POST: 201). */
  status?: number;
  objects: unknown;
  /** Added as "total" (string, as in the spec example) when set, e.g. for countAll=true. */
  total?: number;
}

export type RouteHandler = (context: RouteContext) => RouteResult | Promise<RouteResult>;

/** A route a domain module provides; overrides the generic spec route with the same key. */
export interface RouteDefinition {
  method: HttpMethod;
  /** Spec-style template, e.g. "/Invoice/{invoiceId}/bookAmount" (relative to the base path). */
  path: string;
  handler: RouteHandler;
  /**
   * Schema of the "objects" payload: a component schema name ("Model_InvoiceResponse")
   * or an inline schema. When omitted, the spec operation's response schema is used;
   * routes outside the spec without schema are returned unshaped.
   */
  responseSchema?: string | Schema;
  /**
   * Body fields the handler deliberately reads differently from their spec type, as dotted
   * paths ("invoice.deliveryDateUntil"); they are skipped by the request value check.
   */
  unvalidatedFields?: readonly string[];
}

/** A domain module: the models it owns and its routes. */
export interface DomainModule {
  name: string;
  /** Collection names (sevDesk objectNames) whose behavior this module owns. */
  models: readonly string[];
  routes: readonly RouteDefinition[];
}

/** How a registered route came to be. */
export type RouteKind = "generic" | "domain" | "extra";

/** A route as it is registered in the HTTP server. */
export interface ResolvedRoute {
  key: string;
  method: HttpMethod;
  path: string;
  kind: RouteKind;
  /** Owning domain module, for domain and extra routes. */
  module: string | undefined;
  operation: SpecOperation | undefined;
  handler: RouteHandler;
  /** Resolved schema of the "objects" payload (undefined = no shaping). */
  objectsSchema: Schema | undefined;
  /** See RouteDefinition.unvalidatedFields. */
  unvalidatedFields: readonly string[];
}
