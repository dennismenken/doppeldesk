import type { FastifyInstance } from "fastify";
import qs from "qs";
import { badRequest } from "../lib/errors.ts";

const QS_OPTIONS = { depth: 10, arrayLimit: 100, parameterLimit: 10_000 } as const;

/** Query string parser with bracket notation: "contact[id]=1" -> {contact: {id: "1"}}. */
export function parseQuery(text: string): Record<string, unknown> {
  return qs.parse(text, QS_OPTIONS);
}

/**
 * Body parsers: JSON (empty body allowed, prototype keys dropped), form data via qs (an
 * empty body counts as absent like for JSON),
 * and a raw Buffer fallback for every other content type (e.g. multipart uploads).
 */
export function registerBodyParsers(app: FastifyInstance): void {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    const text = String(body);
    if (text.trim() === "") return done(null, undefined);
    try {
      done(null, JSON.parse(text, dropPrototypeKeys));
    } catch {
      done(badRequest("Invalid JSON in request body"), undefined);
    }
  });
  app.removeContentTypeParser("application/x-www-form-urlencoded");
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      const text = String(body);
      done(null, text.trim() === "" ? undefined : parseQuery(text));
    },
  );
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, Buffer.isBuffer(body) && body.length > 0 ? body : undefined);
  });
}

function dropPrototypeKeys(key: string, value: unknown): unknown {
  return key === "__proto__" || key === "constructor" ? undefined : value;
}
