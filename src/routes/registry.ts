import type { Logger } from "../lib/logger.ts";
import { routeKey } from "../lib/routePath.ts";
import { objectsSchema, schemaRef } from "../serialize/envelope.ts";
import type { SpecIndex } from "../spec/specIndex.ts";
import type { Schema } from "../spec/types.ts";
import { genericHandler } from "./generic.ts";
import { withKnownFactoryParts, withKnownFields } from "./knownFields.ts";
import type { DomainModule, ResolvedRoute, RouteDefinition } from "./types.ts";

interface OwnedRoute {
  module: string;
  definition: RouteDefinition;
}

/**
 * Merges spec operations and domain routes by route key (method + path with erased
 * parameter names). A domain route replaces the generic route of the same key; domain
 * routes the spec does not know are added as "extra". Every key appears exactly once.
 * Create and update handlers of spec operations only see the properties their model knows
 * (see withKnownFields).
 */
export function buildRoutes(spec: SpecIndex, modules: readonly DomainModule[], log: Logger): ResolvedRoute[] {
  const owned = new Map<string, OwnedRoute>();
  for (const module of modules) {
    for (const definition of module.routes) {
      const key = routeKey(definition.method, definition.path);
      const existing = owned.get(key);
      if (existing !== undefined) {
        throw new Error(`Route ${key} is defined by both ${existing.module} and ${module.name}`);
      }
      owned.set(key, { module: module.name, definition });
    }
  }

  const routes: ResolvedRoute[] = [];
  for (const operation of spec.operations) {
    const domain = owned.get(operation.key);
    owned.delete(operation.key);
    if (domain === undefined) {
      routes.push({
        key: operation.key,
        method: operation.method,
        path: operation.path,
        kind: "generic",
        module: undefined,
        operation,
        handler: withKnownFields(spec, operation, genericHandler(operation)),
        objectsSchema: objectsSchema(spec, operation.responseSchema),
        unvalidatedFields: [],
      });
      continue;
    }
    routes.push({
      key: operation.key,
      method: domain.definition.method,
      path: domain.definition.path,
      kind: "domain",
      module: domain.module,
      operation,
      handler: withKnownFactoryParts(
        spec,
        operation,
        withKnownFields(spec, operation, domain.definition.handler),
        domain.definition.factoryParts ?? [],
      ),
      objectsSchema: explicitSchema(spec, domain, log) ?? objectsSchema(spec, operation.responseSchema),
      unvalidatedFields: domain.definition.unvalidatedFields ?? [],
    });
  }
  for (const [key, extra] of owned) {
    routes.push({
      key,
      method: extra.definition.method,
      path: extra.definition.path,
      kind: "extra",
      module: extra.module,
      operation: undefined,
      handler: extra.definition.handler,
      objectsSchema: explicitSchema(spec, extra, log),
      unvalidatedFields: extra.definition.unvalidatedFields ?? [],
    });
  }
  return routes;
}

function explicitSchema(spec: SpecIndex, route: OwnedRoute, log: Logger): Schema | undefined {
  const declared = route.definition.responseSchema;
  if (declared === undefined || typeof declared !== "string") return declared;
  if (spec.schema(declared) !== undefined) return schemaRef(declared);
  log.warn(
    { module: route.module, path: route.definition.path, schema: declared },
    "Response schema not found in spec, response is not shaped",
  );
  return undefined;
}
