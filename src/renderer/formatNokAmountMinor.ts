import { formatMinorUnits } from "../domain/money/minorUnits.js";

const nokCurrencyFormatter = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatNokAmountMinor(minor: number): string {
  return formatMinorUnits(Object.is(minor, -0) ? 0 : minor, nokCurrencyFormatter);
}
