import type { Config, SeedMode } from "../config.ts";
import { Tenant, type TenantSnapshot } from "./tenant.ts";

/** Fills a fresh tenant with seed data (implemented in src/seed). */
export type Seeder = (tenant: Tenant, mode: SeedMode) => void;

/**
 * Tenants keyed by API token. Configured tokens exist from the start; with "*"
 * any other non-empty token creates a tenant on first use. Fresh tenants are seeded
 * with the configured seed mode, restored ones keep their persisted state. Persisted
 * tenants whose token is no longer accepted stay dormant: not served, but kept in
 * snapshotAll so that file persistence never drops them.
 */
export class TenantRegistry {
  readonly #tenants = new Map<string, Tenant>();
  readonly #dormant = new Map<string, TenantSnapshot>();
  readonly #config: Config;
  readonly #seeder: Seeder;
  readonly #onChange: () => void;

  constructor(options: { config: Config; seeder: Seeder; onChange: () => void }) {
    this.#config = options.config;
    this.#seeder = options.seeder;
    this.#onChange = options.onChange;
  }

  /** Restores persisted tenants and creates the configured ones that are still missing. */
  initialize(persisted: Record<string, TenantSnapshot> = {}): void {
    for (const [token, snapshot] of Object.entries(persisted)) {
      if (!this.#accepts(token)) {
        this.#dormant.set(token, snapshot);
        continue;
      }
      const tenant = this.#build(snapshot.sevClientId);
      tenant.restore(snapshot);
      this.#tenants.set(token, tenant);
    }
    for (const token of this.#config.tokens) {
      if (!this.#tenants.has(token)) this.#createFresh(token);
    }
  }

  /** Tenant for an API token, creating it when "*" is configured. Undefined = unauthorized. */
  resolve(token: string | undefined): Tenant | undefined {
    if (token === undefined || token === "") return undefined;
    const existing = this.#tenants.get(token);
    if (existing !== undefined) return existing;
    return this.#accepts(token) ? this.#createFresh(token) : undefined;
  }

  /** Clears a tenant and applies the given seed mode (default: configured seed). */
  reset(tenant: Tenant, seed: SeedMode = this.#config.seed): void {
    tenant.clear();
    this.#seeder(tenant, seed);
    this.#onChange();
  }

  /** Snapshots of all tenants keyed by token, dormant ones included (for file persistence). */
  snapshotAll(): Record<string, TenantSnapshot> {
    const active = [...this.#tenants].map(([token, tenant]) => [token, tenant.snapshot()] as const);
    return Object.fromEntries([...this.#dormant, ...active]);
  }

  get size(): number {
    return this.#tenants.size;
  }

  /** Number of persisted tenants kept but not served because their token is not configured. */
  get dormantCount(): number {
    return this.#dormant.size;
  }

  #accepts(token: string): boolean {
    return this.#config.acceptAnyToken || this.#config.tokens.includes(token);
  }

  #createFresh(token: string): Tenant {
    const tenant = this.#build(String(this.#nextSevClientId()));
    this.#tenants.set(token, tenant);
    this.#seeder(tenant, this.#config.seed);
    this.#onChange();
    return tenant;
  }

  #build(sevClientId: string): Tenant {
    return new Tenant({ sevClientId, requestLogSize: this.#config.requestLogSize, onChange: this.#onChange });
  }

  /** Next sevClient id, unique across active and dormant tenants. */
  #nextSevClientId(): number {
    const used = [...this.#tenants.values(), ...this.#dormant.values()];
    const ids = used.map((tenant) => Number(tenant.sevClientId)).filter(Number.isFinite);
    return Math.max(0, ...ids) + 1;
  }
}
