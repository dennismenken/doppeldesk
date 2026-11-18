import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Config, isSeedMode, type SeedMode } from "../config.ts";
import { extractToken } from "../http/auth.ts";
import { ApiError, badRequest, errorBody } from "../lib/errors.ts";
import { isPlainObject } from "../lib/object.ts";
import { type HttpMethod, toHttpMethod } from "../lib/routePath.ts";
import { isClockInstant, parseDateInput, toIso } from "../lib/time.ts";
import type { DomainModule, ResolvedRoute } from "../routes/types.ts";
import type { LoadedSpec } from "../spec/loader.ts";
import { parsePathPattern } from "../tenant/pathPattern.ts";
import type { TenantRegistry } from "../tenant/registry.ts";
import { parseSnapshot } from "../tenant/snapshot.ts";
import type { Tenant } from "../tenant/tenant.ts";

/** Prefix of the control API (outside the API base path). */
export const CONTROL_PREFIX = "/__doppeldesk";
const CONTROL_TOKEN_HEADER = "x-doppeldesk-control-token";

export interface ControlDependencies {
  config: Config;
  spec: LoadedSpec;
  tenants: TenantRegistry;
  routes: readonly ResolvedRoute[];
  modules: readonly DomainModule[];
}

/**
 * Control API for tests and diagnostics. Tenant-scoped endpoints select the tenant by
 * the API token (Authorization header, like the API) and need the control token when
 * DOPPELDESK_CONTROL_TOKEN is set. Health is always public.
 */
export function registerControlApi(app: FastifyInstance, deps: ControlDependencies): void {
  const { config, spec, tenants, routes, modules } = deps;

  app.get(`${CONTROL_PREFIX}/health`, async () => ({
    status: "ok",
    spec: { source: spec.source, operations: spec.index.operations.length, patches: spec.index.patches },
    persist: config.persist,
    seed: config.seed,
  }));

  void app.register(
    async (control) => {
      control.addHook("onRequest", async (request, reply) => {
        if (!controlTokenValid(request, config.controlToken)) {
          return reply.code(401).send(errorBody("Control token required"));
        }
      });

      control.get("/routes", async () => ({
        count: routes.length,
        modules: modules.map((module) => ({ name: module.name, models: module.models })),
        routes: routes.map((route) => ({
          method: route.method,
          path: route.path,
          kind: route.kind,
          module: route.module ?? null,
          operationId: route.operation?.operationId ?? null,
        })),
      }));

      control.post("/reset", async (request) => {
        const tenant = tenantOf(request, tenants);
        const seed = readSeed(request);
        tenants.reset(tenant, seed ?? config.seed);
        return { status: "ok", seed: seed ?? config.seed };
      });

      control.get("/state", async (request) => tenantOf(request, tenants).snapshot());

      control.put("/state", async (request) => {
        const tenant = tenantOf(request, tenants);
        tenant.restore(parseSnapshot(request.body, tenant.sevClientId));
        return { status: "ok" };
      });

      control.get("/clock", async (request) => clockState(tenantOf(request, tenants)));

      control.post("/clock", async (request) => {
        const tenant = tenantOf(request, tenants);
        const body = isPlainObject(request.body) ? request.body : {};
        if (!("now" in body)) throw badRequest("now is required (ISO 8601, unix seconds or null)");
        if (body.frozen !== undefined && typeof body.frozen !== "boolean") {
          throw badRequest("frozen must be true or false");
        }
        if (body.now === null) {
          tenant.clock.release();
        } else {
          const at = parseDateInput(body.now);
          if (at === undefined || !isClockInstant(at)) {
            throw badRequest(
              "now must be ISO 8601 or unix seconds from April 1893 (Berlin local mean time ends) to 9999, or null",
            );
          }
          if (body.frozen === false) tenant.clock.travelTo(at);
          else tenant.clock.freeze(at);
        }
        return clockState(tenant);
      });

      control.get("/requests", async (request) => {
        const tenant = tenantOf(request, tenants);
        const query = isPlainObject(request.query) ? request.query : {};
        const limitText = singleQueryValue(query, "limit");
        const limit = limitText === undefined ? undefined : Number(limitText);
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
          throw badRequest("limit must be a positive integer");
        const method = readMethodFilter(singleQueryValue(query, "method"));
        const pathText = singleQueryValue(query, "path");
        const path =
          pathText === undefined || pathText === ""
            ? undefined
            : parsePathPattern(pathText, config.basePath, "path");
        return { requests: tenant.requestLog.list({ path, method, limit }) };
      });

      control.delete("/requests", async (request) => {
        tenantOf(request, tenants).requestLog.clear();
        return { status: "ok" };
      });

      control.get("/faults", async (request) => ({ faults: tenantOf(request, tenants).faults.list() }));

      control.post("/faults", async (request, reply) => {
        const fault = tenantOf(request, tenants).faults.add(request.body, config.basePath);
        return reply.code(201).send({ fault });
      });

      control.delete("/faults", async (request) => {
        tenantOf(request, tenants).faults.clear();
        return { status: "ok" };
      });

      control.delete<{ Params: { id: string } }>("/faults/:id", async (request) => {
        if (!tenantOf(request, tenants).faults.remove(request.params.id)) {
          throw new ApiError(404, `No fault with the id ${request.params.id} was found`);
        }
        return { status: "ok" };
      });
    },
    { prefix: CONTROL_PREFIX },
  );
}

