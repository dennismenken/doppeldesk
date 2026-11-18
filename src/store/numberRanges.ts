/**
 * Per-tenant number range counters (e.g. invoice numbers). Stores the last issued
 * number per key; formatting (prefixes) lives in src/domain/shared/numbering.ts.
 */
export class NumberRanges {
  #last = new Map<string, number>();
  readonly #onChange: () => void;

  constructor(onChange: () => void) {
    this.#onChange = onChange;
  }

  /** Issues the next number of a range; the first number is "start". */
  next(key: string, start: number): number {
    const last = this.#last.get(key);
    const value = last === undefined ? start : last + 1;
    this.#last.set(key, value);
    this.#onChange();
    return value;
  }

  /** Last issued number of a range, if any. */
  last(key: string): number | undefined {
    return this.#last.get(key);
  }

  /**
   * Gives a number back: when it is the last issued one, the counter rolls back by one
   * (live-verified for credit notes after deleting a numbered draft). Returns whether it rolled back.
   */
  release(key: string, value: number, start: number): boolean {
    if (this.#last.get(key) !== value) return false;
    if (value <= start) this.#last.delete(key);
    else this.#last.set(key, value - 1);
    this.#onChange();
    return true;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.#last);
  }

  restore(snapshot: Record<string, number>): void {
    this.#last = new Map(Object.entries(snapshot));
  }
}
