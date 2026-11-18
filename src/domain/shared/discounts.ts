import { toNumber } from "./money.ts";
import { isBlank, validationError } from "./validation.ts";

/**
 * A position discount is a percentage of the line amount (see computePositionSums), so it must
 * lie between 0 and 100: a larger one would turn the line negative, a negative one would raise
 * it. Assumption: 422 like the other document rules (sevDesk behavior and wording unknown).
 */
export function assertPositionDiscount(discount: unknown): void {
  if (isBlank(discount)) return;
  const percent = toNumber(discount, Number.NaN);
  if (!(percent >= 0 && percent <= 100)) {
    throw validationError("The discount of a position must be between 0 and 100 percent");
  }
}
