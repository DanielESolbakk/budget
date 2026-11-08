const MAX_SAFE_MINOR_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

/** Sum guard only; input validation and overflow wording remain caller-owned. */
export function addMinorUnits(total: number, amountMinor: number, overflowMessage: string): number {
  const result = total + amountMinor;
  if (!Number.isSafeInteger(result)) throw new RangeError(overflowMessage);
  return result;
}

function safeMinorUnits(value: bigint): number | null {
  return value < -MAX_SAFE_MINOR_UNITS || value > MAX_SAFE_MINOR_UNITS ? null : Number(value);
}

/** Signed, ungrouped point-decimal core. Input policies belong to caller wrappers. */
export function parseDecimalMinorUnits(value: string): number | null {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const magnitude = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return safeMinorUnits(negative ? -magnitude : magnitude);
}

function checkedMinorUnits(value: number): bigint {
  if (!Number.isSafeInteger(value)) throw new RangeError("Minor units must be a safe integer.");
  return BigInt(value);
}

/** Public amounts stay numbers; exact arithmetic never crosses JSON/IPC boundaries. */
export function minorUnitsToDecimal(value: number): string {
  const minor = checkedMinorUnits(value);
  const magnitude = minor < 0n ? -minor : minor;
  return `${minor < 0n ? "-" : ""}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
}

/** BigInt supports internal draft totals; public numeric amounts must remain safe integers. */
export function formatMinorUnits(value: number | bigint, formatter: Intl.NumberFormat): string {
  const minor = typeof value === "bigint" ? value : checkedMinorUnits(value);
  const whole = minor / 100n;
  const fraction = String((minor < 0n ? -minor : minor) % 100n).padStart(2, "0");
  const signedWhole = whole === 0n && (minor < 0n || Object.is(value, -0)) ? -0 : whole;
  return formatter.formatToParts(signedWhole)
    .map((part) => part.type === "fraction" ? fraction : part.value)
    .join("");
}

/** Retain Number syntax and its existing tolerance; derive accepted decimal digits exactly. */
export function parseNumberMinorUnits(value: string): number | null {
  const numeric = Number(value);
  const scaled = numeric * 100;
  if (value.trim() === "" || !Number.isFinite(scaled) || numeric < 0 ||
      Math.abs(scaled - Math.round(scaled)) > 0.000001) return null;
  const decimalPattern = /^[+-]?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;
  const match = decimalPattern.exec(value.trim()) ?? decimalPattern.exec(String(numeric));
  if (match === null) return null;
  const fraction = match[2] ?? match[3] ?? "";
  const digits = `${match[1] ?? "0"}${fraction}`.replace(/^0+/, "") || "0";
  const shift = Number(match[4] ?? "0") + 2 - fraction.length;
  let magnitude: bigint;
  if (digits === "0") {
    magnitude = 0n;
  } else if (shift >= 0) {
    if (digits.length + shift > 16) return null;
    magnitude = BigInt(digits) * 10n ** BigInt(shift);
  } else if (-shift > digits.length + 6) {
    magnitude = 0n;
  } else {
    const divisor = 10n ** BigInt(-shift);
    const coefficient = BigInt(digits);
    magnitude = (coefficient + divisor / 2n) / divisor;
  }
  const result = safeMinorUnits(magnitude);
  return result === 0 && (Object.is(numeric, -0) || value.trim().startsWith("-")) ? -0 : result;
}
