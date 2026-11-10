import { isIsoCalendarDate } from "./calendarDate.js";
import type { ReportingPeriodRule } from "../../shared/applicationPreferences.js";

export interface ReportingPeriodRange {
  startDateIso: string;
  endDateExclusiveIso: string;
}

export type ReportingPeriodDirection = "previous" | "next";

export function resolveReportingPeriod(
  rule: ReportingPeriodRule,
  periodStartYearMonth: string
): ReportingPeriodRange {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodStartYearMonth)) {
    throw new RangeError("Reporting period month must use YYYY-MM format.");
  }

  const [yearText, monthText] = periodStartYearMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYearMonth = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;

  return {
    startDateIso: `${periodStartYearMonth}-${String(boundaryDay(rule, year, month)).padStart(2, "0")}`,
    endDateExclusiveIso: `${nextYearMonth}-${String(boundaryDay(rule, nextYear, nextMonth)).padStart(2, "0")}`,
  };
}

export function getAdjacentReportingPeriod(
  rule: ReportingPeriodRule,
  currentStartDateIso: string,
  direction: ReportingPeriodDirection
): ReportingPeriodRange {
  if (!isIsoCalendarDate(currentStartDateIso)) {
    throw new RangeError("Current reporting period start must be a valid calendar date.");
  }

  const currentYearMonth = currentStartDateIso.slice(0, 7);
  const currentPeriod = resolveReportingPeriod(rule, currentYearMonth);
  if (currentPeriod.startDateIso !== currentStartDateIso) {
    throw new RangeError("Current date is not a reporting period boundary.");
  }

  const adjacentYearMonth = direction === "previous"
    ? previousYearMonth(currentYearMonth)
    : direction === "next"
      ? nextReportingYearMonth(currentYearMonth)
      : undefined;
  if (adjacentYearMonth === undefined) {
    throw new RangeError("Reporting period direction must be previous or next.");
  }
  return resolveReportingPeriod(rule, adjacentYearMonth);
}

export function resolveCurrentReportingPeriod(
  rule: ReportingPeriodRule,
  localDateIso: string
): ReportingPeriodRange {
  if (!isIsoCalendarDate(localDateIso)) {
    throw new RangeError("Current reporting date must be a valid calendar date.");
  }

  const currentYearMonth = localDateIso.slice(0, 7);
  const currentMonthPeriod = resolveReportingPeriod(rule, currentYearMonth);
  return localDateIso < currentMonthPeriod.startDateIso
    ? resolveReportingPeriod(rule, previousYearMonth(currentYearMonth))
    : currentMonthPeriod;
}

function previousYearMonth(yearMonth: string): string {
  const [yearText, monthText] = yearMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (month === 1) {
    if (year === 0) throw new RangeError("No previous reporting month exists before year 0000.");
    return `${String(year - 1).padStart(4, "0")}-12`;
  }
  return `${String(year).padStart(4, "0")}-${String(month - 1).padStart(2, "0")}`;
}

function nextReportingYearMonth(yearMonth: string): string {
  const [yearText, monthText] = yearMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (month === 12) {
    if (year === 9999) throw new RangeError("No next reporting month exists after year 9999.");
    return `${String(year + 1).padStart(4, "0")}-01`;
  }
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}`;
}

function boundaryDay(rule: ReportingPeriodRule, year: number, month: number): number {
  if (rule.type === "calendar-month") return 1;

  const lastDayOfMonth = daysInMonth(year, month);
  if (rule.type === "fixed-day") {
    if (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31) {
      throw new RangeError("Fixed reporting day must be between 1 and 31.");
    }
    return Math.min(rule.dayOfMonth, lastDayOfMonth);
  }

  if (rule.type === "last-weekday") {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 1 || rule.weekday > 7) {
      throw new RangeError("Reporting weekday must be between 1 and 7.");
    }
    const lastDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(lastDayOfMonth).padStart(2, "0")}T00:00:00.000Z`;
    const sundayBasedWeekday = new Date(lastDate).getUTCDay();
    const isoWeekday = sundayBasedWeekday === 0 ? 7 : sundayBasedWeekday;
    return lastDayOfMonth - ((isoWeekday - rule.weekday + 7) % 7);
  }

  throw new RangeError("Unsupported reporting period rule.");
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
