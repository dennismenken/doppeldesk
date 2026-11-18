import type { DomainModule } from "../../routes/types.ts";
import { partRoutes } from "./parts.ts";
import { referenceRoutes } from "./referenceRoutes.ts";
import { sevClientRoutes } from "./sevClient.ts";
import { sevSequenceRoutes } from "./sevSequences.ts";
import { toolsRoutes } from "./tools.ts";

/** Master and reference data, including endpoints missing from the spec (StaticCountry, SevUser, Category, Unity, TaxRule, TaxSet, SevSequence), parts and tools. */
export const masterDataModule: DomainModule = {
  name: "masterData",
  models: [
    "StaticCountry",
    "SevUser",
    "Category",
    "Unity",
    "TaxRule",
    "TaxSet",
    "SevClient",
    "SevSequence",
    "Part",
    "Basics",
    "Tools",
  ],
  routes: [...referenceRoutes, ...sevClientRoutes, ...sevSequenceRoutes, ...partRoutes, ...toolsRoutes],
};
