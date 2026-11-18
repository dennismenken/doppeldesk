import { DateTime } from "luxon";
import { BERLIN_ZONE, toIso, toIsoDate } from "../../lib/time.ts";
import type { Tenant } from "../../tenant/tenant.ts";

/**
 * Fixed reference day of the demo data. Every document is dated relative to it, so the
 * seed produces the same data whenever it runs.
 */
export const REFERENCE_DAY = DateTime.fromISO("2026-09-30", { zone: BERLIN_ZONE });

/** The calendar day (yyyy-MM-dd) the given number of days before the reference day. */
export function dayBefore(days: number): string {
  return toIsoDate(REFERENCE_DAY.minus({ days }));
}

/**
 * Freezes the tenant clock at 10:00 on the given day (days before the reference day), so
 * services that stamp or date documents with the clock produce that day. The seed restores
 * the original clock state when it is done.
 */
export function enterDay(tenant: Tenant, days: number): void {
  tenant.clock.freeze(REFERENCE_DAY.minus({ days }).set({ hour: 10 }));
}

/** Midnight (Berlin, ISO 8601 with offset) of the day the given number of days before the reference day. */
export function dayStartIso(days: number): string {
  return toIso(REFERENCE_DAY.minus({ days }));
}
