import React from "react";
import {
  getAdjacentReportingPeriod,
  resolveCurrentReportingPeriod,
} from "../../domain/date/reportingPeriods.js";
import {
  validateReportingPeriodRule,
  type LastWeekdayReportingRule,
  type ReportingPeriodRule,
  type WeekdayOccurrenceReportingRule,
} from "../../shared/applicationPreferences.js";
import { toLocalIsoDate } from "../../domain/date/localDateDefaults.js";
import { formatReportingDate, formatReportingPeriodRange } from "../reportingPeriodDisplay.js";

const reportingPeriodOptions = [
  { value: "calendar-month", label: "Calendar month" },
  { value: "fixed-day", label: "Payday on a fixed day" },
  { value: "weekday-occurrence", label: "Payday on a weekday occurrence" },
  { value: "two-fixed-days", label: "Two dates each month" },
] as const;

const weekdays: Array<{ value: LastWeekdayReportingRule["weekday"]; label: string }> = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ReportingPeriodSettingsSection({
  onSaved,
}: {
  onSaved: (rule: ReportingPeriodRule) => void;
}): React.JSX.Element {
  const [reportingPeriodType, setReportingPeriodType] =
    React.useState<ReportingPeriodRule["type"]>("calendar-month");
  const [dayOfMonth, setDayOfMonth] = React.useState("25");
  const [firstDayOfMonth, setFirstDayOfMonth] = React.useState("15");
  const [secondDayOfMonth, setSecondDayOfMonth] = React.useState("31");
  const [weekday, setWeekday] = React.useState<LastWeekdayReportingRule["weekday"]>(4);
  const [occurrence, setOccurrence] =
    React.useState<WeekdayOccurrenceReportingRule["occurrence"]>("last");
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  const loadPreference = React.useCallback((): void => {
    setIsLoading(true);
    setError(null);
    setLoadError(null);
    setStatusMessage(null);
    window.budgetApi.reportingPreferences.getPeriodRule()
      .then((rule) => {
        const validatedRule = validateReportingPeriodRule(rule);
        setReportingPeriodType(validatedRule.type === "last-weekday"
          ? "weekday-occurrence"
          : validatedRule.type);
        if (validatedRule.type === "fixed-day") {
          setDayOfMonth(String(validatedRule.dayOfMonth));
        }
        if (validatedRule.type === "last-weekday") {
          setWeekday(validatedRule.weekday);
          setOccurrence("last");
        }
        if (validatedRule.type === "weekday-occurrence") {
          setWeekday(validatedRule.weekday);
          setOccurrence(validatedRule.occurrence);
        }
        if (validatedRule.type === "two-fixed-days") {
          setFirstDayOfMonth(String(validatedRule.firstDayOfMonth));
          setSecondDayOfMonth(String(validatedRule.secondDayOfMonth));
        }
      })
      .catch((loadError: unknown) => {
        setLoadError(messageFromError(loadError, "Unable to load reporting preferences."));
      })
      .finally(() => setIsLoading(false));
  }, []);

  React.useEffect(() => {
    loadPreference();
  }, [loadPreference]);

  const draftRule = React.useMemo((): ReportingPeriodRule | null => {
    if (reportingPeriodType === "calendar-month") {
      return { type: "calendar-month" };
    }
    if (reportingPeriodType === "fixed-day") {
      const parsedDay = Number(dayOfMonth);
      if (dayOfMonth.trim() === "" || !Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) {
        return null;
      }
      return { type: "fixed-day", dayOfMonth: parsedDay };
    }
    if (reportingPeriodType === "weekday-occurrence") {
      return { type: "weekday-occurrence", weekday, occurrence };
    }
    if (reportingPeriodType === "two-fixed-days") {
      const firstDay = Number(firstDayOfMonth);
      const secondDay = Number(secondDayOfMonth);
      if (
        firstDayOfMonth.trim() === "" ||
        secondDayOfMonth.trim() === "" ||
        !Number.isInteger(firstDay) ||
        !Number.isInteger(secondDay) ||
        firstDay < 1 ||
        firstDay > 27 ||
        secondDay <= firstDay ||
        secondDay > 31
      ) {
        return null;
      }
      return {
        type: "two-fixed-days",
        firstDayOfMonth: firstDay,
        secondDayOfMonth: secondDay,
      };
    }
    return null;
  }, [
    reportingPeriodType,
    dayOfMonth,
    firstDayOfMonth,
    secondDayOfMonth,
    weekday,
    occurrence,
  ]);

  async function savePreference(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setStatusMessage(null);
    if (draftRule === null) {
      setError("Enter a day of the month from 1 through 31.");
      return;
    }
    setIsSaving(true);
    try {
      const savedRule = await window.budgetApi.reportingPreferences.savePeriodRule(draftRule);
      const validatedRule = validateReportingPeriodRule(savedRule);
      setReportingPeriodType(validatedRule.type);
      if (validatedRule.type === "fixed-day") setDayOfMonth(String(validatedRule.dayOfMonth));
      if (validatedRule.type === "last-weekday") setWeekday(validatedRule.weekday);
      if (validatedRule.type === "weekday-occurrence") {
        setWeekday(validatedRule.weekday);
        setOccurrence(validatedRule.occurrence);
      }
      if (validatedRule.type === "two-fixed-days") {
        setFirstDayOfMonth(String(validatedRule.firstDayOfMonth));
        setSecondDayOfMonth(String(validatedRule.secondDayOfMonth));
      }
      setStatusMessage("Reporting period saved.");
      onSaved(validatedRule);
    } catch (saveError: unknown) {
      setError(messageFromError(saveError, "Unable to save reporting preferences. Your draft is unchanged."));
    } finally {
      setIsSaving(false);
    }
  }

  const localDateIso = toLocalIsoDate(new Date());
  const preview = React.useMemo(
    () => {
      if (draftRule === null) return null;
      const current = resolveCurrentReportingPeriod(draftRule, localDateIso);
      return {
        current,
        next: getAdjacentReportingPeriod(draftRule, current.startDateIso, "next"),
      };
    },
    [draftRule, localDateIso]
  );

  if (isLoading) {
    return (
      <section className="reporting-preferences-section" aria-labelledby="reporting-period-heading">
        <h3 id="reporting-period-heading">Reporting period</h3>
        <p role="status">Loading reporting preferences...</p>
      </section>
    );
  }

  if (loadError !== null) {
    return (
      <section className="reporting-preferences-section" aria-labelledby="reporting-period-heading">
        <h3 id="reporting-period-heading">Reporting period</h3>
        <p className="reporting-preference-message is-error" role="alert">
          Could not load the saved reporting preference. {loadError}
        </p>
        <button type="button" className="action-secondary" onClick={loadPreference}>
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className="reporting-preferences-section" aria-labelledby="reporting-period-heading">
      <div className="reporting-preferences-heading">
        <div>
          <h3 id="reporting-period-heading">Reporting period</h3>
          <p>Choose the date range used for your household spending overview.</p>
        </div>
      </div>
      <form className="reporting-preferences-form" onSubmit={(event) => void savePreference(event)}>
        <label>
          Reporting period
          <select
            value={reportingPeriodType}
            disabled={isSaving}
            onChange={(event) => {
              const nextType = reportingPeriodOptions.find(
                (option) => option.value === event.currentTarget.value
              )?.value;
              if (nextType !== undefined) {
                setReportingPeriodType(nextType);
                setError(null);
                setStatusMessage(null);
              }
            }}
          >
            {reportingPeriodOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {reportingPeriodType === "fixed-day" && (
          <label>
            Day of month
            <input
              type="number"
              min="1"
              max="31"
              step="1"
              required
              disabled={isSaving}
              value={dayOfMonth}
              onChange={(event) => {
                setDayOfMonth(event.currentTarget.value);
                setError(null);
                setStatusMessage(null);
              }}
            />
          </label>
        )}
        {reportingPeriodType === "weekday-occurrence" && (
          <label>
            Occurrence
            <select
              value={occurrence}
              disabled={isSaving}
              onChange={(event) => {
                const nextOccurrence = event.currentTarget.value === "last"
                  ? "last"
                  : Number(event.currentTarget.value);
                if (
                  nextOccurrence === "last" ||
                  (Number.isInteger(nextOccurrence) && nextOccurrence >= 1 && nextOccurrence <= 4)
                ) {
                  setOccurrence(nextOccurrence as WeekdayOccurrenceReportingRule["occurrence"]);
                  setError(null);
                  setStatusMessage(null);
                }
              }}
            >
              <option value="1">First</option>
              <option value="2">Second</option>
              <option value="3">Third</option>
              <option value="4">Fourth</option>
              <option value="last">Last</option>
            </select>
          </label>
        )}
        {reportingPeriodType === "weekday-occurrence" && (
          <label>
            Weekday
            <select
              value={weekday}
              disabled={isSaving}
              onChange={(event) => {
                const nextWeekday = weekdays.find(
                  (option) => String(option.value) === event.currentTarget.value
                );
                if (nextWeekday !== undefined) {
                  setWeekday(nextWeekday.value);
                  setError(null);
                  setStatusMessage(null);
                }
              }}
            >
              {weekdays.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        )}
        {reportingPeriodType === "two-fixed-days" && (
          <>
            <label>
              Earlier date
              <input
                type="number"
                min="1"
                max="27"
                step="1"
                required
                disabled={isSaving}
                value={firstDayOfMonth}
                onChange={(event) => {
                  setFirstDayOfMonth(event.currentTarget.value);
                  setError(null);
                  setStatusMessage(null);
                }}
              />
            </label>
            <label>
              Later date
              <input
                type="number"
                min={String(Math.min(Number(firstDayOfMonth) + 1, 31))}
                max="31"
                step="1"
                required
                disabled={isSaving}
                value={secondDayOfMonth}
                onChange={(event) => {
                  setSecondDayOfMonth(event.currentTarget.value);
                  setError(null);
                  setStatusMessage(null);
                }}
              />
            </label>
          </>
        )}
        <div className="reporting-period-preview" aria-label="Reporting period preview">
          {preview === null ? (
            <p>
              {reportingPeriodType === "two-fixed-days"
                ? "Choose an earlier date from 1 through 27 and a later date after it."
                : "Enter a payday from 1 through 31 to preview the reporting periods."}
            </p>
          ) : (
            <>
              <div>
                <strong>Current period</strong>
                <span>{formatReportingPeriodRange(preview.current)}</span>
                <small>Next boundary: {formatReportingDate(preview.current.endDateExclusiveIso)}</small>
              </div>
              <div>
                <strong>Next period</strong>
                <span>{formatReportingPeriodRange(preview.next)}</span>
                <small>Next boundary: {formatReportingDate(preview.next.endDateExclusiveIso)}</small>
              </div>
            </>
          )}
        </div>
        <p className="reporting-period-guidance">
          These rules set reporting boundaries, not guaranteed deposit dates. Weekends, holidays,
          and employer exceptions can move actual payments. Reporting currency is <strong>NOK</strong>;
          transaction amounts remain in their recorded currencies.
        </p>
        <div className="reporting-preferences-actions">
          <button type="submit" disabled={isSaving || draftRule === null}>
            {isSaving ? "Saving..." : "Save reporting preference"}
          </button>
          {isSaving && <span role="status">Saving reporting preference...</span>}
        </div>
        {error !== null && (
          <p className="reporting-preference-message is-error" role="alert">
            Unable to save reporting preference. {error} Your draft is unchanged; try again.
          </p>
        )}
        {statusMessage !== null && (
          <p className="reporting-preference-message is-success" role="status">{statusMessage}</p>
        )}
      </form>
    </section>
  );
}
