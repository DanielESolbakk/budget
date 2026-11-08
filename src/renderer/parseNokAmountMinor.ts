import { parseDecimalMinorUnits } from "../domain/money/minorUnits.js";

export function parseNokAmountMinor(value: string): number | null {
  const normalized = value.trim().replace(/[ \u00a0\u202f]/g, "").replace(",", ".");
  return parseDecimalMinorUnits(normalized);
}
