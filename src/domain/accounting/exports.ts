import { createHash } from "node:crypto";
import { notFound } from "../../lib/errors.ts";
import { isPlainObject } from "../../lib/object.ts";
import { parseDateInput, toIso } from "../../lib/time.ts";
import type { RouteContext, RouteDefinition } from "../../routes/types.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { createDocument } from "../shared/documents.ts";
import { renderTextPdf } from "../shared/pdf.ts";
import { refId } from "../shared/refs.ts";
import { invalidParameter, missingParameters } from "../shared/validation.ts";

const EXPORT_JOB = "ExportJob";

/** Lifetime of a download link; the spec example link expires after 604800 seconds. */
const LINK_LIFETIME_DAYS = 7;

type FileKind = "csv" | "zip" | "pdf";

interface FileExport {
  path: string;
  /** Collection whose documents fill a CSV; irrelevant for zip and pdf. */
  model: string;
  columns: readonly string[];
  kind: FileKind;
  filename: string;
}

/*
 * Assumption: the file exports list the stored documents with a small, fixed column set.
 * Real sevDesk files are richer; DoppelDesk only guarantees a deterministic, parseable file.
 */
const FILE_EXPORTS: readonly FileExport[] = [
  {
    path: "/Export/invoiceCsv",
    model: "Invoice",
    columns: ["invoiceNumber", "invoiceDate", "status", "sumNet", "sumTax", "sumGross"],
    kind: "csv",
    filename: "invoices.csv",
  },
  {
    path: "/Export/creditNoteCsv",
    model: "CreditNote",
    columns: ["creditNoteNumber", "creditNoteDate", "status", "sumNet", "sumTax", "sumGross"],
    kind: "csv",
    filename: "creditNote.csv",
  },
  {
    path: "/Export/voucherListCsv",
    model: "Voucher",
    columns: ["voucherDate", "description", "creditDebit", "status", "sumNet", "sumTax", "sumGross"],
    kind: "csv",
    filename: "vouchers.csv",
  },
  {
    path: "/Export/transactionsCsv",
    model: "CheckAccountTransaction",
    columns: ["valueDate", "payeePayerName", "paymtPurpose", "amount", "status"],
    kind: "csv",
    filename: "transaction.csv",
  },
  {
    path: "/Export/contactListCsv",
    model: "Contact",
    columns: ["customerNumber", "name", "surename", "familyname"],
    kind: "csv",
    filename: "contacts.csv",
  },
  {
    path: "/Export/datevCSV",
    model: "Voucher",
    columns: ["voucherDate", "description", "creditDebit", "sumGross"],
    kind: "csv",
    filename: "datev.csv",
  },
  { path: "/Export/invoiceZip", model: "Invoice", columns: [], kind: "zip", filename: "invoices.zip" },
  { path: "/Export/voucherZip", model: "Voucher", columns: [], kind: "zip", filename: "vouchers.zip" },
  { path: "/Report/invoicelist", model: "Invoice", columns: [], kind: "pdf", filename: "invoice.pdf" },
  { path: "/Report/orderlist", model: "Order", columns: [], kind: "pdf", filename: "order.pdf" },
  { path: "/Report/contactlist", model: "Contact", columns: [], kind: "pdf", filename: "contact.pdf" },
  { path: "/Report/voucherlist", model: "Voucher", columns: [], kind: "pdf", filename: "voucher.pdf" },
];

const MIME_BY_KIND: Readonly<Record<FileKind, string>> = {
  csv: "text/csv",
  zip: "application/zip",
  pdf: "application/pdf",
};

/** An empty but valid zip archive (end of central directory record only). */
const EMPTY_ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);

/** A one-page placeholder PDF naming the report file. */
function placeholderPdf(file: FileExport): Buffer {
  return renderTextPdf([file.filename]);
}

