import { resolve } from "node:path";
import { StartupError } from "./lib/errors.ts";

/** Seed modes applied when a tenant is created fresh or reset. */
export const SEED_MODES = ["none", "basic", "demo"] as const;
export type SeedMode = (typeof SEED_MODES)[number];

export const PERSIST_MODES = ["memory", "file"] as const;
export type PersistMode = (typeof PERSIST_MODES)[number];

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Where the OpenAPI spec comes from. */
export type SpecSource =
  | { kind: "auto" }
  | { kind: "bundled" }
  | { kind: "file"; path: string }
  | { kind: "url"; url: string };

/** Validated runtime configuration (all values from DOPPELDESK_* environment variables). */
export interface Config {
  /** DOPPELDESK_PORT, default 8080. */
  port: number;
  /** DOPPELDESK_HOST, default 0.0.0.0. */
  host: string;
  /** DOPPELDESK_BASE_PATH, default /api/v1 (no trailing slash). */
  basePath: string;
  /** DOPPELDESK_SPEC: auto | bundled | file path | http(s) URL, default auto. */
  spec: SpecSource;
  /** DOPPELDESK_TOKENS: accepted API tokens, each one tenant. Default "doppeldesk". */
  tokens: string[];
  /** True when DOPPELDESK_TOKENS contains "*": any non-empty token gets its own tenant. */
  acceptAnyToken: boolean;
  /** DOPPELDESK_CONTROL_TOKEN: when set, the control API requires X-DoppelDesk-Control-Token. */
  controlToken: string | undefined;
  /** DOPPELDESK_PERSIST: memory | file, default memory. */
  persist: PersistMode;
  /** DOPPELDESK_DATA_DIR, default ./data (absolute after loading). */
  dataDir: string;
  /** DOPPELDESK_SEED: none | basic | demo, default basic. */
  seed: SeedMode;
  /** DOPPELDESK_LOG_LEVEL, default info. */
  logLevel: LogLevel;
  /** DOPPELDESK_REQUEST_LOG_SIZE: ring buffer size per tenant, default 1000. */
  requestLogSize: number;
}

/** Thrown for invalid environment values; main.ts prints it and exits. */
export class ConfigError extends StartupError {
  override name = "ConfigError";
}

type Env = Readonly<Record<string, string | undefined>>;

/** Reads and validates the configuration from the environment. */
export function loadConfig(env: Env = process.env): Config {
  const tokens = list(read(env, "DOPPELDESK_TOKENS", "doppeldesk"));
  const acceptAnyToken = tokens.includes("*");
  const namedTokens = tokens.filter((token) => token !== "*");
  if (namedTokens.length === 0 && !acceptAnyToken) {
    throw new ConfigError("DOPPELDESK_TOKENS must contain at least one token or *");
  }
  return {
    port: integer(env, "DOPPELDESK_PORT", 8080, 0, 65535),
    host: read(env, "DOPPELDESK_HOST", "0.0.0.0"),
    basePath: basePath(read(env, "DOPPELDESK_BASE_PATH", "/api/v1")),
    spec: specSource(read(env, "DOPPELDESK_SPEC", "auto")),
    tokens: namedTokens,
    acceptAnyToken,
    controlToken: optional(env, "DOPPELDESK_CONTROL_TOKEN"),
    persist: oneOf(env, "DOPPELDESK_PERSIST", PERSIST_MODES, "memory"),
    dataDir: resolve(read(env, "DOPPELDESK_DATA_DIR", "./data")),
    seed: oneOf(env, "DOPPELDESK_SEED", SEED_MODES, "basic"),
    logLevel: oneOf(env, "DOPPELDESK_LOG_LEVEL", LOG_LEVELS, "info"),
    requestLogSize: integer(env, "DOPPELDESK_REQUEST_LOG_SIZE", 1000, 0, 1_000_000),
  };
}

/** Type guard for seed mode strings (used by the control API). */
export function isSeedMode(value: unknown): value is SeedMode {
  return typeof value === "string" && (SEED_MODES as readonly string[]).includes(value);
}

function optional(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function read(env: Env, name: string, fallback: string): string {
  return optional(env, name) ?? fallback;
}

function list(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = optional(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

function oneOf<T extends string>(env: Env, name: string, allowed: readonly T[], fallback: T): T {
  const raw = optional(env, name);
  if (raw === undefined) return fallback;
  const match = allowed.find((candidate) => candidate === raw);
  if (match === undefined) {
    throw new ConfigError(`${name} must be one of ${allowed.join(", ")}, got "${raw}"`);
  }
  return match;
}

function basePath(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (normalized === "/" || normalized.startsWith("/__doppeldesk")) {
    throw new ConfigError(`DOPPELDESK_BASE_PATH must be a non-root path outside /__doppeldesk, got "${raw}"`);
  }
  return normalized;
}

function specSource(raw: string): SpecSource {
  if (raw === "auto") return { kind: "auto" };
  if (raw === "bundled") return { kind: "bundled" };
  if (/^https?:\/\//i.test(raw)) return { kind: "url", url: raw };
  return { kind: "file", path: resolve(raw) };
}
