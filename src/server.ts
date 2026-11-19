import Fastify, { type FastifyInstance, type FastifyRequest, LogController } from "fastify";
import type { Config } from "./config.ts";
import { registerControlApi } from "./control/index.ts";
import { domainModules } from "./domain/index.ts";
import { registerApi } from "./http/api.ts";
import { redactTokenInUrl } from "./http/auth.ts";
import { clientErrorHandler, frameworkErrorHandler, registerErrorHandler } from "./http/errorHandler.ts";
import { parseQuery, registerBodyParsers } from "./http/parsing.ts";
import { buildRoutes } from "./routes/registry.ts";
import { applySeed } from "./seed/index.ts";
import { loadSpec } from "./spec/loader.ts";
import { FilePersistence } from "./store/persistence.ts";
import { TenantRegistry } from "./tenant/registry.ts";

const BODY_LIMIT_BYTES = 50 * 1024 * 1024;

/** A fully wired DoppelDesk server, not yet listening. */
export interface DoppelDeskServer {
  app: FastifyInstance;
  /** Ends pending fault delays, flushes persisted state and stops the server. */
  close(): Promise<void>;
}

/** Loads the spec and state, then wires tenants, routes, the API and the control API. */
export async function buildServer(config: Config): Promise<DoppelDeskServer> {
  const app = createApp(config);
  const spec = await loadSpec(config, app.log);

  const persistence =
    config.persist === "file"
      ? new FilePersistence({ dataDir: config.dataDir, log: app.log, collect: () => tenants.snapshotAll() })
      : undefined;
  const tenants = new TenantRegistry({ config, seeder: applySeed, onChange: () => persistence?.markDirty() });
  tenants.initialize(await persistence?.load());
  if (tenants.dormantCount > 0) {
    app.log.warn(
      { dormant: tenants.dormantCount, path: persistence?.path },
      "Persisted tenants without a configured token are kept in the state file but not served",
    );
  }

  const routes = buildRoutes(spec.index, domainModules, app.log);
  const shutdown = new AbortController();
  registerApi(app, {
    basePath: config.basePath,
    spec: spec.index,
    tenants,
    routes,
    shutdown: shutdown.signal,
  });
  registerControlApi(app, { config, spec, tenants, routes, modules: domainModules });
  app.log.info(
    {
      routes: routes.length,
      domain: routes.filter((route) => route.kind === "domain").length,
      extra: routes.filter((route) => route.kind === "extra").length,
      tenants: tenants.size,
      persist: config.persist,
    },
    "DoppelDesk configured",
  );

  return {
    app,
    async close() {
      // Waiting timeout faults would hold the drain for up to an hour; end them first and
      // persist before draining, so a hard kill after the grace period loses nothing.
      shutdown.abort();
      await persistence?.flush();
      await app.close();
      await persistence?.flush();
    },
  };
}

/** Fastify instance with DoppelDesk parsing and sevDesk-style error rendering. */
function createApp(config: Config): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel, serializers: { req: serializeRequest } },
    logController: new LogController({
      disableRequestLogging: config.logLevel !== "debug" && config.logLevel !== "trace",
    }),
    bodyLimit: BODY_LIMIT_BYTES,
    routerOptions: { ignoreTrailingSlash: true, querystringParser: parseQuery },
    frameworkErrors: frameworkErrorHandler,
    clientErrorHandler,
  });
  registerBodyParsers(app);
  registerErrorHandler(app);
  return app;
}

/** Request fields in server logs (Fastify defaults), with the "token" query value redacted. */
function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: redactTokenInUrl(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort,
  };
}
