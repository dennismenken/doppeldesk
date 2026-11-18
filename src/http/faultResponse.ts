import { STATUS_CODES } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyReply } from "fastify";
import { errorBody } from "../lib/errors.ts";
import type { Fault } from "../tenant/faults.ts";
import type { Tenant } from "../tenant/tenant.ts";

/** Body of an "invalid-json" fault: truncated JSON with a JSON content type. */
const BROKEN_JSON = '{"objects":[{"id":"1","objectName":';

/**
 * Answers a request according to a fault. Returns false when the connection was
 * dropped without a response (hanging timeout, client gave up or server shutdown).
 */
export async function sendFault(
  fault: Fault,
  reply: FastifyReply,
  tenant: Tenant,
  shutdown: AbortSignal,
): Promise<boolean> {
  switch (fault.type) {
    case "status": {
      const status = fault.status ?? 500;
      await reply.code(status).send(errorBody(fault.message ?? defaultMessage(status)));
      return true;
    }
    case "feature-lock": {
      const message = `Feature with the code '${fault.code}' is not available for the user id ${fault.userId ?? defaultUserId(tenant)}`;
      await reply.code(fault.status ?? 500).send(errorBody(message));
      return true;
    }
    case "invalid-json":
      await reply.code(200).type("application/json; charset=utf-8").send(BROKEN_JSON);
      return true;
    case "timeout":
      return timeout(fault, reply, shutdown);
  }
}

/**
 * Waits delayMs (aborted early when the client disconnects or the server shuts down).
 * Without "hang" the request then fails with 504; with "hang" or when aborted the
 * connection is dropped without answer.
 */
async function timeout(fault: Fault, reply: FastifyReply, shutdown: AbortSignal): Promise<boolean> {
  const disconnect = new AbortController();
  const onClose = () => disconnect.abort();
  reply.raw.once("close", onClose);
  const signal = AbortSignal.any([disconnect.signal, shutdown]);
  try {
    await delay(fault.delayMs, undefined, { signal });
  } catch {
    // Client disconnected or server shutdown while waiting.
  } finally {
    reply.raw.off("close", onClose);
  }
  if (signal.aborted || fault.hang) {
    reply.hijack();
    reply.raw.destroy();
    return false;
  }
  await reply.code(504).send(errorBody(defaultMessage(504)));
  return true;
}

function defaultMessage(status: number): string {
  return status === 401 ? "Authentication required" : (STATUS_CODES[status] ?? "Error");
}

function defaultUserId(tenant: Tenant): string {
  return tenant.store.collection("SevUser").all()[0]?.id ?? tenant.sevClientId;
}