function tenantOf(request: FastifyRequest, tenants: TenantRegistry): Tenant {
  const tenant = tenants.resolve(extractToken(request));
  if (tenant === undefined) throw new ApiError(401, "Authentication required");
  return tenant;
}

/**
 * Seed of POST /reset: from a JSON object body ({"seed": ...}); undefined when the body is
 * empty or the empty object. A seed in the query string, a body that is not sent as JSON or
 * is no JSON object, and any key besides "seed" are rejected, so a mistyped request never
 * silently resets with the configured seed.
 */
function readSeed(request: FastifyRequest): SeedMode | undefined {
  const query = isPlainObject(request.query) ? request.query : {};
  if ("seed" in query) throw badRequest('seed must be sent in a JSON object body: {"seed": "none"}');
  const body = request.body;
  if (body === undefined) return undefined;
  if (!isJsonRequest(request) || !isPlainObject(body)) {
    throw badRequest("The request body must be a JSON object (Content-Type: application/json)");
  }
  const unknown = Object.keys(body).filter((key) => key !== "seed");
  if (unknown.length > 0) throw badRequest(`Unknown field(s): ${unknown.join(", ")}. Allowed: seed`);
  if (body.seed === undefined) return undefined;
  if (!isSeedMode(body.seed)) throw badRequest("seed must be none, basic or demo");
  return body.seed;
}

/** True when the request declares a JSON body (media type application/json, parameters ignored). */
function isJsonRequest(request: FastifyRequest): boolean {
  const contentType = request.headers["content-type"] ?? "";
  return contentType.split(";")[0]?.trim().toLowerCase() === "application/json";
}

/**
 * A query parameter that must occur once with a plain value; undefined when absent. Repeated
 * or bracketed parameters (arrays, objects) give 400 instead of being dropped silently.
 */
function singleQueryValue(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw badRequest(`${name} must be given once as a plain value`);
  return value;
}

/** Optional method filter of GET /requests; unsupported methods are rejected like in faults. */
function readMethodFilter(value: string | undefined): HttpMethod | undefined {
  if (value === undefined || value === "") return undefined;
  const method = toHttpMethod(value);
  if (method === undefined) throw badRequest("method is not supported");
  return method;
}

function clockState(tenant: Tenant) {
  const now = tenant.clock.now();
  return { now: toIso(now), unix: Math.floor(now.toSeconds()), ...tenant.clock.state };
}

function controlTokenValid(request: FastifyRequest, expected: string | undefined): boolean {
  if (expected === undefined) return true;
  const given = request.headers[CONTROL_TOKEN_HEADER];
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
