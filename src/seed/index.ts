import type { SeedMode } from "../config.ts";
import type { Tenant } from "../tenant/tenant.ts";
import { seedBasic } from "./basic.ts";
import { seedDemo } from "./demo.ts";
import { seedNone } from "./none.ts";

/** Fills a fresh (empty) tenant according to the seed mode. Must be deterministic. */
export function applySeed(tenant: Tenant, mode: SeedMode): void {
  switch (mode) {
    case "none":
      seedNone(tenant);
      return;
    case "basic":
      seedBasic(tenant);
      return;
    case "demo":
      seedDemo(tenant);
      return;
  }
}
