const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const MAX_LINES = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LINE_HEIGHT);

/**
 * Builds a minimal, valid single-page PDF (PDF 1.4, Helvetica, WinAnsi) with the given
 * text lines. Deterministic: same lines, same bytes. Characters outside Latin-1 are
 * replaced by "?"; lines beyond one page are cut off.
 */
export function renderTextPdf(lines: readonly string[]): Buffer {
  const text = lines
    .slice(0, MAX_LINES)
    .map((line, index) => `${index === 0 ? "" : "T* "}(${escapePdfText(line)}) Tj`)
    .join("\n");
  const content = `BT\n/F1 ${FONT_SIZE} Tf\n${LINE_HEIGHT} TL\n${MARGIN} ${PAGE_HEIGHT - MARGIN} Td\n${text}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  // Every character is Latin-1 at this point, so string length equals byte length.
  return Buffer.from(output, "latin1");
}

function escapePdfText(line: string): string {
  return [...line]
    .map((char) => ((char.codePointAt(0) ?? 0) > 0xff ? "?" : char))
    .join("")
    .replace(/[\\()]/g, (char) => `\\${char}`)
    .replace(/[\r\n\t]/g, " ");
}
