import { badRequest } from "../lib/errors.ts";
import { isPlainObject } from "../lib/object.ts";
import { type HttpMethod, toHttpMethod } from "../lib/routePath.ts";
import { matchesPathPattern, type PathTarget, parsePathPattern } from "./pathPattern.ts";

export const FAULT_TYPES = ["status", "timeout", "invalid-json", "feature-lock"] as const;
export type FaultType = (typeof FAULT_TYPES)[number];

/** Default timeout delay before answering 504. */
export const DEFAULT_TIMEOUT_DELAY_MS = 30_000;

/** An active fault of a tenant. */
export interface Fault {
  id: string;
  /** Only requests with this method match; null matches all methods. */
  method: HttpMethod | null;
  /** Path pattern, see matchesPathPattern(). */
  path: string;
  type: FaultType;
  /** HTTP status for "status" (required) and "feature-lock" (default 500). */
  status: number | null;
  /** Error message override for "status" faults. */
  message: string | null;
  /** "timeout": delay before 504 (default 30000 ms). */
  delayMs: number;
  /** "timeout": keep the connection open until the client gives up instead of answering 504. */
  hang: boolean;
  /** "feature-lock": feature code, e.g. "invoice:cancel". */
  code: string | null;
  /** "feature-lock": user id in the message; defaults to the tenant's first SevUser. */
  userId: string | null;
  /** Remaining hits before the fault removes itself; null = unlimited. */
  remaining: number | null;
}

/** Active faults of one tenant, matched in insertion order. */
export class FaultRegistry {
  #faults: Fault[] = [];
  #nextId = 1;

  /** Validates control API input and adds the fault. Throws ApiError 400 on invalid input. */
  add(input: unknown, basePath: string): Fault {
    const fault = parseFault(input, String(this.#nextId), basePath);
    this.#nextId += 1;
    this.#faults.push(fault);
    return fault;
  }

  list(): Fault[] {
    return [...this.#faults];
  }

  remove(id: string): boolean {
    const before = this.#faults.length;
    this.#faults = this.#faults.filter((fault) => fault.id !== id);
    return this.#faults.length !== before;
  }

  clear(): void {
    this.#faults = [];
  }

  /** Returns the first matching fault and consumes one of its remaining hits. */
  take(method: HttpMethod, target: PathTarget): Fault | undefined {
    const fault = this.#faults.find(
      (candidate) =>
        (candidate.method === null || candidate.method === method) &&
        matchesPathPattern(candidate.path, target),
    );
    if (fault?.remaining !== null && fault !== undefined) {
      fault.remaining -= 1;
      if (fault.remaining <= 0) this.remove(fault.id);
    }
    return fault;
  }
}

function parseFault(input: unknown, id: string, basePath: string): Fault {
  if (!isPlainObject(input)) throw badRequest("Fault must be a JSON object");
  const type = FAULT_TYPES.find((candidate) => candidate === input.type);
  if (type === undefined) throw badRequest(`Fault type must be one of ${FAULT_TYPES.join(", ")}`);
  if (typeof input.path !== "string") throw badRequest("Fault path is required");
  const path = parsePathPattern(input.path, basePath, "Fault path");
  const method =
    input.method === undefined || input.method === null ? null : toHttpMethod(String(input.method));
  if (method === undefined) throw badRequest("Fault method is not supported");
  const status = readStatus(input.status);
  if (type === "status" && status === null) throw badRequest("Fault of type status needs a status");
  if (type === "feature-lock" && optionalString(input.code) === null) {
    throw badRequest("Fault of type feature-lock needs a code");
  }
  const times = optionalInteger(input.times, "times", 1, Number.MAX_SAFE_INTEGER);
  return {
    id,
    method,
    path,
    type,
    status,
    message: optionalString(input.message),
    delayMs: optionalInteger(input.delayMs, "delayMs", 0, 3_600_000) ?? DEFAULT_TIMEOUT_DELAY_MS,
    hang: input.hang === true,
    code: optionalString(input.code),
    userId: input.userId === undefined || input.userId === null ? null : String(input.userId),
    remaining: times,
  };
}

/**
 * Status of a "status" or "feature-lock" fault: a final status (200 to 599) that a response
 * with the JSON error body can carry. 1xx are interim responses (the client would wait for
 * a final one forever) and 304 never has content, so both are rejected.
 */
function readStatus(value: unknown): number | null {
  const status = optionalInteger(value, "status", 200, 599);
  if (status === 304) throw badRequest("Fault status 304 can not carry a response body");
  return status;
}

function optionalInteger(value: unknown, name: string, min: number, max: number): number | null {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw badRequest(`Fault ${name} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
