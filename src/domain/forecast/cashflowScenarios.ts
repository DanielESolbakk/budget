import { convertCurrencyAmount } from "../money/convertCurrencyAmount.js";
import {
  isCurrencyCode,
  isYearMonth,
  type CurrencyCode,
  type ExchangeRate,
} from "../types.js";

export type CashflowScenarioAssumption =
  | {
      id: string;
      kind: "income-change";
      direction: "increase" | "reduction";
      amountMinor: number;
      currencyCode: CurrencyCode;
      startDateIso: string;
      durationMonths: number;
    }
  | {
      id: string;
      kind: "recurring-expense";
      amountMinor: number;
      currencyCode: CurrencyCode;
      startDateIso: string;
      durationMonths: number;
    }
  | {
      id: string;
      kind: "one-time-expense";
      amountMinor: number;
      currencyCode: CurrencyCode;
      occurrenceDateIso: string;
    };

export interface CashflowScenarioRequest {
  assumptions: CashflowScenarioAssumption[];
  useLatestRateScenario: boolean;
}

export interface CashflowScenarioIncompleteReason {
  code:
    | "baseline-currency-history-incomplete"
    | "forecast-horizon-not-current"
    | "no-accounts-selected"
    | "unknown-account"
    | "missing-balance"
    | "stale-balance"
    | "unverified-balance"
    | "missing-exchange-rate"
    | "unknown-variable-commitment"
    | "missing-reconciled-transaction"
    | "invalid-reconciled-transaction";
  message: string;
  assumptionId?: string;
  currencyCode?: CurrencyCode;
  dateIso?: string;
}

export interface CashflowScenarioCalculationInput {
  evaluatedAtIso: string;
  startingCashNokMinor: number;
  baselineMonthlyCashflows: readonly {
    yearMonth: string;
    netCashflowNokMinor: number;
  }[];
  baselineCashEvents: readonly {
    id: string;
    dateIso: string;
    description: string;
    amountNokMinor: number;
  }[];
  assumptions: readonly CashflowScenarioAssumption[];
  rates: readonly ExchangeRate[];
  useLatestRateScenario: boolean;
  baselineIncompleteReasons?: readonly CashflowScenarioIncompleteReason[];
}

export interface CashflowScenarioPlan {
  startingCashNokMinor: number;
  monthlyCashflows: Array<{
    yearMonth: string;
    netCashflowNokMinor: number;
    endingCashNokMinor: number;
  }>;
  projectedCashPath: Array<{
    dateIso: string;
    description: string;
    amountNokMinor: number;
    projectedCashNokMinor: number;
  }>;
  minimumProjectedCashNokMinor: number;
}

export interface CashflowScenarioAppliedAssumption {
  id: string;
  kind: CashflowScenarioAssumption["kind"];
  dateIso: string;
  nativeAmountMinor: number;
  currencyCode: CurrencyCode;
  amountNokMinor: number | null;
  exchangeRate: ExchangeRate | null;
  isEstimate: boolean;
  isScenarioRestatement: boolean;
}

export interface CashflowScenarioMonthComparison {
  yearMonth: string;
  baselineCashflowNokMinor: number;
  scenarioCashflowNokMinor: number;
  differenceNokMinor: number;
  baselineEndingCashNokMinor: number;
  scenarioEndingCashNokMinor: number;
}

export type CashflowScenarioResult =
  | {
      state: "complete";
      evaluatedAtIso: string;
      baseline: CashflowScenarioPlan;
      scenario: CashflowScenarioPlan;
      months: CashflowScenarioMonthComparison[];
      minimumDifferenceNokMinor: number;
      appliedAssumptions: CashflowScenarioAppliedAssumption[];
      useLatestRateScenario: boolean;
    }
  | {
      state: "incomplete";
      evaluatedAtIso: string;
      baseline: CashflowScenarioPlan | null;
      scenario: null;
      months: [];
      minimumDifferenceNokMinor: null;
      appliedAssumptions: CashflowScenarioAppliedAssumption[];
      incompleteReasons: CashflowScenarioIncompleteReason[];
      useLatestRateScenario: boolean;
    };

