import { Clock, type ClockState } from "../lib/time.ts";
import type { CollectionSnapshot } from "../store/collection.ts";
import { DocumentStore } from "../store/documentStore.ts";
import { NumberRanges } from "../store/numberRanges.ts";
import { FaultRegistry } from "./faults.ts";
import { rebaseSnapshot } from "./rebase.ts";
import { RequestLog } from "./requestLog.ts";

/** Version of the snapshot format (GET/PUT /__doppeldesk/state, state.json). */
export const SNAPSHOT_VERSION = 1;

/** Complete persistent state of a tenant. Faults and the request log are runtime-only. */
export interface TenantSnapshot {
  version: number;
  sevClientId: string;
  clock: ClockState;
  numberRanges: Record<string, number>;
  collections: Record<string, CollectionSnapshot>;
}

/**
 * One isolated fake sevDesk account, selected by API token. Domain handlers use
 * store (documents), clock (Europe/Berlin time), numberRanges and sevClientId.
 */
export class Tenant {
  /** sevClient id of this account; documents reference it as {id, objectName: "SevClient"}. */
  readonly sevClientId: string;
  readonly store: DocumentStore;
  readonly clock: Clock;
  readonly numberRanges: NumberRanges;
  readonly requestLog: RequestLog;
  readonly faults = new FaultRegistry();
  readonly #onChange: () => void;

  constructor(options: { sevClientId: string; requestLogSize: number; onChange: () => void }) {
    this.sevClientId = options.sevClientId;
    this.#onChange = options.onChange;
    this.store = new DocumentStore(options.onChange);
    this.clock = new Clock(options.onChange);
    this.numberRanges = new NumberRanges(options.onChange);
    this.requestLog = new RequestLog(options.requestLogSize);
  }

  snapshot(): TenantSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      sevClientId: this.sevClientId,
      clock: this.clock.state,
      numberRanges: this.numberRanges.snapshot(),
      collections: this.store.snapshot(),
    };
  }

  /**
   * Replaces documents, number ranges and clock with the snapshot content. The sevClientId
   * stays; a snapshot of another sevClient is moved to it first (see rebaseSnapshot).
   */
  restore(input: TenantSnapshot): void {
    const snapshot = rebaseSnapshot(input, this.sevClientId);
    this.store.restore(snapshot.collections);
    this.numberRanges.restore(snapshot.numberRanges);
    this.clock.restore(snapshot.clock);
    this.#onChange();
  }

  /** Empties all state: documents, number ranges, clock, faults and request log. */
  clear(): void {
    this.restore({
      version: SNAPSHOT_VERSION,
      sevClientId: this.sevClientId,
      clock: { mode: "real" },
      numberRanges: {},
      collections: {},
    });
    this.faults.clear();
    this.requestLog.clear();
  }
}
