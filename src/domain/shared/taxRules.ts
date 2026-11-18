import type { PlainObject } from "../../lib/object.ts";
import { toNumber } from "./money.ts";
import { refId } from "./refs.ts";
import { validationError } from "./validation.ts";

/**
 * Allowed position tax rates per tax rule (sevdesk-Update 2.0, spec info.description).
 * Rules 18 to 20 (OSS) depend on the destination country and are not checked.
 */
export const TAX_RATES_BY_RULE: Readonly<Record<string, readonly number[]>> = {
  "1": [0, 7, 19],
  "2": [0],
  "3": [0, 7, 19],
  "4": [0],
  "5": [0],
  "11": [0],
  "17": [0],
  "21": [0],
};

/**
 * Update 2.0: the tax rate of each position must fit the document's tax rule, otherwise
 * HTTP 422 (spec info.description). Documents without taxRule (1.0 taxType) are not checked.
 * Assumption: the message text.
 */
export function assertTaxRates(header: PlainObject, positions: readonly PlainObject[]): void {
  const ruleId = refId(header.taxRule);
  const allowed = ruleId === undefined ? undefined : TAX_RATES_BY_RULE[ruleId];
  if (allowed === undefined) return;
  for (const position of positions) {
    const rate = toNumber(position.taxRate);
    if (!allowed.includes(rate))
      throw validationError(`Tax rate ${rate} is not allowed for tax rule ${ruleId}`);
  }
}
