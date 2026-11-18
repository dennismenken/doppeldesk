import { badRequest } from "../lib/errors.ts";
import { isPlainObject, type PlainObject } from "../lib/object.ts";
import { type ClockState, isValidClockState } from "../lib/time.ts";
import type { CollectionSnapshot } from "../store/collection.ts";
import { SNAPSHOT_VERSION, type TenantSnapshot } from "./tenant.ts";

/**
 * Validates an imported tenant snapshot (PUT /__doppeldesk/state, state.json).
 * Throws ApiError 400 with a description of the first problem.
 */
export function parseSnapshot(input: unknown, sevClientId: string): TenantSnapshot {
  if (!isPlainObject(input)) throw badRequest("Snapshot must be a JSON object");
  if (input.version !== SNAPSHOT_VERSION) throw badRequest(`Snapshot version must be ${SNAPSHOT_VERSION}`);
  return {
    version: SNAPSHOT_VERSION,
    sevClientId: parseSevClientId(input.sevClientId, sevClientId),
    clock: parseClock(input.clock),
    numberRanges: parseNumberRanges(input.numberRanges),
    collections: parseCollections(input.collections),
  };
}

/** sevClientId of the snapshot (string or integer); a missing one means the importing tenant's. */
function parseSevClientId(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if ((typeof value === "string" && value !== "") || (typeof value === "number" && Number.isInteger(value))) {
    return String(value);
  }
  throw badRequest("Snapshot sevClientId must be a non-empty string or an integer");
}

function parseClock(value: unknown): ClockState {
  if (value === undefined || value === null) return { mode: "real" };
  if (!isPlainObject(value)) throw badRequest("Snapshot clock must be an object");
  const state = clockStateOf(value);
  if (state === undefined || !isValidClockState(state)) throw badRequest("Snapshot clock is invalid");
  return state;
}

function clockStateOf(value: PlainObject): ClockState | undefined {
  if (value.mode === "real") return { mode: "real" };
  if (value.mode === "frozen" && typeof value.at === "string") return { mode: "frozen", at: value.at };
  if (value.mode === "offset" && typeof value.offsetMs === "number")
    return { mode: "offset", offsetMs: value.offsetMs };
  return undefined;
}

function parseNumberRanges(value: unknown): Record<string, number> {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw badRequest("Snapshot numberRanges must be an object");
  const result: Record<string, number> = {};
  for (const [key, last] of Object.entries(value)) {
    if (!isNonNegativeInteger(last)) throw badRequest(`Number range ${key} must be a non-negative integer`);
    result[key] = last;
  }
  return result;
}

function parseCollections(value: unknown): Record<string, CollectionSnapshot> {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw badRequest("Snapshot collections must be an object");
  const result: Record<string, CollectionSnapshot> = {};
  for (const [name, collection] of Object.entries(value)) {
    if (!isPlainObject(collection) || !Array.isArray(collection.docs)) {
      throw badRequest(`Collection ${name} must have a docs array`);
    }
    const ids = new Set<string>();
    const docs: PlainObject[] = collection.docs.map((doc, index) => {
      if (
        !isPlainObject(doc) ||
        (typeof doc.id !== "string" && typeof doc.id !== "number") ||
        doc.id === ""
      ) {
        throw badRequest(`Document ${index} of ${name} needs an id`);
      }
      const id = String(doc.id);
      if (ids.has(id)) throw badRequest(`Document ${index} of ${name} repeats the id ${id}`);
      ids.add(id);
      return doc;
    });
    const lastId = collection.lastId ?? 0;
    if (!isNonNegativeInteger(lastId)) throw badRequest(`lastId of ${name} must be a non-negative integer`);
    result[name] = { lastId, docs };
  }
  return result;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
