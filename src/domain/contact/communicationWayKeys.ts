import type { PlainObject } from "../../lib/object.ts";

/**
 * The communication way keys of a sevDesk account (ids and names from the spec's
 * description of GET /CommunicationWayKey). Only id 2 has a documented translationCode.
 * Plain seed objects with explicit ids; the seeds stamp objectName, create, update and sevClient.
 */
export const COMMUNICATION_WAY_KEYS: readonly PlainObject[] = [
  { id: "1", name: "Privat", translationCode: null },
  { id: "2", name: "Arbeit", translationCode: "COMM_WAY_KEY_WORK" },
  { id: "3", name: "Fax", translationCode: null },
  { id: "4", name: "Mobil", translationCode: null },
  { id: "5", name: " ", translationCode: null },
  { id: "6", name: "Autobox", translationCode: null },
  { id: "7", name: "Newsletter", translationCode: null },
  { id: "8", name: "Rechnungsadresse", translationCode: null },
];
