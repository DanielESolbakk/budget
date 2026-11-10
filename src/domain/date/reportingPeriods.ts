import { isIsoCalendarDate } from "./calendarDate.js";
import {
  validateReportingPeriodRule,
  type ReportingPeriodRule,
  type WeekdayOccurrenceReportingRule,
} from "../../shared/applicationPreferences.js";

export interface ReportingPeriodRange {
  startDateIso: string;
  endDateExclusiveIso: string;
}

export type ReportingPeriodDirection = "previous" | "next";

export function resolveReportingPeriod(
  rule: ReportingPeriodRule,
  periodStartYearMonth: string,
  periodIndex: 0 | 1 = 0
): ReportingPeriodRange {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodStartYearMonth)) {
    throw new RangeError("Reporting period month must use YYYY-MM format.");
  }
  const validatedRule = validateReportingPeriodRule(rule);
  if (periodIndex !== 0 && periodIndex !== 1) {
    throw new RangeError("Reporting period index must be 0 or 1.");
  }
  if (validatedRule.type !== "two-fixed-days" && periodIndex !== 0) {
    throw new RangeError("Only two-date reporting rules have a second period in a month.");
  }

  const [yearText, monthText] = periodStartYearMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYearMonth = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;

  if (validatedRule.type === "two-fixed-days") {
    const firstDay = Math.min(validatedRule.firstDayOfMonth, daysInMonth(year, month));
    const secondDay = Math.min(validatedRule.secondDayOfMonth, daysInMonth(year, month));
    if (periodIndex === 0) {
      return {
        startDateIso: `${periodStartYearMonth}-${String(firstDay).padStart(2, "0")}`,
        endDateExclusiveIso: `${periodStartYearMonth}-${String(secondDay).padStart(2, "0")}`,
      };
    }
    return {
      startDateIso: `${periodStartYearMonth}-${String(secondDay).padStart(2, "0")}`,
      endDateExclusiveIso: `${nextYearMonth}-${String(
        Math.min(validatedRule.firstDayOfMonth, daysInMonth(nextYear, nextMonth))
      ).padStart(2, "0")}`,
    };
  }

  return {
    startDateIso: `${periodStartYearMonth}-${String(boundaryDay(validatedRule, year, month)).padStart(2, "0")}`,
    endDateExclusiveIso: `${nextYearMonth}-${String(boundaryDay(validatedRule, nextYear, nextMonth)).padStart(2, "0")}`,
  };
}

export function resolveReportingPeriodStartingOn(
  rule: ReportingPeriodRule,
  periodStartDateIso: string
): ReportingPeriodRange {
  if (!isIsoCalendarDate(periodStartDateIso)) {
    throw new RangeError("Reporting period start must be a valid calendar date.");
  }

  const yearMonth = periodStartDateIso.slice(0, 7);
  const validatedRule = validateReportingPeriodRule(rule);
  if (validatedRule.type === "two-fixed-days") {
    for (const periodIndex of [0, 1] as const) {
      const period = resolveReportingPeriod(validatedRule, yearMonth, periodIndex);
      if (period.startDateIso === periodStartDateIso) return period;
    }
  } else {
    const period = resolveReportingPeriod(validatedRule, yearMonth);
    if (period.startDateIso === periodStartDateIso) return period;
  }

  throw new RangeError("Date is not a reporting period boundary.");
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
  const validatedRule = validateReportingPeriodRule(rule);
  const currentPeriod = resolveReportingPeriodStartingOn(validatedRule, currentStartDateIso);

  if (direction !== "previous" && direction !== "next") {
    throw new RangeError("Reporting period direction must be previous or next.");
  }
  if (validatedRule.type === "two-fixed-days") {
    const currentPeriodIndex = currentPeriod.startDateIso ===
        resolveReportingPeriod(validatedRule, currentYearMonth, 0).startDateIso
      ? 0
      : 1;
    if (direction === "next" && currentPeriodIndex === 0) {
      return resolveReportingPeriod(validatedRule, currentYearMonth, 1);
    }
    if (direction === "previous" && currentPeriodIndex === 1) {
      return resolveReportingPeriod(validatedRule, currentYearMonth, 0);
    }
    const adjacentYearMonth = direction === "previous"
      ? previousYearMonth(currentYearMonth)
      : nextReportingYearMonth(currentYearMonth);
    return resolveReportingPeriod(
      validatedRule,
      adjacentYearMonth,
      direction === "next" ? 0 : 1
    );
  }

  const adjacentYearMonth = direction === "previous"
    ? previousYearMonth(currentYearMonth)
    : nextReportingYearMonth(currentYearMonth);
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
  const validatedRule = validateReportingPeriodRule(rule);
  if (validatedRule.type === "two-fixed-days") {
    const firstPeriod = resolveReportingPeriod(validatedRule, currentYearMonth, 0);
    const secondPeriod = resolveReportingPeriod(validatedRule, currentYearMonth, 1);
    if (localDateIso < firstPeriod.startDateIso) {
      return resolveReportingPeriod(validatedRule, previousYearMonth(currentYearMonth), 1);
    }
    return localDateIso < secondPeriod.startDateIso ? firstPeriod : secondPeriod;
  }
  const currentMonthPeriod = resolveReportingPeriod(validatedRule, currentYearMonth);
  return localDateIso < currentMonthPeriod.startDateIso
    ? resolveReportingPeriod(validatedRule, previousYearMonth(currentYearMonth))
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
    return lastWeekdayOfMonth(year, month, rule.weekday, lastDayOfMonth);
  }

  if (rule.type === "weekday-occurrence") {
    return weekdayOccurrenceDay(year, month, rule, lastDayOfMonth);
  }

  throw new RangeError("Unsupported reporting period rule.");
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number, lastDay: number): number {
  const lastDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}T00:00:00.000Z`;
  const sundayBasedWeekday = new Date(lastDate).getUTCDay();
  const isoWeekday = sundayBasedWeekday === 0 ? 7 : sundayBasedWeekday;
  return lastDay - ((isoWeekday - weekday + 7) % 7);
}

function weekdayOccurrenceDay(
  year: number,
  month: number,
  rule: WeekdayOccurrenceReportingRule,
  lastDay: number
): number {
  if (rule.occurrence === "last") {
    return lastWeekdayOfMonth(year, month, rule.weekday, lastDay);
  }
  const firstDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01T00:00:00.000Z`;
  const firstSundayBasedWeekday = new Date(firstDate).getUTCDay();
  const firstIsoWeekday = firstSundayBasedWeekday === 0 ? 7 : firstSundayBasedWeekday;
  return 1 + ((rule.weekday - firstIsoWeekday + 7) % 7) + (rule.occurrence - 1) * 7;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
