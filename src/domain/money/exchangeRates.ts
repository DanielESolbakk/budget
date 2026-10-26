import type { CurrencyCode, ExchangeRate } from "../types.js";
import { isCurrencyCode } from "../types.js";

export type ExchangeRateSelection =
  | { state: "selected"; rate: ExchangeRate; isEstimate: boolean }
  | { state: "missing" };

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateExchangeRate(input: unknown): ExchangeRate {
  if (typeof input !== "object" || input === null) {
    throw new Error("Exchange rate must be an object.");
  }

  const record = input as Record<string, unknown>;
  const id = record.id;
  const currencyCode = typeof record.currencyCode === "string"
    ? record.currencyCode.trim().toUpperCase()
    : "";
  const rateNokPerUnit = record.rateNokPerUnit;
  const effectiveDate = record.effectiveDate;
  const kind = record.kind;
  const source = record.source;
  const provenance = record.provenance;

  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("Exchange rate id must be a non-empty string.");
  }
  if (!isCurrencyCode(currencyCode) || currencyCode === "NOK") {
    throw new Error("Exchange rate currency must be a foreign ISO currency code.");
  }
  if (
    typeof rateNokPerUnit !== "string" ||
    !/^\d+(?:\.\d{1,8})?$/.test(rateNokPerUnit) ||
    !Number.isFinite(Number(rateNokPerUnit)) ||
    Number(rateNokPerUnit) <= 0
  ) {
    throw new Error("Exchange rate must be a positive decimal NOK-per-unit quote.");
  }
  if (typeof effectiveDate !== "string" || !isIsoCalendarDate(effectiveDate)) {
    throw new Error("Exchange rate effectiveDate must be a valid YYYY-MM-DD date.");
  }
  if (kind !== "dated" && kind !== "monthly-reference") {
    throw new Error("Exchange rate kind must be dated or monthly-reference.");
  }
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error("Exchange rate source must be a non-empty string.");
  }
  if (provenance !== "manual" && provenance !== "local-file") {
    throw new Error("Exchange rate provenance must be manual or local-file.");
  }

  return {
    id: id.trim(),
    currencyCode,
    rateNokPerUnit,
    effectiveDate,
    kind,
    source: source.trim(),
    provenance,
  };
}

export function selectExchangeRate(
  rates: readonly ExchangeRate[],
  currencyCode: CurrencyCode,
  asOfDateIso: string,
  monthlyReferenceRateId?: string
): ExchangeRateSelection {
  if (!isCurrencyCode(currencyCode) || !isIsoCalendarDate(asOfDateIso)) {
    throw new Error("Exchange rate selection currency or date is invalid.");
  }

  const datedRate = rates
    .filter((rate) =>
      rate.currencyCode === currencyCode &&
      rate.kind === "dated" &&
      rate.effectiveDate <= asOfDateIso
    )
    .sort((left, right) =>
      right.effectiveDate.localeCompare(left.effectiveDate) ||
      left.id.localeCompare(right.id)
    )[0];
  if (datedRate !== undefined) {
    return { state: "selected", rate: datedRate, isEstimate: false };
  }

  if (monthlyReferenceRateId === undefined) {
    return { state: "missing" };
  }

  const monthlyRate = rates.find((rate) =>
    rate.id === monthlyReferenceRateId &&
    rate.currencyCode === currencyCode &&
    rate.kind === "monthly-reference" &&
    rate.effectiveDate.slice(0, 7) === asOfDateIso.slice(0, 7)
  );
  return monthlyRate === undefined
    ? { state: "missing" }
    : { state: "selected", rate: monthlyRate, isEstimate: true };
}
