import React from "react";
import type {
  CashflowScenarioRequest,
  CashflowScenarioResult,
} from "../../app/dashboardApi.js";
import {
  isCurrencyCode,
  type CurrencyCode,
} from "../../domain/types.js";
import type {
  CashflowScenarioAppliedAssumption,
  CashflowScenarioAssumption,
  CashflowScenarioPlan,
} from "../../domain/forecast/cashflowScenarios.js";

const NOK_MINOR_UNITS = 100;
const MAX_FORECAST_MONTHS = 3;
const moneyFormatters = new Map<string, Intl.NumberFormat>();
const cashPathDateFormatter = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

interface CashflowScenarioSectionProps {
  refreshKey: number;
}

function formatAmount(amountMinor: number, currencyCode: CurrencyCode): string {
  let formatter = moneyFormatters.get(currencyCode);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat("nb-NO", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    moneyFormatters.set(currencyCode, formatter);
  }
  return formatter.format(amountMinor / NOK_MINOR_UNITS);
}

function parseAmountMinor(value: string): number {
  const amount = Number(value);
  const amountMinor = Math.round(amount * NOK_MINOR_UNITS);
  if (
    value.trim() === "" ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(amountMinor) ||
    Math.abs(amount * NOK_MINOR_UNITS - amountMinor) > 0.000001
  ) {
    throw new Error("Enter a positive amount with at most two decimal places.");
  }
  return amountMinor;
}

