import type { FastifyRequest } from "fastify";
import type { Tenant } from "../tenant/tenant.ts";

/** Per-request bookkeeping of the API layer. */
export interface RequestState {
  startedAt: number;
  tenant: Tenant | undefined;
  /** Matched route template, null until a route matched (or for unknown routes). */
  route: string | null;
  /** Set once the request was written to the request log. */
  logged: boolean;
}

const states = new WeakMap<FastifyRequest, RequestState>();

export function initRequestState(request: FastifyRequest): RequestState {
  const state: RequestState = { startedAt: performance.now(), tenant: undefined, route: null, logged: false };
  states.set(request, state);
  return state;
}

/** State of an API request; undefined for requests outside the API base path. */
export function requestState(request: FastifyRequest): RequestState | undefined {
  return states.get(request);
}
