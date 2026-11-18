/** Decimal number as text: optional sign, dot or comma as decimal separator, optional exponent. */
const NUMERIC_TEXT = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/;

/**
 * Reads a number from request or stored data: a finite number or a decimal string
 * ("19", " 1.5 ", "1,5", "1e3"). Returns undefined for anything else (booleans included).
 */
export function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!NUMERIC_TEXT.test(text)) return undefined;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Reads a boolean the way sevDesk clients send it: true/false, 1/0 and their string
 * forms. Returns undefined for anything else.
 */
export function parseBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return undefined;
}
