import { STATUS_CODES } from "node:http";
import type { Socket } from "node:net";
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

/** Message and status of the HTTP parser errors that are answered before any request exists. */
function clientErrorResponse(error: NodeJS.ErrnoException): { status: number; message: string } {
  switch (error.code) {
    case "ERR_HTTP_REQUEST_TIMEOUT":
      return { status: 408, message: "Request Timeout" };
    case "HPE_HEADER_OVERFLOW":
      return { status: 431, message: "Exceeded maximum allowed HTTP header size" };
    case "HPE_INVALID_URL":
      return {
        status: 400,
        message:
          "Invalid character in the request URL. Percent-encode non-ASCII characters as UTF-8 (e.g. %C3%A4)",
      };
    default:
      return { status: 400, message: "Bad Request" };
  }
}

/**
 * Fastify "clientErrorHandler" option: the HTTP parser rejects a request before Fastify sees
 * it (raw non-ASCII bytes in the URL, malformed request line or headers, header overflow, request
 * timeout), so no route or hook can answer. Writes the error in the sevDesk format like
 * everything else and closes the connection, as Fastify's default handler does.
 */
export function clientErrorHandler(
  this: FastifyInstance,
  error: NodeJS.ErrnoException,
  socket: Socket,
): void {
  // A reset connection is already destroyed and there is nobody to answer.
  if (error.code === "ECONNRESET" || socket.destroyed) return;
  this.log.trace({ err: error }, "client error");
  if (socket.writable) {
    const { status, message } = clientErrorResponse(error);
    const body = JSON.stringify(errorBody(message));
    socket.write(
      `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nContent-Type: application/json; charset=utf-8\r\nConnection: close\r\n\r\n${body}`,
    );
  }
  socket.destroy(error);
}

function sendError(error: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (error instanceof ApiError) return reply.code(error.status).send(error.toBody());
  const status = isPlainObject(error) && typeof error.statusCode === "number" ? error.statusCode : 500;
  if (status >= 500) request.log.error({ err: error }, "Unhandled error");
  const message = status >= 500 || !(error instanceof Error) ? "Internal Server Error" : error.message;
  return reply.code(status).send(errorBody(message));
}
