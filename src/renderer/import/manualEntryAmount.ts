const MAX_SAFE_MINOR_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

export function parseManualEntryAmountMinor(value: string): number | null {
  const normalized = value.trim().replace(/[ \u00a0\u202f]/g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;

  const isNegative = normalized.startsWith("-");
  const unsignedAmount = isNegative ? normalized.slice(1) : normalized;
  const [wholeUnits, fraction = ""] = unsignedAmount.split(".");
  if (wholeUnits === undefined) return null;

  const amountMinor = BigInt(wholeUnits) * 100n + BigInt(fraction.padEnd(2, "0"));
  const signedMinor = isNegative ? -amountMinor : amountMinor;

  if (signedMinor < -MAX_SAFE_MINOR_UNITS || signedMinor > MAX_SAFE_MINOR_UNITS) return null;
  return Number(signedMinor);
}
