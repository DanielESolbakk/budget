import type { ReportingPeriodRange } from "../domain/date/reportingPeriods.js";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatReportingDate(dateIso: string): string {
  return dateFormatter.format(new Date(`${dateIso}T00:00:00.000Z`));
}

export function formatReportingPeriodRange(range: ReportingPeriodRange): string {
  const inclusiveEnd = new Date(`${range.endDateExclusiveIso}T00:00:00.000Z`);
  inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);
  return `${formatReportingDate(range.startDateIso)} - ${dateFormatter.format(inclusiveEnd)}`;
}
