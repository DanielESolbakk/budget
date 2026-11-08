import { formatMinorUnits } from "../domain/money/minorUnits.js";

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currencyCode: string, display: "symbol" | "code"): Intl.NumberFormat {
  const key = `${currencyCode}:${display}`;
  let formatter = currencyFormatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat("nb-NO", {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: display,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

export function getCurrencyFormatter(currencyCode: string): Intl.NumberFormat {
  return currencyFormatter(currencyCode, currencyCode === "NOK" ? "symbol" : "code");
}

export function formatCurrencyAmount(amountMinor: number, currencyCode: string): string {
  return formatMinorUnits(amountMinor, getCurrencyFormatter(currencyCode));
}

export function formatCurrencySymbolAmount(amountMinor: number, currencyCode: string): string {
  return formatMinorUnits(amountMinor, currencyFormatter(currencyCode, "symbol"));
}
