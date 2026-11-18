import type { FastifyBaseLogger } from "fastify";

/** Logger used across DoppelDesk (the Fastify/pino logger). */
export type Logger = Pick<FastifyBaseLogger, "info" | "warn" | "error" | "debug">;
