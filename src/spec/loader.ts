import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import { type Config, ConfigError } from "../config.ts";
import { errorMessage, StartupError } from "../lib/errors.ts";
import type { Logger } from "../lib/logger.ts";
import { isPlainObject } from "../lib/object.ts";
import { applySpecPatches } from "./patches.ts";
import { SpecIndex } from "./specIndex.ts";
import type { OpenApiDocument } from "./types.ts";

/** Official location of the current sevDesk OpenAPI spec. */
export const REMOTE_SPEC_URL = "https://api.sevdesk.de/openapi.yaml";
/** Spec copy shipped with the repository. */
export const BUNDLED_SPEC_PATH = resolve(import.meta.dirname, "../../spec/sevdesk-openapi.yaml");

const REMOTE_TIMEOUT_MS = 5000;

/** A parsed spec plus a human-readable description of where it came from. */
export interface LoadedSpec {
  index: SpecIndex;
  /** e.g. "remote https://...", "cache /data/spec-cache.yaml", "bundled", "file /x.yaml". */
  source: string;
}

/**
 * Loads the spec according to DOPPELDESK_SPEC. "auto" tries the remote spec (and caches it),
 * then the cache, then the bundled copy. Explicit files or URLs fail hard when unavailable.
 */
export async function loadSpec(config: Config, log: Logger): Promise<LoadedSpec> {
  const loaded = await loadFromSource(config, log);
  log.info(
    { source: loaded.source, operations: loaded.index.operations.length, patches: loaded.index.patches },
    "OpenAPI spec loaded",
  );
  if (loaded.source !== "bundled") await logDifferences(loaded.index, log);
  return loaded;
}

async function loadFromSource(config: Config, log: Logger): Promise<LoadedSpec> {
  const spec = config.spec;
  switch (spec.kind) {
    case "bundled":
      return loadExplicit("bundled", () => readFile(BUNDLED_SPEC_PATH, "utf8"));
    case "file":
      return loadExplicit(`file ${spec.path}`, () => readFile(spec.path, "utf8"));
    case "url":
      return loadExplicit(`remote ${spec.url}`, () => download(spec.url));
    case "auto":
      return loadAuto(join(config.dataDir, "spec-cache.yaml"), log);
  }
}

/** Loads the spec source chosen by DOPPELDESK_SPEC; any failure is a configuration error. */
async function loadExplicit(source: string, read: () => Promise<string>): Promise<LoadedSpec> {
  try {
    return { index: parseSpec(await read()), source };
  } catch (error) {
    throw new ConfigError(`DOPPELDESK_SPEC (${source}) could not be loaded: ${errorMessage(error)}`);
  }
}

async function loadAuto(cachePath: string, log: Logger): Promise<LoadedSpec> {
  try {
    const text = await download(REMOTE_SPEC_URL);
    const index = parseSpec(text);
    await cache(cachePath, text, log);
    return { index, source: `remote ${REMOTE_SPEC_URL}` };
  } catch (error) {
    log.warn({ err: errorMessage(error) }, "Remote spec unavailable, trying cache");
  }
  try {
    return { index: parseSpec(await readFile(cachePath, "utf8")), source: `cache ${cachePath}` };
  } catch {
    log.warn({ cachePath }, "No usable spec cache, using bundled spec");
  }
  try {
    return { index: parseSpec(await readFile(BUNDLED_SPEC_PATH, "utf8")), source: "bundled" };
  } catch (error) {
    throw new StartupError(`Bundled spec ${BUNDLED_SPEC_PATH} could not be loaded: ${errorMessage(error)}`);
  }
}

async function download(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
  return response.text();
}

async function cache(path: string, text: string, log: Logger): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, "utf8");
  } catch (error) {
    log.warn({ err: errorMessage(error), path }, "Could not write spec cache");
  }
}

/**
 * Parses and minimally validates an OpenAPI YAML/JSON text (OpenAPI 3 with at least one
 * operation) and applies the known spec corrections.
 */
export function parseSpec(text: string): SpecIndex {
  const parsed: unknown = parse(text);
  if (!isPlainObject(parsed) || typeof parsed.openapi !== "string" || !isPlainObject(parsed.paths)) {
    throw new Error("Not an OpenAPI 3 document (missing openapi or paths)");
  }
  const document = parsed as unknown as OpenApiDocument;
  const index = new SpecIndex(document, applySpecPatches(document));
  if (index.operations.length === 0) throw new Error("The OpenAPI document declares no operations");
  return index;
}

async function logDifferences(index: SpecIndex, log: Logger): Promise<void> {
  try {
    const bundled = parseSpec(await readFile(BUNDLED_SPEC_PATH, "utf8"));
    const current = new Set(index.operations.map((op) => `${op.method} ${op.path}`));
    const known = new Set(bundled.operations.map((op) => `${op.method} ${op.path}`));
    const added = [...current].filter((key) => !known.has(key));
    const removed = [...known].filter((key) => !current.has(key));
    if (added.length > 0 || removed.length > 0) {
      log.info({ added, removed }, "Loaded spec differs from bundled spec");
    }
  } catch (error) {
    log.warn({ err: errorMessage(error) }, "Could not compare with bundled spec");
  }
}