function csvCell(value: unknown): string {
  const text = String((isPlainObject(value) ? refId(value) : value) ?? "");
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(tenant: Tenant, file: FileExport, limit: number): Buffer {
  const rows = tenant.store
    .collection(file.model)
    .all()
    .slice(0, limit)
    .map((doc) => ["id", ...file.columns].map((column) => csvCell(doc[column])).join(";"));
  return Buffer.from(`${[["id", ...file.columns].join(";"), ...rows].join("\n")}\n`, "utf8");
}

function exportLimit(query: RouteContext["query"]): number {
  const limit = Number(isPlainObject(query.sevQuery) ? query.sevQuery.limit : undefined);
  return Number.isInteger(limit) && limit > 0 ? limit : Number.MAX_SAFE_INTEGER;
}

function fileExportRoute(file: FileExport): RouteDefinition {
  return {
    method: "GET",
    path: file.path,
    handler: ({ tenant, query }) => {
      const content =
        file.kind === "csv"
          ? buildCsv(tenant, file, exportLimit(query))
          : file.kind === "zip"
            ? EMPTY_ZIP
            : placeholderPdf(file);
      return {
        objects: {
          filename: file.filename,
          mimetype: MIME_BY_KIND[file.kind],
          base64Encoded: true,
          content: content.toString("base64"),
        },
      };
    },
  };
}

/** Deterministic UUID-shaped job id derived from tenant and document id. */
function jobIdFor(tenant: Tenant, documentId: string): string {
  const hex = createHash("sha1").update(`${tenant.sevClientId}:${documentId}`).digest("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join(
    "-",
  );
}

/** Progress hash a client passes to getProgress: sha1 of the job id plus its first block. */
function progressHash(jobId: string): string {
  return `${createHash("sha1").update(jobId).digest("hex")}_${jobId.slice(0, 8)}`;
}

function dayStamp(value: unknown, name: string): string {
  const parsed = parseDateInput(value);
  if (parsed === undefined) throw invalidParameter(name);
  return parsed.toFormat("yyyyMMdd");
}

function createDatevJob(context: RouteContext, format: "csv" | "xml") {
  const { tenant, query } = context;
  for (const name of ["startDate", "endDate", "scope"]) {
    if (query[name] === undefined || query[name] === "") throw missingParameters([name]);
  }
  const jobs = tenant.store.collection(EXPORT_JOB);
  const nextId = String(jobs.lastId + 1);
  const jobId = jobIdFor(tenant, nextId);
  const filename = [
    "BITTE-ENTPACKEN_Buchungsstapel_und_Belegbilder",
    tenant.sevClientId,
    dayStamp(query.startDate, "startDate"),
    "bis",
    dayStamp(query.endDate, "endDate"),
  ].join("_");
  createDocument(
    tenant,
    EXPORT_JOB,
    {},
    { overrides: { jobId, format, scope: query.scope, filename: `${filename}.zip` } },
  );
  return { objects: jobId };
}

function requireJob(context: RouteContext, value: unknown, name: string): Doc {
  if (typeof value !== "string" || value === "") throw missingParameters([name]);
  const job = context.tenant.store.collection(EXPORT_JOB).findOne((candidate) => candidate.jobId === value);
  if (job === undefined) throw notFound(EXPORT_JOB, value);
  return job;
}

export const exportRoutes: readonly RouteDefinition[] = [
  ...FILE_EXPORTS.map(fileExportRoute),
  {
    method: "GET",
    path: "/Export/createDatevCsvZipExportJob",
    handler: (context) => createDatevJob(context, "csv"),
  },
  {
    method: "GET",
    path: "/Export/createDatevXmlZipExportJob",
    handler: (context) => createDatevJob(context, "xml"),
  },
  {
    method: "GET",
    path: "/Progress/generateDownloadHash",
    // Assumption: the spec declares a progress array, the description says "Returns progress hash"; a string is returned.
    responseSchema: { type: "string" },
    handler: (context) => {
      const job = requireJob(context, context.query.jobId, "jobId");
      return { objects: progressHash(String(job.jobId)) };
    },
  },
  {
    method: "GET",
    path: "/Progress/getProgress",
    handler: (context) => {
      const hash = context.query.hash;
      if (typeof hash !== "string" || hash === "") throw missingParameters(["hash"]);
      const job = context.tenant.store
        .collection(EXPORT_JOB)
        .findOne((candidate) => progressHash(String(candidate.jobId)) === hash);
      if (job === undefined) throw notFound(EXPORT_JOB, hash);
      // Assumption: export jobs finish immediately.
      return { objects: [{ current: 100, total: 100 }] };
    },
  },
  {
    method: "GET",
    path: "/ExportJob/jobDownloadInfo",
    handler: (context) => {
      const job = requireJob(context, context.query.jobId, "jobId");
      const { tenant } = context;
      const filename = String(job.filename);
      return {
        objects: [
          {
            filename,
            // Assumption: a non-resolvable placeholder host, DoppelDesk does not serve export files.
            link: `https://exports.doppeldesk.invalid/${tenant.sevClientId}/${String(job.jobId)}/zip/${filename}`,
            linkExpireDate: toIso(tenant.clock.now().plus({ days: LINK_LIFETIME_DAYS })),
          },
        ],
      };
    },
  },
];
