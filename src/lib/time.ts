import { DateTime } from "luxon";

/** All sevDesk dates are interpreted and rendered in this zone. */
export const BERLIN_ZONE = "Europe/Berlin";

/** Range of years that ISO 8601 renders with four digits. */
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

/** Serializable clock state, part of a tenant snapshot. */
export type ClockState =
  | { mode: "real" }
  | { mode: "frozen"; at: string }
  | { mode: "offset"; offsetMs: number };

/**
 * Per-tenant clock. Real time by default; can be frozen at a fixed instant or
 * shifted by an offset (time keeps running from the configured instant).
 */
export class Clock {
  #state: ClockState = { mode: "real" };
  readonly #onChange: () => void;

  constructor(onChange: () => void = () => {}) {
    this.#onChange = onChange;
  }

  /** Current instant of this clock in Europe/Berlin. */
  now(): DateTime {
    const state = this.#state;
    if (state.mode === "frozen") return DateTime.fromISO(state.at, { zone: BERLIN_ZONE });
    const real = Date.now();
    const millis = state.mode === "offset" ? real + state.offsetMs : real;
    return DateTime.fromMillis(millis, { zone: BERLIN_ZONE });
  }

  /** Current instant as unix seconds. */
  unixNow(): number {
    return Math.floor(this.now().toSeconds());
  }

  /** Freezes the clock at the given instant. */
  freeze(at: DateTime): void {
    this.#set({ mode: "frozen", at: toIso(at) });
  }

  /** Lets the clock run, starting at the given instant now. */
  travelTo(at: DateTime): void {
    this.#set({ mode: "offset", offsetMs: at.toMillis() - Date.now() });
  }

  /** Back to real time. */
  release(): void {
    this.#set({ mode: "real" });
  }

  get state(): ClockState {
    return this.#state;
  }

  /** Restores a state from a snapshot without triggering change notifications. */
  restore(state: ClockState): void {
    this.#state = state;
  }

  #set(state: ClockState): void {
    this.#state = state;
    this.#onChange();
  }
}

/**
 * True when a clock state yields a valid clock instant (see isClockInstant): a parseable
 * ISO 8601 "at" for frozen clocks, a matching offset for running ones (guards snapshot imports).
 */
export function isValidClockState(state: ClockState): boolean {
  if (state.mode === "frozen") return isClockInstant(DateTime.fromISO(state.at, { zone: BERLIN_ZONE }));
  if (state.mode === "offset") {
    return (
      Number.isFinite(state.offsetMs) && isClockInstant(DateTime.fromMillis(Date.now() + state.offsetMs))
    );
  }
  return true;
}

/**
 * True when the clock can be set to the instant: renderable (see isRenderable) and with a
 * Berlin offset of whole minutes. Before April 1893 Berlin used local mean time (+00:53:28);
 * ISO 8601 cuts the offset to +00:53, so a frozen clock would drift on every read.
 */
export function isClockInstant(value: DateTime): boolean {
  return isRenderable(value) && Number.isInteger(value.setZone(BERLIN_ZONE).offset);
}

/** Renders an instant as ISO 8601 with Berlin offset, e.g. 2026-10-01T00:00:00+02:00. */
export function toIso(value: DateTime): string {
  return value.setZone(BERLIN_ZONE).set({ millisecond: 0 }).toISO({ suppressMilliseconds: true }) ?? "";
}

/** Renders an instant as calendar date (yyyy-MM-dd) in Berlin. */
export function toIsoDate(value: DateTime): string {
  return value.setZone(BERLIN_ZONE).toISODate() ?? "";
}

/** True for a unix timestamp in seconds: a finite number or a string of digits. */
export function isUnixTimestamp(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && /^-?\d+$/.test(value.trim());
}

/**
 * Parses date inputs accepted by sevDesk: unix seconds (number or numeric string),
 * "Y-m-d", "d.m.Y" and ISO 8601. Dates without time are midnight in Berlin.
 * Returns undefined for anything unparseable or outside the representable range.
 */
export function parseDateInput(value: unknown): DateTime | undefined {
  const parsed = parseAnyDate(value);
  return parsed !== undefined && isRenderable(parsed) ? parsed : undefined;
}

function parseAnyDate(value: unknown): DateTime | undefined {
  if (value instanceof DateTime) return value.isValid ? value.setZone(BERLIN_ZONE) : undefined;
  if (isUnixTimestamp(value)) {
    const parsed = DateTime.fromSeconds(Number(value), { zone: BERLIN_ZONE });
    return parsed.isValid ? parsed : undefined;
  }
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text === "") return undefined;
  const german = DateTime.fromFormat(text, "d.M.yyyy", { zone: BERLIN_ZONE });
  if (german.isValid) return german;
  const iso = DateTime.fromISO(text, { zone: BERLIN_ZONE, setZone: false });
  if (iso.isValid) return iso.setZone(BERLIN_ZONE);
  const sql = DateTime.fromSQL(text, { zone: BERLIN_ZONE });
  return sql.isValid ? sql.setZone(BERLIN_ZONE) : undefined;
}

/**
 * True when the instant renders as a plain ISO 8601 date in Berlin: years 0001 to 9999
 * (beyond that, Luxon writes expanded years such as "+010000-01-01").
 */
export function isRenderable(value: DateTime): boolean {
  const year = value.setZone(BERLIN_ZONE).year;
  return value.isValid && year >= MIN_YEAR && year <= MAX_YEAR;
}

/** Midnight of the Berlin calendar day containing the instant (for fields like payDate). */
export function startOfBerlinDay(value: DateTime): DateTime {
  return value.setZone(BERLIN_ZONE).startOf("day");
}
