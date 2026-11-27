import type { MortgageScheduleRowEvidence } from "../../shared/mortgageBankEvidence.js";

type MortgageScheduleCoverageRow = Pick<
  MortgageScheduleRowEvidence,
  | "period"
  | "principalMinor"
  | "interestMinor"
  | "feeMinor"
  | "paymentMinor"
  | "projectedClosingBalanceMinor"
>;

export interface MortgageScheduleMonthlyTotals {
  readonly principalMinor: number;
  readonly interestMinor: number;
  readonly feeMinor: number;
  readonly paymentMinor: number;
  readonly yearEndBalanceMinor: number;
}

export interface MortgageScheduleYearSummary {
  readonly year: number;
  readonly annualSummaryRowIndex: number | null;
  readonly monthlyRowIndexes: readonly number[];
  readonly coveredMonths: readonly number[];
  readonly hasDuplicateMonths: boolean;
  readonly hasFullMonthlyCoverage: boolean;
  readonly yearEndRowIndex: number | null;
  readonly monthlyTotals: MortgageScheduleMonthlyTotals | null;
}

function sumMonthlyField(
  rows: readonly MortgageScheduleCoverageRow[],
  field: "principalMinor" | "interestMinor" | "feeMinor" | "paymentMinor"
): number | null {
  let total = 0;
  for (const row of rows) {
    const amount = row[field];
    if (amount === null || !Number.isSafeInteger(amount)) return null;
    total += amount;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function summarizeFirstCoveredMortgageScheduleYear(
  rows: readonly MortgageScheduleCoverageRow[]
): MortgageScheduleYearSummary | null {
  const firstCoveredYear = rows.reduce<number | undefined>((earliest, row) => {
    if (row.period.granularity === "unknown") return earliest;
    return earliest === undefined ? row.period.year : Math.min(earliest, row.period.year);
  }, undefined);
  if (firstCoveredYear === undefined) return null;

  const annualSummaryRowIndex = rows.findIndex((row) => (
    row.period.granularity === "annual" &&
    row.period.year === firstCoveredYear
  ));
  const monthlyRowIndexes = rows.flatMap((row, index) => (
    row.period.granularity === "monthly" && row.period.year === firstCoveredYear
      ? [index]
      : []
  ));
  const coveredMonths = [...new Set(monthlyRowIndexes.flatMap((index) => {
    const period = rows[index]?.period;
    return period?.granularity === "monthly" ? [period.month] : [];
  }))].sort((left, right) => left - right);
  const hasDuplicateMonths = monthlyRowIndexes.length !== coveredMonths.length;
  const hasFullMonthlyCoverage = !hasDuplicateMonths &&
    coveredMonths.length === 12 &&
    coveredMonths.every((month, index) => month === index + 1);
  const decemberRowIndex = monthlyRowIndexes.find((index) => {
    const row = rows[index];
    return row?.period.granularity === "monthly" && row.period.month === 12;
  }) ?? null;
  const yearEndRowIndex = annualSummaryRowIndex >= 0
    ? annualSummaryRowIndex
    : decemberRowIndex;

  let monthlyTotals: MortgageScheduleMonthlyTotals | null = null;
  if (hasFullMonthlyCoverage && decemberRowIndex !== null) {
    const monthlyRows = monthlyRowIndexes.map((index) => rows[index]!);
    const principalMinor = sumMonthlyField(monthlyRows, "principalMinor");
    const interestMinor = sumMonthlyField(monthlyRows, "interestMinor");
    const feeMinor = sumMonthlyField(monthlyRows, "feeMinor");
    const paymentMinor = sumMonthlyField(monthlyRows, "paymentMinor");
    const yearEndBalanceMinor = rows[decemberRowIndex]?.projectedClosingBalanceMinor ?? null;
    if (
      principalMinor !== null &&
      interestMinor !== null &&
      feeMinor !== null &&
      paymentMinor !== null &&
      yearEndBalanceMinor !== null &&
      Number.isSafeInteger(yearEndBalanceMinor)
    ) {
      monthlyTotals = {
        principalMinor,
        interestMinor,
        feeMinor,
        paymentMinor,
        yearEndBalanceMinor,
      };
    }
  }

  return {
    year: firstCoveredYear,
    annualSummaryRowIndex: annualSummaryRowIndex < 0 ? null : annualSummaryRowIndex,
    monthlyRowIndexes,
    coveredMonths,
    hasDuplicateMonths,
    hasFullMonthlyCoverage,
    yearEndRowIndex,
    monthlyTotals,
  };
}
