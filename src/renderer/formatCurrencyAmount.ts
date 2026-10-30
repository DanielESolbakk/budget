const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function getCurrencyFormatter(currencyCode: string): Intl.NumberFormat {
  let formatter = currencyFormatters.get(currencyCode);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat("nb-NO", {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: currencyCode === "NOK" ? "symbol" : "code",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currencyFormatters.set(currencyCode, formatter);
  }
  return formatter;
}

export function formatCurrencyAmount(amountMinor: number, currencyCode: string): string {
  return getCurrencyFormatter(currencyCode).format(amountMinor / 100);
}