interface CashAdjustment {
  id: string;
  dateIso: string;
  description: string;
  amountNokMinor: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    isCalendarDate(value.slice(0, 10)) &&
    value.includes("T") &&
    !Number.isNaN(Date.parse(value));
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function requirePositiveSafeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive safe integer.`);
  }
  return value;
}

function requireScenarioDate(value: unknown, fieldName: string): string {
  if (!isCalendarDate(value)) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

export function validateCashflowScenarioRequest(input: unknown): CashflowScenarioRequest {
  if (!isRecord(input)) {
    throw new Error("Cashflow scenario request must be an object.");
  }
  if (!Array.isArray(input.assumptions) || input.assumptions.length > 20) {
    throw new Error("assumptions must be an array with no more than 20 entries.");
  }
  if (typeof input.useLatestRateScenario !== "boolean") {
    throw new Error("useLatestRateScenario must be a boolean.");
  }

  const ids = new Set<string>();
  const assumptions = input.assumptions.map((value, index): CashflowScenarioAssumption => {
    if (!isRecord(value)) {
      throw new Error(`assumptions[${index}] must be an object.`);
    }
    const id = requireNonEmptyString(value.id, `assumptions[${index}].id`);
    if (ids.has(id)) {
      throw new Error(`Scenario assumption id must be unique: ${id}`);
    }
    ids.add(id);
    const amountMinor = requirePositiveSafeInteger(
      value.amountMinor,
      `assumptions[${index}].amountMinor`
    );
    const currencyCode = requireNonEmptyString(
      value.currencyCode,
      `assumptions[${index}].currencyCode`
    ).toUpperCase();
    if (!isCurrencyCode(currencyCode)) {
      throw new Error(`assumptions[${index}].currencyCode must be a three-letter code.`);
    }

    if (value.kind === "income-change") {
      if (value.direction !== "increase" && value.direction !== "reduction") {
        throw new Error(`assumptions[${index}].direction is invalid.`);
      }
      const durationMonths = value.durationMonths;
      if (
        typeof durationMonths !== "number" ||
        !Number.isSafeInteger(durationMonths) ||
        durationMonths < 1 ||
        durationMonths > 3
      ) {
        throw new Error(`assumptions[${index}].durationMonths must be between 1 and 3.`);
      }
      return {
        id,
        kind: value.kind,
        direction: value.direction,
        amountMinor,
        currencyCode,
        startDateIso: requireScenarioDate(
          value.startDateIso,
          `assumptions[${index}].startDateIso`
        ),
        durationMonths,
      };
    }

    if (value.kind === "recurring-expense") {
      const durationMonths = value.durationMonths;
      if (
        typeof durationMonths !== "number" ||
        !Number.isSafeInteger(durationMonths) ||
        durationMonths < 1 ||
        durationMonths > 3
      ) {
        throw new Error(`assumptions[${index}].durationMonths must be between 1 and 3.`);
      }
      return {
        id,
        kind: value.kind,
        amountMinor,
        currencyCode,
        startDateIso: requireScenarioDate(
          value.startDateIso,
          `assumptions[${index}].startDateIso`
        ),
        durationMonths,
      };
    }

    if (value.kind === "one-time-expense") {
      return {
        id,
        kind: value.kind,
        amountMinor,
        currencyCode,
        occurrenceDateIso: requireScenarioDate(
          value.occurrenceDateIso,
          `assumptions[${index}].occurrenceDateIso`
        ),
      };
    }
    throw new Error(`assumptions[${index}].kind is invalid.`);
  });

  return { assumptions, useLatestRateScenario: input.useLatestRateScenario };
}

function addMinorUnits(total: number, amountMinor: number): number {
  const result = total + amountMinor;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Cashflow scenario exceeds the safe integer range.");
  }
  return result;
}

function addOneMonth(yearMonth: string): string {
  const [yearText, monthText] = yearMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function monthEndDate(yearMonth: string): string {
  const [yearText, monthText] = yearMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yearMonth}-${String(day).padStart(2, "0")}`;
}

