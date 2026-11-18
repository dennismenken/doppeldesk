import { createDocument, updateDocument } from "../domain/shared/documents.ts";
import { embed, type ListOptions, listDocuments } from "../domain/shared/list.ts";
import { isParamSegment, paramNames, splitPath } from "../lib/routePath.ts";
import { toIso } from "../lib/time.ts";
import { objectsSchema } from "../serialize/envelope.ts";
import { sampleValue } from "../serialize/sample.ts";
import { effectiveSchema } from "../serialize/serializer.ts";
import { SpecIndex } from "../spec/specIndex.ts";
import type { Schema, SpecOperation } from "../spec/types.ts";
import { pathParam } from "./context.ts";
import { assertRequiredFields } from "./requestBody.ts";
import type { RouteContext, RouteHandler, RouteResult } from "./types.ts";

/** Collection name of a path template: its first segment ("/Invoice/{id}" -> "Invoice"). */
export function modelOfPath(path: string): string {
  return splitPath(path)[0] ?? "";
}

/**
 * Generic behavior for a spec operation, chosen by path shape:
 * "/{Model}" GET list, POST create; "/{Model}/{id}" GET, PUT (merge), DELETE;
 * anything else is an action (see actionFallback).
 */
export function genericHandler(operation: SpecOperation): RouteHandler {
  const segments = splitPath(operation.path);
  const model = modelOfPath(operation.path);
  const idParam =
    segments[1] !== undefined && isParamSegment(segments[1]) ? paramNames(operation.path)[0] : undefined;
  const idOf = (context: RouteContext): string | undefined =>
    idParam === undefined ? undefined : pathParam(context, idParam);

  if (segments.length === 1 && operation.method === "GET") return (context) => listModel(context, model);
  if (segments.length === 1 && operation.method === "POST") return (context) => createModel(context, model);
  if (segments.length === 2 && idParam !== undefined) {
    const id = (context: RouteContext) => pathParam(context, idParam);
    if (operation.method === "GET") return (context) => getModel(context, model, id(context));
    if (operation.method === "PUT") return (context) => updateModel(context, model, id(context));
    if (operation.method === "DELETE") return (context) => deleteModel(context, model, id(context));
  }
  return (context) => actionFallback(context, model, idOf(context));
}

/** Lists a collection with sevDesk pagination, generic filters and embed. */
export function listModel(context: RouteContext, model: string, options: ListOptions = {}): RouteResult {
  return listDocuments(context.tenant.store.collection(model).all(), context.query, {
    fields: modelFieldNames(context.spec, responseObjectsSchema(context)),
    store: context.tenant.store,
    ...options,
  });
}

/** GET one document as array of one (sevDesk style), 404 when missing; honors embed. */
export function getModel(context: RouteContext, model: string, id: string): RouteResult {
  const doc = context.tenant.store.collection(model).require(id);
  return { objects: embed([doc], context.query.embed, context.tenant.store) };
}

/** Creates a document from the request body with standard stamps; 400 when a required field is missing. */
export function createModel(context: RouteContext, model: string): RouteResult {
  assertRequiredFields(context.spec, context.operation?.requestBodySchema, context.input);
  return { objects: createDocument(context.tenant, model, context.input) };
}

/** Merges the request body into an existing document, 404 when missing. */
export function updateModel(context: RouteContext, model: string, id: string): RouteResult {
  return { objects: updateDocument(context.tenant, model, id, context.input) };
}

/** Deletes a document, 404 when missing; responds {"objects": [null]}. */
export function deleteModel(context: RouteContext, model: string, id: string): RouteResult {
  const collection = context.tenant.store.collection(model);
  collection.require(id);
  collection.delete(id);
  return { objects: [null] };
}

/**
 * Action endpoint without domain behavior. With an id: 404 when the document is
 * missing; returns the stored document when the response schema describes this model.
 * Otherwise a deterministic sample generated from the response schema.
 */
export function actionFallback(context: RouteContext, model: string, id: string | undefined): RouteResult {
  const schema = responseObjectsSchema(context);
  if (id !== undefined) {
    const doc = context.tenant.store.collection(model).require(id);
    if (schemaTargetsModel(context.spec, schema, model)) return { objects: doc };
  }
  return { objects: sampleValue(context.spec, schema, toIso(context.tenant.clock.now()), model) };
}

/** "objects" schema of the context's spec operation, if any. */
export function responseObjectsSchema(context: RouteContext): Schema | undefined {
  return objectsSchema(context.spec, context.operation?.responseSchema);
}

/** Property names of a (list item) schema, used as known filter fields. */
export function modelFieldNames(spec: SpecIndex, schema: Schema | undefined): string[] {
  const resolved = effectiveSchema(spec, schema);
  const item = resolved?.items === undefined ? resolved : effectiveSchema(spec, resolved.items);
  return Object.keys(item?.properties ?? {});
}

/**
 * True when the schema (possibly array or allOf) references a component schema of the
 * model: "Model_<Model>", "Model_<Model>Response", case-insensitive.
 */
export function schemaTargetsModel(spec: SpecIndex, schema: Schema | undefined, model: string): boolean {
  const target = model.toLowerCase();
  const visit = (current: Schema | undefined, depth: number): boolean => {
    if (current === undefined || depth > 4) return false;
    const name = SpecIndex.refName(current);
    if (name !== undefined) {
      const normalized = name
        .toLowerCase()
        .replace(/^model_/, "")
        .replace(/response$/, "");
      return normalized === target || visit(spec.resolve(current), depth + 1);
    }
    return visit(current.items, depth + 1) || (current.allOf ?? []).some((part) => visit(part, depth + 1));
  };
  return visit(schema, 0);
}
