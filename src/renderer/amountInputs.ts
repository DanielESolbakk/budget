import { parseDecimalMinorUnits, parseNumberMinorUnits } from "../domain/money/minorUnits.js";

export function parseSignedAmountMinor(value: string): number | null {
  return parseDecimalMinorUnits(value.trim().replace(",", "."));
}

export function parseReserveMinor(value: string): number {
  const minor = parseNumberMinorUnits(value);
  if (minor === null) {
    throw new Error("Reserve must be a non-negative amount with at most two decimal places.");
  }
  return minor;
}

export function parseScenarioAmountMinor(value: string): number {
  const minor = parseNumberMinorUnits(value);
  if (minor === null || Number(value) <= 0) {
    throw new Error("Enter a positive amount with at most two decimal places.");
  }
  return minor;
}