function addMonthsPreservingDay(dateIso: string, offset: number): string {
  let yearMonth = dateIso.slice(0, 7);
  for (let month = 0; month < offset; month += 1) {
    yearMonth = addOneMonth(yearMonth);
  }
  const day = Number(dateIso.slice(8, 10));
  const finalDay = new Date(
    Date.UTC(Number(yearMonth.slice(0, 4)), Number(yearMonth.slice(5, 7)), 0)
  ).getUTCDate();
  return `${yearMonth}-${String(Math.min(day, finalDay)).padStart(2, "0")}`;
}

function sumAmounts(values: readonly number[]): number {
  return values.reduce((total, value) => addMinorUnits(total, value), 0);
}

function compareIncompleteReasons(
  left: CashflowScenarioIncompleteReason,
  right: CashflowScenarioIncompleteReason
): number {
  return left.code.localeCompare(right.code) ||
    (left.dateIso ?? "").localeCompare(right.dateIso ?? "") ||
    (left.assumptionId ?? "").localeCompare(right.assumptionId ?? "") ||
    (left.currencyCode ?? "").localeCompare(right.currencyCode ?? "") ||
    left.message.localeCompare(right.message);
}

function createIncompleteResult(
  input: CashflowScenarioCalculationInput,
  reasons: readonly CashflowScenarioIncompleteReason[],
  baseline: CashflowScenarioPlan | null = null,
  appliedAssumptions: CashflowScenarioAppliedAssumption[] = []
): CashflowScenarioResult {
  return {
    state: "incomplete",
    evaluatedAtIso: input.evaluatedAtIso,
    baseline,
    scenario: null,
    months: [],
    minimumDifferenceNokMinor: null,
    appliedAssumptions,
    incompleteReasons: [...reasons].sort(compareIncompleteReasons),
    useLatestRateScenario: input.useLatestRateScenario,
  };
}

function compareAdjustments(left: CashAdjustment, right: CashAdjustment): number {
  return left.dateIso.localeCompare(right.dateIso) ||
    left.id.localeCompare(right.id) ||
    left.description.localeCompare(right.description) ||
    left.amountNokMinor - right.amountNokMinor;
}

