import { createHash } from "node:crypto";

/** sevDesk error envelope: {"objects": null, "error": {"message", "code", "data", "exceptionUUID"}}. */
export interface ErrorBody {
  objects: null;
  error: { message: string; code: string | number | null; data: unknown; exceptionUUID: string };
}

/**
 * Builds the sevDesk error envelope. sevDesk adds an "exceptionUUID" (spec validationError,
 * third-party example of a 400). DoppelDesk derives it from the message so that responses
 * stay deterministic; real sevDesk issues a new one per error.
 */
export function errorBody(
  message: string,
  code: string | number | null = null,
  data: unknown = null,
): ErrorBody {
  return { objects: null, error: { message, code, data, exceptionUUID: deterministicUuid(message) } };
}

/** UUID-shaped (version 5 layout) hash of a text. */
function deterministicUuid(text: string): string {
  const hex = createHash("sha1").update(`doppeldesk:${text}`).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Error with an HTTP status that handlers throw; the core renders it in the
 * sevDesk error format. Messages should mimic sevDesk (English).
 */
export class ApiError extends Error {
  override name = "ApiError";
  readonly status: number;
  readonly code: string | number | null;
  readonly data: unknown;

  constructor(
    status: number,
    message: string,
    options: { code?: string | number | null; data?: unknown } = {},
  ) {
    super(message);
    this.status = status;
    this.code = options.code ?? null;
    this.data = options.data ?? null;
  }

  toBody(): ErrorBody {
    return errorBody(this.message, this.code, this.data);
  }
}

/** 404 as sevDesk sends it: "No Model_<Type> with the id <id> was found". */
export function notFound(model: string, id: string | number): ApiError {
  return new ApiError(404, `No Model_${model} with the id ${id} was found`);
}

/** 400 validation error with a sevDesk-style message. */
export function badRequest(message: string): ApiError {
  return new ApiError(400, message);
}

/**
 * Startup failure with a self-explanatory message (configuration, spec, state file);
 * main.ts prints only the message and exits.
 */
export class StartupError extends Error {
  override name = "StartupError";
}

/** Message of an unknown thrown value including its cause (e.g. "fetch failed (bad port)"). */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause === undefined ? error.message : `${error.message} (${errorMessage(error.cause)})`;
}
