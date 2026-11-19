import type { FastifyRequest } from "fastify";
import { toIso } from "../lib/time.ts";
import type { Tenant } from "../tenant/tenant.ts";

/** Per-request bookkeeping of the API layer. */
export interface RequestState {
  /** Monotonic start of the request, for the duration. */
  startedAt: number;
  /** Wall-clock start of the request (ISO 8601, UTC). */
  startedAtWall: string;
  /** Tenant clock at the start of the request (ISO 8601, Europe/Berlin); undefined until the tenant is known. */
  clockTime: string | undefined;
  tenant: Tenant | undefined;
  /** Matched route template, null until a route matched (or for unknown routes). */
  route: string | null;
  /** Set once the request was written to the request log. */
  logged: boolean;
}

const states = new WeakMap<FastifyRequest, RequestState>();

export function initRequestState(request: FastifyRequest): RequestState {
  const state: RequestState = {
    startedAt: performance.now(),
    startedAtWall: new Date().toISOString(),
    clockTime: undefined,
    tenant: undefined,
    route: null,
    logged: false,
  };
  states.set(request, state);
  return state;
}

/** Binds the authenticated tenant to the request and reads its clock at that moment. */
export function bindTenant(state: RequestState, tenant: Tenant): void {
  state.tenant = tenant;
  state.clockTime = toIso(tenant.clock.now());
}

/** State of an API request; undefined for requests outside the API base path. */
export function requestState(request: FastifyRequest): RequestState | undefined {
  return states.get(request);
}