function buildPlan(
  startingCashNokMinor: number,
  evaluatedAtDateIso: string,
  baselineMonthlyCashflows: readonly { yearMonth: string; netCashflowNokMinor: number }[],
  baselineCashEvents: readonly CashAdjustment[],
  scenarioCashEvents: readonly CashAdjustment[] = []
): CashflowScenarioPlan {
  const forecastEvents = baselineMonthlyCashflows.map(({ yearMonth, netCashflowNokMinor }) => ({
    id: `forecast-${yearMonth}`,
    dateIso: monthEndDate(yearMonth),
    description: "Forecast monthly net cashflow",
    amountNokMinor: netCashflowNokMinor,
  }));
  const allAdjustments = [
    ...baselineCashEvents,
    ...forecastEvents,
    ...scenarioCashEvents,
  ].filter((event) => event.dateIso >= evaluatedAtDateIso).sort(compareAdjustments);
  const groupedByDate = new Map<string, CashAdjustment[]>();
  for (const event of allAdjustments) {
    const events = groupedByDate.get(event.dateIso) ?? [];
    events.push(event);
    groupedByDate.set(event.dateIso, events);
  }

  let projectedCashNokMinor = startingCashNokMinor;
  const projectedCashPath: CashflowScenarioPlan["projectedCashPath"] = [{
    dateIso: evaluatedAtDateIso,
    description: "Starting cash",
    amountNokMinor: 0,
    projectedCashNokMinor,
  }];
  for (const [dateIso, events] of [...groupedByDate.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const amountNokMinor = sumAmounts(events.map((event) => event.amountNokMinor));
    projectedCashNokMinor = addMinorUnits(projectedCashNokMinor, amountNokMinor);
    projectedCashPath.push({
      dateIso,
      description: events.map((event) => event.description).sort().join("; "),
      amountNokMinor,
      projectedCashNokMinor,
    });
  }

  const monthlyCashflows = baselineMonthlyCashflows.map(({ yearMonth, netCashflowNokMinor }) => {
    const eventAmounts = [...baselineCashEvents, ...scenarioCashEvents]
      .filter((event) => event.dateIso.slice(0, 7) === yearMonth)
      .map((event) => event.amountNokMinor);
    const netCashflow = addMinorUnits(netCashflowNokMinor, sumAmounts(eventAmounts));
    const monthEnd = monthEndDate(yearMonth);
    const endingCashNokMinor = projectedCashPath
      .filter((point) => point.dateIso <= monthEnd)
      .at(-1)?.projectedCashNokMinor ?? startingCashNokMinor;
    return { yearMonth, netCashflowNokMinor: netCashflow, endingCashNokMinor };
  });

  return {
    startingCashNokMinor,
    monthlyCashflows,
    projectedCashPath,
    minimumProjectedCashNokMinor: Math.min(
      ...projectedCashPath.map((point) => point.projectedCashNokMinor)
    ),
  };
}

function scenarioAssumptionDates(
  assumption: CashflowScenarioAssumption,
  horizonMonths: ReadonlySet<string>
): string[] {
  if (assumption.kind === "one-time-expense") {
    if (!horizonMonths.has(assumption.occurrenceDateIso.slice(0, 7))) {
      throw new Error(`Scenario assumption ${assumption.id} is outside the forecast horizon.`);
    }
    return [assumption.occurrenceDateIso];
  }
  if (!horizonMonths.has(assumption.startDateIso.slice(0, 7))) {
    throw new Error(`Scenario assumption ${assumption.id} is outside the forecast horizon.`);
  }
  const dates: string[] = [];
  for (let offset = 0; offset < assumption.durationMonths; offset += 1) {
    const dateIso = addMonthsPreservingDay(assumption.startDateIso, offset);
    if (horizonMonths.has(dateIso.slice(0, 7))) dates.push(dateIso);
  }
  return dates;
}

export function calculateCashflowScenario(
  input: CashflowScenarioCalculationInput
): CashflowScenarioResult {
  const request = validateCashflowScenarioRequest({
    assumptions: [...input.assumptions],
    useLatestRateScenario: input.useLatestRateScenario,
  });
  if (
    !isIsoTimestamp(input.evaluatedAtIso) ||
    !Number.isSafeInteger(input.startingCashNokMinor) ||
    input.baselineMonthlyCashflows.length !== 3 ||
    input.baselineMonthlyCashflows.some(({ yearMonth, netCashflowNokMinor }) =>
      !isYearMonth(yearMonth) || !Number.isSafeInteger(netCashflowNokMinor)
    )
  ) {
    throw new Error("Cashflow scenario baseline is invalid.");
  }

  const baselineMonthlyCashflows = [...input.baselineMonthlyCashflows].sort((left, right) =>
    left.yearMonth.localeCompare(right.yearMonth)
  );
  const firstYearMonth = baselineMonthlyCashflows[0]!.yearMonth;
  if (
    baselineMonthlyCashflows.some((month, index) =>
      index > 0 &&
      month.yearMonth !== addOneMonth(baselineMonthlyCashflows[index - 1]!.yearMonth)
    )
  ) {
    throw new Error("Cashflow scenario forecast months must be consecutive.");
  }

  for (const event of input.baselineCashEvents) {
    if (
      event.id.trim().length === 0 ||
      event.description.trim().length === 0 ||
      !isCalendarDate(event.dateIso) ||
      !Number.isSafeInteger(event.amountNokMinor) ||
      event.dateIso <= input.evaluatedAtIso.slice(0, 10)
    ) {
      throw new Error("Cashflow scenario baseline cash event is invalid.");
    }
  }

  const baselineIncompleteReasons = input.baselineIncompleteReasons ?? [];
  if (baselineIncompleteReasons.length > 0) {
    return createIncompleteResult(input, baselineIncompleteReasons);
  }

  if (firstYearMonth < input.evaluatedAtIso.slice(0, 7)) {
    return createIncompleteResult(input, [{
      code: "forecast-horizon-not-current",
      message: "The baseline forecast does not cover the current or a future month.",
    }]);
  }

  const baselinePlan = buildPlan(
    input.startingCashNokMinor,
    input.evaluatedAtIso.slice(0, 10),
    baselineMonthlyCashflows,
    input.baselineCashEvents
  );
  const horizonMonths = new Set(baselineMonthlyCashflows.map(({ yearMonth }) => yearMonth));
  const scenarioCashEvents: CashAdjustment[] = [];
  const appliedAssumptions: CashflowScenarioAppliedAssumption[] = [];
  const incompleteReasons: CashflowScenarioIncompleteReason[] = [];

  for (const assumption of request.assumptions.slice().sort((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    for (const dateIso of scenarioAssumptionDates(assumption, horizonMonths)) {
      const conversion = convertCurrencyAmount({
        amountMinor: assumption.amountMinor,
        currencyCode: assumption.currencyCode,
        asOfDateIso: dateIso,
        rates: input.rates,
        useLatestRateScenario: request.useLatestRateScenario,
      });
      if (conversion.state === "incomplete") {
        appliedAssumptions.push({
          id: assumption.id,
          kind: assumption.kind,
          dateIso,
          nativeAmountMinor: assumption.amountMinor,
          currencyCode: assumption.currencyCode,
          amountNokMinor: null,
          exchangeRate: null,
          isEstimate: false,
          isScenarioRestatement: false,
        });
        incompleteReasons.push({
          code: "missing-exchange-rate",
          message: `No local exchange rate is available for ${assumption.currencyCode} on ${dateIso}.`,
          assumptionId: assumption.id,
          currencyCode: assumption.currencyCode,
          dateIso,
        });
        continue;
      }

      const direction = assumption.kind === "income-change"
        ? assumption.direction === "increase" ? 1 : -1
        : -1;
      const amountNokMinor = conversion.nokAmountMinor * direction;
      appliedAssumptions.push({
        id: assumption.id,
        kind: assumption.kind,
        dateIso,
        nativeAmountMinor: assumption.amountMinor,
        currencyCode: assumption.currencyCode,
        amountNokMinor,
        exchangeRate: conversion.exchangeRate,
        isEstimate: conversion.isEstimate,
        isScenarioRestatement: conversion.isScenarioRestatement,
      });
      scenarioCashEvents.push({
        id: `${assumption.id}/${dateIso}`,
        dateIso,
        description: `Scenario ${assumption.kind}`,
        amountNokMinor,
      });
    }
  }

  appliedAssumptions.sort((left, right) =>
    left.dateIso.localeCompare(right.dateIso) ||
    left.id.localeCompare(right.id)
  );
  if (incompleteReasons.length > 0) {
    return createIncompleteResult(
      input,
      incompleteReasons,
      baselinePlan,
      appliedAssumptions
    );
  }

  const scenarioPlan = buildPlan(
    input.startingCashNokMinor,
    input.evaluatedAtIso.slice(0, 10),
    baselineMonthlyCashflows,
    input.baselineCashEvents,
    scenarioCashEvents
  );
  const months = baselinePlan.monthlyCashflows.map((baselineMonth, index) => {
    const scenarioMonth = scenarioPlan.monthlyCashflows[index]!;
    return {
      yearMonth: baselineMonth.yearMonth,
      baselineCashflowNokMinor: baselineMonth.netCashflowNokMinor,
      scenarioCashflowNokMinor: scenarioMonth.netCashflowNokMinor,
      differenceNokMinor: addMinorUnits(
        scenarioMonth.netCashflowNokMinor,
        -baselineMonth.netCashflowNokMinor
      ),
      baselineEndingCashNokMinor: baselineMonth.endingCashNokMinor,
      scenarioEndingCashNokMinor: scenarioMonth.endingCashNokMinor,
    };
  });

  return {
    state: "complete",
    evaluatedAtIso: input.evaluatedAtIso,
    baseline: baselinePlan,
    scenario: scenarioPlan,
    months,
    minimumDifferenceNokMinor: addMinorUnits(
      scenarioPlan.minimumProjectedCashNokMinor,
      -baselinePlan.minimumProjectedCashNokMinor
    ),
    appliedAssumptions,
    useLatestRateScenario: request.useLatestRateScenario,
  };
}
