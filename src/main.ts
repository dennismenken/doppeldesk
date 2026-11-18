import { type Config, ConfigError, loadConfig } from "./config.ts";
import { errorMessage, StartupError } from "./lib/errors.ts";
import { isPlainObject } from "./lib/object.ts";
import { buildServer, type DoppelDeskServer } from "./server.ts";

/** Entry point: node src/main.ts */
async function main(): Promise<void> {
  const config = loadConfig();
  const server = await buildServer(config);
  await listen(server, config);

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    server.app.log.info({ signal }, "Shutting down");
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

/**
 * Starts listening. Errors of the socket (port taken, no permission, unknown address) end the
 * start with a one-line StartupError like the other startup failures. The server is not
 * closed on purpose: closing flushes the state file, which could overwrite the state of the
 * instance that holds the port with the same data directory.
 */
async function listen(server: DoppelDeskServer, config: Config): Promise<void> {
  try {
    await server.app.listen({ port: config.port, host: config.host });
  } catch (error) {
    throw new StartupError(listenFailure(error, config));
  }
}

function listenFailure(error: unknown, config: Config): string {
  const address = `port ${config.port} on ${config.host}`;
  const code = isPlainObject(error) ? error.code : undefined;
  if (code === "EADDRINUSE") return `${address} is already in use`;
  if (code === "EACCES") return `no permission to listen on ${address}`;
  if (code === "EADDRNOTAVAIL" || code === "ENOTFOUND") return `${address} is not available on this machine`;
  return `cannot listen on ${address}: ${errorMessage(error)}`;
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(`Configuration error: ${error.message}`);
  else if (error instanceof StartupError) console.error(`Startup error: ${error.message}`);
  else console.error(error);
  process.exit(1);
});
