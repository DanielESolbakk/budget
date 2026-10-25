import type { CurrencyCode, ExchangeRate } from "../types.js";
import { isCurrencyCode } from "../types.js";
import { selectExchangeRate } from "./exchangeRates.js";

export interface ConvertCurrencyAmountInput {
  amountMinor: number;
  currencyCode: CurrencyCode;
  asOfDateIso: string;
  rates: readonly ExchangeRate[];
  monthlyReferenceRateId?: string;
  useLatestRateScenario?: boolean;
}

export type CurrencyConversionResult =
  | {
      state: "converted";
      nativeAmountMinor: number;
      nativeCurrencyCode: CurrencyCode;
      nokAmountMinor: number;
      exchangeRate: ExchangeRate | null;
      isEstimate: boolean;
      isScenarioRestatement: boolean;
    }
  | {
      state: "incomplete";
      nativeAmountMinor: number;
      nativeCurrencyCode: CurrencyCode;
      nokAmountMinor: null;
      exchangeRate: null;
      isEstimate: false;
      isScenarioRestatement: false;
    };

function roundForeignMinorToNokMinor(amountMinor: number, rateNokPerUnit: string): number {
  const [wholePart, fractionalPart = ""] = rateNokPerUnit.split(".");
  const denominator = 10n ** BigInt(fractionalPart.length);
  const numerator = BigInt(`${wholePart}${fractionalPart}`);
  const product = BigInt(amountMinor) * numerator;
  const sign = product < 0n ? -1n : 1n;
  const absoluteProduct = product < 0n ? -product : product;
  const rounded = ((absoluteProduct * 2n + denominator) / (denominator * 2n)) * sign;
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Converted NOK amount exceeds the safe integer range.");
  }
  return result;
}

function selectLatestRate(
  rates: readonly ExchangeRate[],
  currencyCode: CurrencyCode
): ExchangeRate | undefined {
  return rates
    .filter((rate) => rate.currencyCode === currencyCode && rate.kind === "dated")
    .sort((left, right) =>
      right.effectiveDate.localeCompare(left.effectiveDate) ||
      left.id.localeCompare(right.id)
    )[0];
}

export function convertCurrencyAmount(
  input: ConvertCurrencyAmountInput
): CurrencyConversionResult {
  if (!Number.isSafeInteger(input.amountMinor) || !isCurrencyCode(input.currencyCode)) {
    throw new Error("Currency conversion amount or currency is invalid.");
  }

  if (input.currencyCode === "NOK") {
    return {
      state: "converted",
      nativeAmountMinor: input.amountMinor,
      nativeCurrencyCode: input.currencyCode,
      nokAmountMinor: input.amountMinor,
      exchangeRate: null,
      isEstimate: false,
      isScenarioRestatement: false,
    };
  }

  const latestRate = input.useLatestRateScenario
    ? selectLatestRate(input.rates, input.currencyCode)
    : undefined;
  const selection = latestRate === undefined
    ? selectExchangeRate(
        input.rates,
        input.currencyCode,
        input.asOfDateIso,
        input.monthlyReferenceRateId
      )
    : { state: "selected" as const, rate: latestRate, isEstimate: false };

  if (selection.state === "missing") {
    return {
      state: "incomplete",
      nativeAmountMinor: input.amountMinor,
      nativeCurrencyCode: input.currencyCode,
      nokAmountMinor: null,
      exchangeRate: null,
      isEstimate: false,
      isScenarioRestatement: false,
    };
  }

  return {
    state: "converted",
    nativeAmountMinor: input.amountMinor,
    nativeCurrencyCode: input.currencyCode,
    nokAmountMinor: roundForeignMinorToNokMinor(
      input.amountMinor,
      selection.rate.rateNokPerUnit
    ),
    exchangeRate: selection.rate,
    isEstimate: selection.isEstimate,
    isScenarioRestatement: input.useLatestRateScenario === true,
  };
}
