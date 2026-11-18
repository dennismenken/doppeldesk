import type { HttpMethod } from "../lib/routePath.ts";

/** Subset of an OpenAPI 3.0 schema object used by DoppelDesk. Unknown keys are kept. */
export interface Schema {
  $ref?: string;
  type?: string;
  format?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  enum?: unknown[];
  example?: unknown;
  default?: unknown;
  nullable?: boolean;
  required?: string[];
  [key: string]: unknown;
}

/** One parameter of an operation (path or query). */
export interface SpecParameter {
  name: string;
  in: string;
  required: boolean;
  schema: Schema | undefined;
}

/** One operation of the spec, flattened for routing. */
export interface SpecOperation {
  /** Route identity, see routeKey(): "GET /Invoice/{}". */
  key: string;
  method: HttpMethod;
  /** Spec path template, e.g. "/Invoice/{invoiceId}/getPositions". */
  path: string;
  operationId: string | undefined;
  tag: string | undefined;
  summary: string | undefined;
  parameters: SpecParameter[];
  /** JSON request body schema, if declared. */
  requestBodySchema: Schema | undefined;
  /** First 2xx status code declared by the spec. */
  successStatus: number;
  /** Raw schema of the first 2xx JSON response (may or may not contain the "objects" envelope). */
  responseSchema: Schema | undefined;
}

/** Minimal shape of the parsed OpenAPI document. */
export interface OpenApiDocument {
  openapi: string;
  info?: { title?: string; version?: string };
  paths: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, Schema> };
}
