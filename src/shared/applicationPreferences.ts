export interface CalendarMonthReportingRule {
  type: "calendar-month";
}

export interface FixedDayReportingRule {
  type: "fixed-day";
  dayOfMonth: number;
}

export interface LastWeekdayReportingRule {
  type: "last-weekday";
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export interface WeekdayOccurrenceReportingRule {
  type: "weekday-occurrence";
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  occurrence: 1 | 2 | 3 | 4 | "last";
}

export interface TwoFixedDaysReportingRule {
  type: "two-fixed-days";
  firstDayOfMonth: number;
  secondDayOfMonth: number;
}

export type ReportingPeriodRule =
  | CalendarMonthReportingRule
  | FixedDayReportingRule
  | LastWeekdayReportingRule
  | WeekdayOccurrenceReportingRule
  | TwoFixedDaysReportingRule;

export const DEFAULT_REPORTING_PERIOD_RULE = {
  type: "calendar-month",
} as const satisfies ReportingPeriodRule;

export function haveSameReportingPeriodRule(left: ReportingPeriodRule, right: ReportingPeriodRule): boolean {
  switch (left.type) {
    case "calendar-month":
      return right.type === left.type;
    case "fixed-day":
      return right.type === left.type && left.dayOfMonth === right.dayOfMonth;
    case "last-weekday":
      return right.type === left.type && left.weekday === right.weekday;
    case "weekday-occurrence":
      return right.type === left.type && left.weekday === right.weekday &&
        left.occurrence === right.occurrence;
    case "two-fixed-days":
      return right.type === left.type && left.firstDayOfMonth === right.firstDayOfMonth &&
        left.secondDayOfMonth === right.secondDayOfMonth;
  }
}

export function validateReportingPeriodRule(value: unknown): ReportingPeriodRule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RangeError("Reporting period preference must be an object.");
  }

  const record = value as Record<string, unknown>;
  if (record.type === "calendar-month" && Object.keys(record).length === 1) {
    return { type: "calendar-month" };
  }
  if (
    record.type === "fixed-day" &&
    Object.keys(record).length === 2 &&
    Number.isInteger(record.dayOfMonth) &&
    typeof record.dayOfMonth === "number" &&
    record.dayOfMonth >= 1 &&
    record.dayOfMonth <= 31
  ) {
    return { type: "fixed-day", dayOfMonth: record.dayOfMonth };
  }
  if (
    record.type === "last-weekday" &&
    Object.keys(record).length === 2 &&
    isIsoWeekday(record.weekday)
  ) {
    return { type: "last-weekday", weekday: record.weekday };
  }
  if (
    record.type === "weekday-occurrence" &&
    Object.keys(record).length === 3 &&
    isIsoWeekday(record.weekday) &&
    isWeekdayOccurrence(record.occurrence)
  ) {
    return {
      type: "weekday-occurrence",
      weekday: record.weekday,
      occurrence: record.occurrence,
    };
  }
  if (
    record.type === "two-fixed-days" &&
    Object.keys(record).length === 3 &&
    isMonthDay(record.firstDayOfMonth) &&
    isMonthDay(record.secondDayOfMonth) &&
    record.firstDayOfMonth < record.secondDayOfMonth &&
    Math.min(record.firstDayOfMonth, record.secondDayOfMonth) < 28
  ) {
    return {
      type: "two-fixed-days",
      firstDayOfMonth: record.firstDayOfMonth,
      secondDayOfMonth: record.secondDayOfMonth,
    };
  }

  throw new RangeError("Reporting period preference is malformed.");
}

function isIsoWeekday(value: unknown): value is LastWeekdayReportingRule["weekday"] {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
}

function isWeekdayOccurrence(
  value: unknown
): value is WeekdayOccurrenceReportingRule["occurrence"] {
  return value === "last" ||
    (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4);
}

function isMonthDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31;
}