function parseDurationMonths(value: string): number {
  const durationMonths = Number(value);
  if (
    !Number.isInteger(durationMonths) ||
    durationMonths < 1 ||
    durationMonths > MAX_FORECAST_MONTHS
  ) {
    throw new Error(`Duration must be between 1 and ${MAX_FORECAST_MONTHS} months.`);
  }
  return durationMonths;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === value;
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatCashPathDate(dateIso: string): string {
  return cashPathDateFormatter.format(new Date(`${dateIso}T00:00:00.000Z`));
}

function describeAssumption(assumption: CashflowScenarioAssumption): string {
  const amount = formatAmount(assumption.amountMinor, assumption.currencyCode);
  if (assumption.kind === "income-change") {
    return `Income ${assumption.direction} · ${amount} · ${assumption.startDateIso} · ${assumption.durationMonths} months`;
  }
  if (assumption.kind === "recurring-expense") {
    return `Recurring expense · ${amount} · ${assumption.startDateIso} · ${assumption.durationMonths} months`;
  }
  return `One-time expense · ${amount} · ${assumption.occurrenceDateIso}`;
}

function describeAppliedAssumption(
  applied: CashflowScenarioAppliedAssumption,
  source: CashflowScenarioAssumption | undefined
): string {
  const amount = formatAmount(applied.nativeAmountMinor, applied.currencyCode);
  if (source?.kind === "income-change") {
    return `Income ${source.direction} · ${amount} · ${applied.dateIso} · ${source.durationMonths} months`;
  }
  if (source?.kind === "recurring-expense") {
    return `Recurring expense · ${amount} · ${applied.dateIso} · ${source.durationMonths} months`;
  }
  if (source?.kind === "one-time-expense") {
    return `One-time expense · ${amount} · ${applied.dateIso}`;
  }
  return `${applied.kind.replaceAll("-", " ")} · ${amount} · ${applied.dateIso}`;
}

function sortAppliedAssumptions(
  appliedAssumptions: CashflowScenarioAppliedAssumption[],
  assumptions: CashflowScenarioAssumption[]
): CashflowScenarioAppliedAssumption[] {
  const assumptionsById = new Map(assumptions.map((assumption) => [assumption.id, assumption]));
  return appliedAssumptions.slice().sort((left, right) => {
    const dateOrder = left.dateIso.localeCompare(right.dateIso);
    if (dateOrder !== 0) return dateOrder;

    const leftSource = assumptionsById.get(left.id);
    const rightSource = assumptionsById.get(right.id);
    const leftKey = leftSource === undefined
      ? `${left.kind}:${left.currencyCode}:${left.nativeAmountMinor}`
      : describeAssumption(leftSource);
    const rightKey = rightSource === undefined
      ? `${right.kind}:${right.currencyCode}:${right.nativeAmountMinor}`
      : describeAssumption(rightSource);
    return leftKey.localeCompare(rightKey);
  });
}

function CashflowPath({
  heading,
  path,
}: {
  heading: string;
  path: CashflowScenarioPlan["projectedCashPath"];
}): React.JSX.Element {
  return (
    <div
      className="cashflow-scenario-path"
      role="group"
      aria-label={`${heading} cash path`}
    >
      <h4>{heading} cash path</h4>
      <ul>
        {path.map((point, index) => (
          <li key={`${point.dateIso}:${point.description}:${index}`}>
            <div className="cashflow-scenario-path-event">
              <time dateTime={point.dateIso}>{formatCashPathDate(point.dateIso)}</time>
              <span className="cashflow-scenario-path-description">{point.description}</span>
            </div>
            <dl className="cashflow-scenario-path-values">
              <div role="group" aria-label="Movement">
                <dt>Movement</dt>
                <dd>{formatAmount(point.amountNokMinor, "NOK")}</dd>
              </div>
              <div role="group" aria-label="Projected cash">
                <dt>Projected cash</dt>
                <dd>{formatAmount(point.projectedCashNokMinor, "NOK")}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CashflowScenarioSection({
  refreshKey,
}: CashflowScenarioSectionProps): React.JSX.Element {
  const [adjustmentKind, setAdjustmentKind] =
    React.useState<CashflowScenarioAssumption["kind"]>("income-change");
  const [incomeDirection, setIncomeDirection] =
    React.useState<"increase" | "reduction">("reduction");
  const [amount, setAmount] = React.useState("");
  const [currencyCode, setCurrencyCode] = React.useState("NOK");
  const [dateIso, setDateIso] = React.useState("");
  const [durationMonths, setDurationMonths] = React.useState("1");
  const [useLatestRateScenario, setUseLatestRateScenario] = React.useState(false);
  const [assumptions, setAssumptions] = React.useState<CashflowScenarioAssumption[]>([]);
  const [editingAssumptionId, setEditingAssumptionId] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CashflowScenarioResult | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const appliedAssumptions = result?.state === "complete"
    ? sortAppliedAssumptions(result.appliedAssumptions, assumptions)
    : [];
  const assumptionsById = new Map(assumptions.map((assumption) => [assumption.id, assumption]));

  React.useEffect(() => {
    setResult(null);
    setError(null);
  }, [refreshKey]);

  function invalidateResult(): void {
    setResult(null);
    setError(null);
  }

  function addAssumption(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    try {
      const amountMinor = parseAmountMinor(amount);
      const normalizedCurrencyCode = currencyCode.trim().toUpperCase();
      if (!isCurrencyCode(normalizedCurrencyCode)) {
        throw new Error("Enter a three-letter currency code, such as NOK.");
      }
      if (!isIsoDate(dateIso)) {
        throw new Error("Choose a valid scenario date.");
      }

      const id = editingAssumptionId ?? window.crypto.randomUUID();
      let assumption: CashflowScenarioAssumption;
      if (adjustmentKind === "income-change") {
        assumption = {
          id,
          kind: adjustmentKind,
          direction: incomeDirection,
          amountMinor,
          currencyCode: normalizedCurrencyCode,
          startDateIso: dateIso,
          durationMonths: parseDurationMonths(durationMonths),
        };
      } else if (adjustmentKind === "recurring-expense") {
        assumption = {
          id,
          kind: adjustmentKind,
          amountMinor,
          currencyCode: normalizedCurrencyCode,
          startDateIso: dateIso,
          durationMonths: parseDurationMonths(durationMonths),
        };
      } else {
        assumption = {
          id,
          kind: adjustmentKind,
          amountMinor,
          currencyCode: normalizedCurrencyCode,
          occurrenceDateIso: dateIso,
        };
      }

      setAssumptions((current) => editingAssumptionId === null
        ? [...current, assumption]
        : current.map((existing) => existing.id === editingAssumptionId ? assumption : existing));
      setEditingAssumptionId(null);
      setAmount("");
      invalidateResult();
    } catch (inputError) {
      setError(describeError(inputError, "Unable to add this scenario assumption."));
    }
  }

  async function compareScenario(): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    try {
      const request: CashflowScenarioRequest = {
        assumptions,
        useLatestRateScenario,
      };
      setResult(await window.budgetApi.cashflowScenarios.evaluate(request));
    } catch (evaluationError) {
      setResult(null);
      setError(describeError(evaluationError, "Unable to compare this cashflow scenario."));
    } finally {
      setIsSubmitting(false);
    }
  }

  function removeAssumption(assumptionId: string): void {
    setAssumptions((current) => current.filter(({ id }) => id !== assumptionId));
    if (editingAssumptionId === assumptionId) {
      setEditingAssumptionId(null);
      setAmount("");
      setDateIso("");
      setDurationMonths("1");
    }
    invalidateResult();
  }

  function editAssumption(assumption: CashflowScenarioAssumption): void {
    setEditingAssumptionId(assumption.id);
    setAdjustmentKind(assumption.kind);
    if (assumption.kind === "income-change") {
      setIncomeDirection(assumption.direction);
      setDurationMonths(String(assumption.durationMonths));
      setDateIso(assumption.startDateIso);
    } else if (assumption.kind === "recurring-expense") {
      setDurationMonths(String(assumption.durationMonths));
      setDateIso(assumption.startDateIso);
    } else {
      setDateIso(assumption.occurrenceDateIso);
    }
    setAmount((assumption.amountMinor / NOK_MINOR_UNITS).toFixed(2));
    setCurrencyCode(assumption.currencyCode);
    invalidateResult();
  }

  function cancelEdit(): void {
    setEditingAssumptionId(null);
    setAmount("");
    setDateIso("");
    setDurationMonths("1");
    setCurrencyCode("NOK");
    setError(null);
  }

  function resetScenario(): void {
    setAdjustmentKind("income-change");
    setIncomeDirection("reduction");
    setAmount("");
    setCurrencyCode("NOK");
    setDateIso("");
    setDurationMonths("1");
    setUseLatestRateScenario(false);
    setAssumptions([]);
    setEditingAssumptionId(null);
    setResult(null);
    setError(null);
  }

  return (
    <section
      id="cashflow-scenarios"
      className="cashflow-scenario-section"
      aria-label="Cashflow scenarios"
      aria-busy={isSubmitting}
      tabIndex={-1}
    >
      <header className="cashflow-scenario-heading">
        <div>
          <h2>Cashflow scenarios</h2>
          <p>
            Compare temporary changes with the local three-month forecast. Assumptions are
            used for this comparison only and do not change transactions or budgets.
          </p>
          <details className="cashflow-baseline-disclosure">
            <summary>How the baseline is calculated</summary>
            <p>
              Confirmed commitments with future occurrences are included in both paths. Only
              historical payments linked to those commitments are removed from the moving-average
              baseline.
            </p>
          </details>
        </div>
      </header>

      {error !== null && <p className="cashflow-scenario-error" role="alert">{error}</p>}

      <div className="cashflow-scenario-layout">
        <div className="cashflow-scenario-inputs">
          <form
            className="cashflow-scenario-form"
            aria-label="Scenario assumption inputs"
            onSubmit={addAssumption}
          >
            <p id="cashflow-locale-entry-help" className="field-help">
              The date field follows your system order; enter amounts using the decimal separator shown (1 234,50 or 1234.50). Results use Norwegian NOK formatting.
            </p>
            <div className="cashflow-scenario-fields">
              <label className="cashflow-scenario-field">
                <span>Scenario adjustment type</span>
                <select
                  aria-label="Scenario adjustment type"
                  value={adjustmentKind}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (
                      value === "income-change" ||
                      value === "recurring-expense" ||
                      value === "one-time-expense"
                    ) {
                      setAdjustmentKind(value);
                      invalidateResult();
                    }
                  }}
                >
                  <option value="income-change">Income change</option>
                  <option value="recurring-expense">Recurring expense</option>
                  <option value="one-time-expense">One-time expense</option>
                </select>
              </label>

              {adjustmentKind === "income-change" && (
                <label className="cashflow-scenario-field">
                  <span>Income change direction</span>
                  <select
                    aria-label="Income change direction"
                    value={incomeDirection}
                    onChange={(event) => {
                      setIncomeDirection(event.target.value === "increase" ? "increase" : "reduction");
                      invalidateResult();
                    }}
                  >
                    <option value="increase">Increase</option>
                    <option value="reduction">Reduction</option>
                  </select>
                </label>
              )}

              <label className="cashflow-scenario-field">
                <span>Scenario amount</span>
                <input
                  type="number"
                  lang="nb-NO"
                  aria-describedby="cashflow-locale-entry-help"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    invalidateResult();
                  }}
                  required
                />
              </label>

              <label className="cashflow-scenario-field">
                <span>Scenario currency</span>
                <input
                  type="text"
                  autoComplete="off"
                  maxLength={3}
                  pattern="[A-Za-z]{3}"
                  value={currencyCode}
                  onChange={(event) => {
                    setCurrencyCode(event.target.value.toUpperCase());
                    invalidateResult();
                  }}
                  required
                />
              </label>

              <label className="cashflow-scenario-field">
                <span>
                  {adjustmentKind === "one-time-expense"
                    ? "Scenario expense date"
                    : "Scenario start date"}
                </span>
                <input
                  type="date"
                  lang="nb-NO"
                  aria-describedby="cashflow-locale-entry-help"
                  value={dateIso}
                  onChange={(event) => {
                    setDateIso(event.target.value);
                    invalidateResult();
                  }}
                  required
                />
              </label>

              {adjustmentKind !== "one-time-expense" && (
                <label className="cashflow-scenario-field">
                  <span>Duration (months)</span>
                  <input
                    type="number"
                    min="1"
                    max={MAX_FORECAST_MONTHS}
                    step="1"
                    value={durationMonths}
                    onChange={(event) => {
                      setDurationMonths(event.target.value);
                      invalidateResult();
                    }}
                    required
                  />
                </label>
              )}
            </div>

            <div className="cashflow-scenario-form-actions">
              <button type="submit" disabled={isSubmitting}>
                {editingAssumptionId === null ? "Add adjustment" : "Save adjustment"}
              </button>
              {editingAssumptionId !== null && (
                <button type="button" onClick={cancelEdit} disabled={isSubmitting}>
                  Cancel edit
                </button>
              )}
            </div>
          </form>

          <div className="cashflow-scenario-assumptions">
            <h3>Temporary assumptions</h3>
            {assumptions.length === 0 ? (
              <p className="field-help">No temporary assumptions have been added.</p>
            ) : (
              <ul>
                {assumptions.map((assumption) => (
                  <li key={assumption.id}>
                    <span>{describeAssumption(assumption)}</span>
                    <button
                      type="button"
                      aria-label={`Edit ${describeAssumption(assumption)}`}
                      onClick={() => editAssumption(assumption)}
                      disabled={isSubmitting}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${describeAssumption(assumption)}`}
                      onClick={() => removeAssumption(assumption.id)}
                      disabled={isSubmitting}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="cashflow-scenario-latest-rate">
            <input
              type="checkbox"
              checked={useLatestRateScenario}
              onChange={(event) => {
                setUseLatestRateScenario(event.target.checked);
                invalidateResult();
              }}
            />
            <span>Use latest stored rates for foreign-currency assumptions</span>
          </label>

          <div className="cashflow-scenario-actions">
            <button type="button" onClick={() => void compareScenario()} disabled={isSubmitting}>
              {isSubmitting ? "Comparing..." : "Compare scenario"}
            </button>
            <button type="button" onClick={resetScenario} disabled={isSubmitting}>
              Reset scenario
            </button>
          </div>
        </div>

        <div className="cashflow-scenario-results">
          {result === null ? (
            <p className="field-help">
              Add temporary assumptions or compare the current baseline to check its inputs.
            </p>
          ) : result.state === "incomplete" ? (
            <div
              className="cashflow-scenario-outcome cashflow-scenario-incomplete"
              role="status"
              aria-label="Scenario comparison"
            >
              <h3>Scenario comparison incomplete</h3>
              <p>A confident comparison is unavailable until these inputs are resolved.</p>
              {result.baseline !== null && (
                <p>
                  Baseline lowest projected cash:{" "}
                  {formatAmount(result.baseline.minimumProjectedCashNokMinor, "NOK")}
                </p>
              )}
              <ul className="cashflow-scenario-reasons">
                {result.incompleteReasons.map((reason, index) => (
                  <li key={`${reason.code}:${reason.assumptionId ?? index}`}>
                    {reason.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div
              className="cashflow-scenario-outcome"
              role="status"
              aria-label="Scenario comparison"
            >
              <h3>Scenario comparison complete</h3>
              <p>
                Baseline lowest projected cash:{" "}
                {formatAmount(result.baseline.minimumProjectedCashNokMinor, "NOK")}
              </p>
              <p>
                Scenario lowest projected cash:{" "}
                {formatAmount(result.scenario.minimumProjectedCashNokMinor, "NOK")}
              </p>
              <p
                className="cashflow-scenario-minimum-difference"
                role="group"
                aria-label="Minimum projected cash difference"
              >
                Minimum projected cash difference:{" "}
                {formatAmount(result.minimumDifferenceNokMinor, "NOK")}
              </p>
              {result.appliedAssumptions.some(({ isScenarioRestatement }) => isScenarioRestatement) && (
                <p className="cashflow-scenario-notice">
                  A latest stored rate is used for this scenario only. Historical actuals are not changed.
                </p>
              )}
              {result.appliedAssumptions.some(({ isEstimate }) => isEstimate) && (
                <p className="cashflow-scenario-notice">
                  A local monthly-reference estimate was used for a foreign-currency assumption.
                </p>
              )}
              {appliedAssumptions.length > 0 && (
                <div
                  className="cashflow-scenario-applied-assumptions"
                  role="group"
                  aria-label="Applied scenario assumptions"
                >
                  <h4>Applied scenario assumptions</h4>
                  <ul>
                    {appliedAssumptions.map((assumption) => (
                      <li key={`${assumption.id}:${assumption.dateIso}`}>
                        <span>
                          {describeAppliedAssumption(
                            assumption,
                            assumptionsById.get(assumption.id)
                          )}
                        </span>
                        <span>
                          {assumption.amountNokMinor === null
                            ? "Conversion unavailable"
                            : `Converted for this scenario: ${formatAmount(assumption.amountNokMinor, "NOK")}`}
                        </span>
                        {assumption.exchangeRate !== null && (
                          <span className="cashflow-scenario-rate-basis">
                            {assumption.isScenarioRestatement
                              ? "Latest stored rate · scenario-only"
                              : assumption.isEstimate
                                ? "Monthly reference estimate"
                                : "Dated rate"}
                            {assumption.isEstimate && assumption.isScenarioRestatement
                              ? " · estimate"
                              : ""}
                            {" · "}
                            {assumption.exchangeRate.rateNokPerUnit} NOK per {assumption.currencyCode}
                            {" · effective "}
                            {assumption.exchangeRate.effectiveDate}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="cashflow-scenario-paths">
                <CashflowPath heading="Baseline" path={result.baseline.projectedCashPath} />
                <CashflowPath heading="Scenario" path={result.scenario.projectedCashPath} />
              </div>
              <div className="cashflow-scenario-months">
                {result.months.map((month) => (
                  <div
                    className="cashflow-scenario-month"
                    key={month.yearMonth}
                    role="group"
                    aria-label={`Scenario month ${month.yearMonth}`}
                  >
                    <h4>{month.yearMonth}</h4>
                    <dl>
                      <div role="group" aria-label="Baseline cashflow">
                        <dt>Baseline cashflow</dt>
                        <dd>{formatAmount(month.baselineCashflowNokMinor, "NOK")}</dd>
                      </div>
                      <div role="group" aria-label="Scenario cashflow">
                        <dt>Scenario cashflow</dt>
                        <dd>{formatAmount(month.scenarioCashflowNokMinor, "NOK")}</dd>
                      </div>
                      <div role="group" aria-label="Difference from baseline">
                        <dt>Difference from baseline</dt>
                        <dd>{formatAmount(month.differenceNokMinor, "NOK")}</dd>
                      </div>
                      <div role="group" aria-label="Baseline month-end cash">
                        <dt>Baseline month-end cash</dt>
                        <dd>{formatAmount(month.baselineEndingCashNokMinor, "NOK")}</dd>
                      </div>
                      <div role="group" aria-label="Scenario month-end cash">
                        <dt>Scenario month-end cash</dt>
                        <dd>{formatAmount(month.scenarioEndingCashNokMinor, "NOK")}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
