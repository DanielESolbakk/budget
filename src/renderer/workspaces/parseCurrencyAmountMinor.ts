import { parseDecimalMinorUnits } from "../../domain/money/minorUnits.js";

export function parseCurrencyAmountMinor(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  return parseDecimalMinorUnits(normalized);
}
