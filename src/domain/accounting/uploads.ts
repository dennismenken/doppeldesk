import { createHash } from "node:crypto";
import { extname } from "node:path";
import type { RouteContext, RouteDefinition } from "../../routes/types.ts";
import { missingParameters } from "../shared/validation.ts";

/** One part of a multipart/form-data body. */
interface UploadedFile {
  /** Raw header block of the part. */
  headers: string;
  /** Original filename. */
  name: string | undefined;
  contentType: string | undefined;
  content: Buffer;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".xml": "application/xml",
};

/** Multipart boundary from a content-type header ("multipart/form-data; boundary=..."). */
function boundaryOf(contentType: string | undefined): string | undefined {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? "");
  return match?.[1] ?? match?.[2];
}

/**
 * Reads the part named "file" (or the first part) of a multipart body. The delimiter comes
 * from the content-type boundary; without one, the first line of the body is used.
 */
export function parseMultipartFile(body: Buffer, contentType: string | undefined): UploadedFile | undefined {
  const boundary = boundaryOf(contentType);
  const delimiter = Buffer.from(boundary === undefined ? firstLine(body) : `--${boundary}`, "latin1");
  if (delimiter.length <= 2) return undefined;
  const parts = splitParts(body, delimiter);
  return parts.find((part) => /name="file"/i.test(part.headers)) ?? parts[0];
}

function firstLine(body: Buffer): string {
  const end = body.indexOf("\r\n");
  return end > 2 && body.toString("latin1", 0, 2) === "--" ? body.toString("latin1", 0, end) : "";
}

/** Raw parts between the delimiters, each with its header block and content. */
function splitParts(body: Buffer, delimiter: Buffer): UploadedFile[] {
  const parts: UploadedFile[] = [];
  let start = body.indexOf(delimiter);
  while (start >= 0) {
    const headerStart = start + delimiter.length + 2;
    const next = body.indexOf(Buffer.concat([Buffer.from("\r\n"), delimiter]), headerStart);
    const headerEnd = body.indexOf("\r\n\r\n", headerStart);
    if (headerEnd < 0 || (next >= 0 && headerEnd > next)) break;
    const headers = body.toString("latin1", headerStart, headerEnd);
    parts.push({
      headers,
      name: /filename="([^"]*)"/i.exec(headers)?.[1],
      contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim(),
      content: body.subarray(headerEnd + 4, next < 0 ? body.length : next),
    });
    start = next < 0 ? -1 : next + 2;
  }
  return parts;
}

/**
 * POST /Voucher/Factory/uploadTempFile. The sevDesk-internal filename is a hash of the
 * content plus the original extension, so the same file always gets the same name.
 * Assumption: pages is 1 and the preview list "content" is empty.
 */
function uploadTempFile(context: RouteContext) {
  const { body, headers } = context;
  const file = Buffer.isBuffer(body) ? parseMultipartFile(body, headers["content-type"]) : undefined;
  if (file === undefined) throw missingParameters(["file"]);
  const extension = (file.name === undefined ? "" : extname(file.name)).toLowerCase() || ".pdf";
  return {
    pages: 1,
    mimeType: "image/jpg",
    originMimeType: file.contentType ?? MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
    filename: `${createHash("md5").update(file.content).digest("hex")}${extension}`,
    contentHash: createHash("sha256").update(file.content).digest("hex"),
    content: [],
  };
}

export const uploadRoutes: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/Voucher/Factory/uploadTempFile",
    handler: (context) => ({ objects: uploadTempFile(context) }),
  },
];
