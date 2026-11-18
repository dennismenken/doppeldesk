// Compares the upstream sevDesk OpenAPI spec with the bundled copy and prints a Markdown report.
// Usage: node scripts/update-spec.ts [--write] [--fail-on-diff]
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const UPSTREAM_URL = "https://api.sevdesk.de/openapi.yaml";
const BUNDLED_PATH = fileURLToPath(new URL("../spec/sevdesk-openapi.yaml", import.meta.url));
const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface Diff {
  added: string[];
  removed: string[];
  changed: string[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

// Serializes with sorted object keys so that key order never produces a diff.
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (!isObject(val)) return val;
    return Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)));
  });
}

// Maps "METHOD /path" to the stable JSON of the parts that define the operation contract.
function collectOperations(spec: JsonObject): Map<string, string> {
  const operations = new Map<string, string>();
  for (const [path, pathItem] of Object.entries(asObject(spec.paths))) {
    const item = asObject(pathItem);
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!isObject(operation)) continue;
      const contract = {
        parameters: [
          ...(Array.isArray(item.parameters) ? item.parameters : []),
          ...asArray(operation.parameters),
        ],
        requestBody: operation.requestBody ?? null,
        responses: operation.responses ?? null,
      };
      operations.set(`${method.toUpperCase()} ${path}`, stableJson(contract));
    }
  }
  return operations;
}

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

function collectSchemas(spec: JsonObject): Map<string, string> {
  const schemas = asObject(asObject(spec.components).schemas);
  return new Map(Object.entries(schemas).map(([name, schema]) => [name, stableJson(schema)]));
}

function diffMaps(before: Map<string, string>, after: Map<string, string>): Diff {
  const added = [...after.keys()].filter((key) => !before.has(key));
  const removed = [...before.keys()].filter((key) => !after.has(key));
  const changed = [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key));
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

function isEmpty(diff: Diff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}

function section(title: string, entries: string[]): string[] {
  if (entries.length === 0) return [];
  return [`#### ${title} (${entries.length})`, "", ...entries.map((entry) => `- \`${entry}\``), ""];
}

function renderDiff(heading: string, diff: Diff, changedTitle: string): string[] {
  if (isEmpty(diff)) return [];
  return [
    `### ${heading}`,
    "",
    ...section("Hinzugefügt", diff.added),
    ...section("Entfernt", diff.removed),
    ...section(changedTitle, diff.changed),
  ];
}

function versionOf(spec: JsonObject): string {
  const version = asObject(spec.info).version;
  return typeof version === "string" ? version : "unbekannt";
}

async function fetchUpstream(): Promise<string> {
  const response = await fetch(UPSTREAM_URL);
  if (!response.ok) {
    throw new Error(`Download of ${UPSTREAM_URL} failed with status ${response.status}`);
  }
  return response.text();
}

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  const [bundledText, upstreamText] = await Promise.all([readFile(BUNDLED_PATH, "utf8"), fetchUpstream()]);

  if (flags.has("--write") && bundledText !== upstreamText) {
    await writeFile(BUNDLED_PATH, upstreamText);
  }

  const bundled = asObject(parse(bundledText));
  const upstream = asObject(parse(upstreamText));
  const operationDiff = diffMaps(collectOperations(bundled), collectOperations(upstream));
  const schemaDiff = diffMaps(collectSchemas(bundled), collectSchemas(upstream));
  const identical =
    isEmpty(operationDiff) && isEmpty(schemaDiff) && stableJson(bundled) === stableJson(upstream);

  if (identical) {
    console.log("Keine Änderungen");
    return;
  }

  const lines = [
    "## Unterschiede der sevDesk OpenAPI Spezifikation",
    "",
    `- info.version gebündelt: \`${versionOf(bundled)}\``,
    `- info.version upstream: \`${versionOf(upstream)}\``,
    `- Quelle: ${UPSTREAM_URL}`,
    flags.has("--write") ? "- Die gebündelte Spezifikation wurde überschrieben." : "",
    "",
    ...renderDiff("Operationen", operationDiff, "Parameter oder Request/Response geändert"),
    ...renderDiff("Komponenten-Schemas", schemaDiff, "Geändert"),
  ];
  if (isEmpty(operationDiff) && isEmpty(schemaDiff)) {
    lines.push(
      "Operationen und Schemas sind identisch, andere Teile der Spezifikation (z. B. Beschreibungen) unterscheiden sich.",
      "",
    );
  }
  console.log(lines.join("\n"));

  if (flags.has("--fail-on-diff")) process.exitCode = 1;
}

await main();
