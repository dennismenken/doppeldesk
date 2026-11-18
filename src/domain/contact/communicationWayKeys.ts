import { toIso } from "../../lib/time.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { toRef } from "../shared/refs.ts";

/**
 * The communication way keys of a sevDesk account (ids and names from the spec's
 * description of GET /CommunicationWayKey). Only id 2 has a documented translationCode.
 */
export const COMMUNICATION_WAY_KEYS = [
  { id: "1", name: "Privat", translationCode: null },
  { id: "2", name: "Arbeit", translationCode: "COMM_WAY_KEY_WORK" },
  { id: "3", name: "Fax", translationCode: null },
  { id: "4", name: "Mobil", translationCode: null },
  { id: "5", name: " ", translationCode: null },
  { id: "6", name: "Autobox", translationCode: null },
  { id: "7", name: "Newsletter", translationCode: null },
  { id: "8", name: "Rechnungsadresse", translationCode: null },
] as const;

/** Inserts the standard communication way keys; keys that already exist are left alone. */
export function seedCommunicationWayKeys(tenant: Tenant): void {
  const keys = tenant.store.collection("CommunicationWayKey");
  const now = toIso(tenant.clock.now());
  for (const key of COMMUNICATION_WAY_KEYS) {
    if (keys.has(key.id)) continue;
    keys.insert({
      ...key,
      objectName: "CommunicationWayKey",
      create: now,
      update: now,
      sevClient: toRef(tenant.sevClientId, "SevClient"),
    });
  }
}
