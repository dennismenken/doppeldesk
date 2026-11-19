import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError, errorBody } from "../lib/errors.ts";
import { isPlainObject } from "../lib/object.ts";
import { paramNames, toFastifyPath, toHttpMethod } from "../lib/routePath.ts";
import { assertBodyMatchesSchema } from "../routes/requestBody.ts";
import type { ResolvedRoute, RouteContext } from "../routes/types.ts";
import { shapeObjects } from "../serialize/serializer.ts";
import type { SpecIndex } from "../spec/specIndex.ts";
import type { Fault } from "../tenant/faults.ts";
import type { TenantRegistry } from "../tenant/registry.ts";
import type { Tenant } from "../tenant/tenant.ts";
import { extractToken, queryWithoutToken, safeHeaders } from "./auth.ts";
import { sendFault } from "./faultResponse.ts";
import { bindTenant, initRequestState, requestState } from "./requestState.ts";

declare module "fastify" {
  interface FastifyContextConfig {
    /** The resolved route a Fastify route was registered for; absent for unknown routes. */
    route?: ResolvedRoute;
  }
}

export interface ApiDependencies {
  basePath: string;
  spec: SpecIndex;
  tenants: TenantRegistry;
  routes: readonly ResolvedRoute[];
  /** Aborted when the server shuts down; ends waiting timeout faults. */
  shutdown: AbortSignal;
}

/**
 * Mounts the fake sevDesk API under the base path: token auth, fault injection (both
 * before the body is parsed, so a fault wins over unparseable bodies), request log, the
 * request value check against the spec's request schema, every resolved route, and
 * sevDesk-style 404 for unknown routes.
 */
export function registerApi(app: FastifyInstance, deps: ApiDependencies): void {
  const { basePath, tenants } = deps;

  app.addHook("onRequest", async (request, reply) => {
    if (!isApiUrl(request.url, basePath)) return;
    const state = initRequestState(request);
    const tenant = tenants.resolve(extractToken(request));
    if (tenant === undefined) return reply.code(401).send(errorBody("Authentication required"));
    bindTenant(state, tenant);
    const route = request.routeOptions.config.route;
    state.route = route?.path ?? null;
    const method = route?.method ?? toHttpMethod(request.method);
    if (method === undefined) return;
    const fault = tenant.faults.take(method, {
      path: relativePath(request.url, basePath),
      route: state.route,
    });
    if (fault !== undefined) return answerFault(fault, tenant, request, reply, deps);
  });

  app.addHook("onResponse", async (request, reply) => {
    logRequest(request, reply.statusCode, basePath);
  });

  for (const route of deps.routes) {
    app.route({
      method: route.method,
      url: toFastifyPath(basePath, route.path),
      config: { route },
      handler: (request, reply) => handleRoute(route, request, reply, deps),
    });
  }

  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send(errorBody("Not found")));
}

async function handleRoute(
  route: ResolvedRoute,
  request: FastifyRequest,
  reply: FastifyReply,
  deps: ApiDependencies,
): Promise<FastifyReply> {
  const state = requestState(request);
  const tenant = state?.tenant;
  if (state === undefined || tenant === undefined) throw new ApiError(401, "Authentication required");
  if (route.operation !== undefined) {
    assertBodyMatchesSchema(
      deps.spec,
      route.operation.requestBodySchema,
      request.body,
      route.unvalidatedFields,
    );
  }

  const context: RouteContext = {
    tenant,
    params: routeParams(route.path, request.params),
    query: queryWithoutToken(request.query),
    body: request.body,
    input: isPlainObject(request.body) ? request.body : {},
    headers: safeHeaders(request.headers),
    operation: route.operation,
    route: { method: route.method, path: route.path },
    spec: deps.spec,
    log: request.log,
  };
  const result = await route.handler(context);
  const body: Record<string, unknown> = {
    objects: shapeObjects(deps.spec, result.objects, route.objectsSchema),
  };
  if (result.total !== undefined) body.total = String(result.total);
  const status = result.status ?? route.operation?.successStatus ?? (route.method === "POST" ? 201 : 200);
  return reply.code(status).send(body);
}

async function answerFault(
  fault: Fault,
  tenant: Tenant,
  request: FastifyRequest,
  reply: FastifyReply,
  deps: ApiDependencies,
): Promise<FastifyReply> {
  const answered = await sendFault(fault, reply, tenant, deps.shutdown);
  if (!answered) logRequest(request, 0, deps.basePath);
  return reply;
}

/** Maps Fastify's positional params (p0, p1, ...) to the template's own names. */
function routeParams(template: string, raw: unknown): Record<string, string> {
  const values = isPlainObject(raw) ? raw : {};
  return Object.fromEntries(
    paramNames(template).map((name, index) => [name, String(values[`p${index}`] ?? "")]),
  );
}

/** Writes one request-log entry (status 0 = connection dropped without response). */
function logRequest(request: FastifyRequest, status: number, basePath: string): void {
  const state = requestState(request);
  if (state?.tenant === undefined || state.clockTime === undefined || state.logged) return;
  state.logged = true;
  state.tenant.requestLog.add({
    time: state.startedAtWall,
    clockTime: state.clockTime,
    method: request.method,
    path: relativePath(request.url, basePath),
    query: queryWithoutToken(request.query),
    body: loggableBody(request.body),
    status,
    durationMs: Math.round((performance.now() - state.startedAt) * 10) / 10,
    route: state.route,
  });
}

function loggableBody(body: unknown): unknown {
  if (Buffer.isBuffer(body)) return { binary: true, bytes: body.length };
  return body ?? null;
}

function isApiUrl(url: string, basePath: string): boolean {
  const path = url.split("?")[0] ?? "";
  return path === basePath || path.startsWith(`${basePath}/`);
}

/** Path below the base path without query string, e.g. "/Invoice/5". */
function relativePath(url: string, basePath: string): string {
  const path = url.split("?")[0] ?? "";
  const relative = path.startsWith(basePath) ? path.slice(basePath.length) : path;
  return relative === "" ? "/" : relative;
}
