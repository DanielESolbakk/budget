export function parseCurrencyAmountMinor(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amountMinor = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(amountMinor) ? amountMinor : null;
}
