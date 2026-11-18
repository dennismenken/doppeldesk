import { createHash } from "node:crypto";
import type { PlainObject } from "../../lib/object.ts";
import { parseDateInput } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { contactName, contactOf } from "./contacts.ts";
import { toNumber } from "./money.ts";
import { renderTextPdf } from "./pdf.ts";
import { invalidParameter, isBlank, isOneOf, missingParameters } from "./validation.ts";

/** Layout parameters accepted by changeParameter (spec enum of Model_ChangeLayout.key). */
export const LAYOUT_KEYS = ["language", "template", "letterpaper", "payPal"] as const;

/** Layout parameters a rendered document reports; DoppelDesk only knows the default language. */
const LAYOUT_PARAMETERS = [
  {
    key: "language",
    name: "Sprache",
    values: [{ name: "deutsch", translationCade: "SEVDOC_LANG_DE_DE", value: "de_DE" }],
    visible: true,
    value: "de_DE",
  },
];

/** A rendered placeholder document. */
export interface RenderedDocument {
  filename: string;
  base64: string;
  /** md5 of the PDF (assumption: sevDesk docIds are 32 hex characters). */
  docId: string;
}

/** Which fields describe a document type in the placeholder PDF. */
export interface RenderOptions {
  numberField: string;
  numberLabel: string;
  dateField: string;
  dateLabel: string;
  /** Used for the filename when the document has no number. */
  fallbackName: string;
  positions: readonly Doc[];
}

/**
 * Renders a deterministic placeholder PDF of a document (header, address, number, date,
 * positions, totals). Not a sevDesk layout; the bytes only depend on the stored data.
 */
export function renderDocument(tenant: Tenant, document: Doc, options: RenderOptions): RenderedDocument {
  const currency = typeof document.currency === "string" ? document.currency : "EUR";
  const address =
    typeof document.address === "string"
      ? document.address.split("\n")
      : [contactName(contactOf(tenant, document.contact))];
  const number = text(document[options.numberField]);
  const lines = [
    text(document.header),
    "",
    ...address.filter((line) => line !== ""),
    "",
    `${options.numberLabel}: ${number}`,
    `${options.dateLabel}: ${germanDate(document[options.dateField])}`,
    "",
    ...options.positions.map(
      (pos) =>
        `${formatAmount(pos.quantity)} x ${text(pos.name)} (${formatAmount(pos.taxRate)} %): ${formatAmount(pos.sumNet)} ${currency}`,
    ),
    "",
    `Netto: ${formatAmount(document.sumNet)} ${currency}`,
    `Umsatzsteuer: ${formatAmount(document.sumTax)} ${currency}`,
    `Brutto: ${formatAmount(document.sumGross)} ${currency}`,
  ];
  const pdf = renderTextPdf(lines);
  return {
    filename: `${number || options.fallbackName}.pdf`,
    base64: pdf.toString("base64"),
    docId: createHash("md5").update(pdf).digest("hex"),
  };
}

/** getPdf response (spec: filename, mimeType, base64encoded, content). */
export function pdfFile(rendered: RenderedDocument): PlainObject {
  return {
    filename: rendered.filename,
    mimeType: "application/pdf",
    base64encoded: true,
    content: rendered.base64,
  };
}

/** render / sendByWithRender response (spec: pdf as base64, docId, parameters). */
export function renderResult(rendered: RenderedDocument): PlainObject {
  return { pdf: rendered.base64, docId: rendered.docId, parameters: LAYOUT_PARAMETERS };
}

/**
 * changeParameter: validates key and value and answers with the re-rendered document.
 * Assumption: the layout choice is not stored, the placeholder PDF has no layouts.
 */
export function changeLayout(rendered: RenderedDocument, input: PlainObject): PlainObject {
  const missing = ["key", "value"].filter((name) => isBlank(input[name]));
  if (missing.length > 0) throw missingParameters(missing);
  if (!isOneOf(LAYOUT_KEYS, input.key)) throw invalidParameter("key", { allowed: LAYOUT_KEYS });
  return { result: "1", metadaten: { pdf: rendered.base64, docId: rendered.docId } };
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function formatAmount(value: unknown): string {
  return toNumber(value).toFixed(2).replace(".", ",");
}

function germanDate(value: unknown): string {
  return parseDateInput(value)?.toFormat("dd.MM.yyyy") ?? "";
}
