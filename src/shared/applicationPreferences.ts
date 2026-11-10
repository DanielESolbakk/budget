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

export type ReportingPeriodRule =
  | CalendarMonthReportingRule
  | FixedDayReportingRule
  | LastWeekdayReportingRule;

export const DEFAULT_REPORTING_PERIOD_RULE = {
  type: "calendar-month",
} as const satisfies ReportingPeriodRule;

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

  throw new RangeError("Reporting period preference is malformed.");
}

function isIsoWeekday(value: unknown): value is LastWeekdayReportingRule["weekday"] {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
}
