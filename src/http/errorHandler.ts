import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError, errorBody } from "../lib/errors.ts";
import { isPlainObject } from "../lib/object.ts";

/**
 * Renders every error of a route or hook in the sevDesk format {"objects": null, "error": {...}}:
 * ApiError with its status, Fastify client errors (4xx) with their message, anything
 * else as logged 500 "Internal Server Error".
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => sendError(error, request, reply));
}

/**
 * Fastify "frameworkErrors" option: errors the router raises before any route or hook runs
 * (malformed URL encoding, too long path parameters), in the same sevDesk format.
 */
export function frameworkErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  void sendError(error, request, reply);
}

function sendError(error: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (error instanceof ApiError) return reply.code(error.status).send(error.toBody());
  const status = isPlainObject(error) && typeof error.statusCode === "number" ? error.statusCode : 500;
  if (status >= 500) request.log.error({ err: error }, "Unhandled error");
  const message = status >= 500 || !(error instanceof Error) ? "Internal Server Error" : error.message;
  return reply.code(status).send(errorBody(message));
}
