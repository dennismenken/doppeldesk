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
import { extractToken, queryWithoutToken, safeHeaders } from "./auth.ts";
import { sendFault } from "./faultResponse.ts";
import { initRequestState, requestState } from "./requestState.ts";

export interface ApiDependencies {
  basePath: string;
  spec: SpecIndex;
  tenants: TenantRegistry;
  routes: readonly ResolvedRoute[];
  /** Aborted when the server shuts down; ends waiting timeout faults. */
  shutdown: AbortSignal;
}

/**
 * Mounts the fake sevDesk API under the base path: token auth, request log, fault
 * injection, the request value check against the spec's request schema, every resolved
 * route, and sevDesk-style 404 for unknown routes.
 */
export function registerApi(app: FastifyInstance, deps: ApiDependencies): void {
  const { basePath, tenants } = deps;

  app.addHook("onRequest", async (request, reply) => {
    if (!isApiUrl(request.url, basePath)) return;
    const state = initRequestState(request);
    state.tenant = tenants.resolve(extractToken(request));
    if (state.tenant === undefined) return reply.code(401).send(errorBody("Authentication required"));
  });

  app.addHook("onResponse", async (request, reply) => {
    logRequest(request, reply.statusCode, basePath);
  });

  for (const route of deps.routes) {
    app.route({
      method: route.method,
      url: toFastifyPath(basePath, route.path),
      handler: (request, reply) => handleRoute(route, request, reply, deps),
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    const tenant = requestState(request)?.tenant;
    const method = toHttpMethod(request.method);
    if (tenant !== undefined && method !== undefined) {
      const fault = tenant.faults.take(method, { path: relativePath(request.url, basePath), route: null });
      if (fault !== undefined) return answerFault(fault, request, reply, deps);
    }
    return reply.code(404).send(errorBody("Not found"));
  });
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
  state.route = route.path;

  const fault = tenant.faults.take(route.method, {
    path: relativePath(request.url, deps.basePath),
    route: route.path,
  });
  if (fault !== undefined) return answerFault(fault, request, reply, deps);
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
  request: FastifyRequest,
  reply: FastifyReply,
  deps: ApiDependencies,
): Promise<FastifyReply> {
  const tenant = requestState(request)?.tenant;
  if (tenant === undefined) throw new ApiError(401, "Authentication required");
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
  if (state?.tenant === undefined || state.logged) return;
  state.logged = true;
  state.tenant.requestLog.add({
    time: new Date().toISOString(),
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
