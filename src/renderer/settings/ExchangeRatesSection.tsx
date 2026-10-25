import React from "react";
import type { NokMonthlyReport } from "../../app/dashboardApi.js";
import type { ExchangeRate } from "../../domain/types.js";
import { toLocalYearMonth } from "../localDate.js";

const amountFormatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMinor(amountMinor: number, currencyCode: string): string {
  return `${currencyCode} ${amountFormatter.format(amountMinor / 100)}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ExchangeRatesSection(): React.JSX.Element {
  const [rates, setRates] = React.useState<ExchangeRate[]>([]);
  const [activeView, setActiveView] = React.useState<"rate-book" | "monthly-report">("rate-book");
  const [currencyCode, setCurrencyCode] = React.useState("EUR");
  const [rateNokPerUnit, setRateNokPerUnit] = React.useState("");
  const [effectiveDate, setEffectiveDate] = React.useState("");
  const [kind, setKind] = React.useState<ExchangeRate["kind"]>("dated");
  const [source, setSource] = React.useState("");
  const [reportMonth, setReportMonth] = React.useState(() => toLocalYearMonth(new Date()));
  const [selectedMonthlyReferenceRateIds, setSelectedMonthlyReferenceRateIds] =
    React.useState<Record<string, string>>({});
  const [report, setReport] = React.useState<NokMonthlyReport | null>(null);
  const [scenarioReport, setScenarioReport] = React.useState<NokMonthlyReport | null>(null);
  const [useLatestRateScenario, setUseLatestRateScenario] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isBuildingReport, setIsBuildingReport] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function selectView(view: "rate-book" | "monthly-report"): void {
    if (view === activeView) return;
    setActiveView(view);
    setStatusMessage(null);
  }

  React.useEffect(() => {
    let active = true;
    setIsLoading(true);
    window.budgetApi.exchangeRates.list()
      .then((loadedRates) => {
        if (active) setRates(loadedRates);
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError, "Unable to load local exchange rates."));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveRate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (rateNokPerUnit.trim() === "" || effectiveDate === "" || source.trim() === "") {
      setError("Enter the NOK-per-unit rate, effective date, and source.");
      return;
    }
    setIsSaving(true);
    setError(null);
    setStatusMessage(null);
    const rate: ExchangeRate = {
      id: `manual-${currencyCode}-${effectiveDate}-${window.crypto.randomUUID()}`,
      currencyCode,
      rateNokPerUnit: rateNokPerUnit.trim(),
      effectiveDate,
      kind,
      source: source.trim(),
      provenance: "manual",
    };
    try {
      const saved = await window.budgetApi.exchangeRates.record(rate);
      setRates((current) =>
        [...current.filter((existing) => existing.id !== saved.id), saved]
          .sort((left, right) =>
            left.currencyCode.localeCompare(right.currencyCode) ||
            left.effectiveDate.localeCompare(right.effectiveDate) ||
            left.kind.localeCompare(right.kind) ||
            left.id.localeCompare(right.id)
          )
      );
      setStatusMessage("Local exchange rate saved.");
      setRateNokPerUnit("");
      setSource("");
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, "Unable to save the local exchange rate."));
    } finally {
      setIsSaving(false);
    }
  }

  async function importRates(): Promise<void> {
    setError(null);
    setStatusMessage(null);
    setIsSaving(true);
    try {
      const imported = await window.budgetApi.exchangeRates.importFromFile();
      if (imported === null) {
        setStatusMessage("Exchange-rate import canceled.");
        return;
      }
      setRates((current) =>
        [...current.filter((existing) => !imported.some((rate) =>
          rate.currencyCode === existing.currencyCode &&
          rate.effectiveDate === existing.effectiveDate &&
          rate.kind === existing.kind
        )), ...imported]
          .sort((left, right) =>
            left.currencyCode.localeCompare(right.currencyCode) ||
            left.effectiveDate.localeCompare(right.effectiveDate) ||
            left.kind.localeCompare(right.kind) ||
            left.id.localeCompare(right.id)
          )
      );
      setStatusMessage(`${imported.length} local exchange rate${imported.length === 1 ? "" : "s"} imported.`);
    } catch (importError: unknown) {
      setError(errorMessage(importError, "Unable to import local exchange rates."));
    } finally {
      setIsSaving(false);
    }
  }

  async function loadReport(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setStatusMessage(null);
    setIsBuildingReport(true);
    try {
      const request = {
        yearMonth: reportMonth,
        ...(Object.keys(selectedMonthlyReferenceRateIds).length === 0
          ? {}
          : { monthlyReferenceRateIds: selectedMonthlyReferenceRateIds }),
      };
      const actualReport = await window.budgetApi.exchangeRates.getMonthlyReport(request);
      setReport(actualReport);
      setScenarioReport(useLatestRateScenario
        ? await window.budgetApi.exchangeRates.getMonthlyReport({
            ...request,
            useLatestRateScenario: true,
          })
        : null);
    } catch (reportError: unknown) {
      setError(errorMessage(reportError, "Unable to build the converted monthly report."));
    } finally {
      setIsBuildingReport(false);
    }
  }

  const monthlyReferenceRates = rates.filter((rate) => rate.kind === "monthly-reference");
  const reportCurrencies = report?.nativeSubtotals.map((subtotal) => subtotal.currencyCode) ?? [];

  return (
    <section
      className="exchange-rates-section"
      aria-label="Exchange rates"
      aria-busy={isLoading || isSaving || isBuildingReport}
    >
      <div className="section-heading">
        <h2>Local exchange rates</h2>
        <p>Record or import dated NOK rates. Native amounts remain unchanged; no rates are fetched online.</p>
      </div>

      {error !== null && <p className="exchange-rate-message is-error" role="alert">{error}</p>}
      {statusMessage !== null && <p className="exchange-rate-message is-success" role="status">{statusMessage}</p>}
      {isLoading && <p className="exchange-rate-message" role="status">Loading local exchange rates...</p>}

      <div className="exchange-rate-view-switcher" role="group" aria-label="Exchange rate views">
        <button
          type="button"
          aria-pressed={activeView === "rate-book"}
          onClick={() => selectView("rate-book")}
        >
          Rate book
        </button>
        <button
          type="button"
          aria-pressed={activeView === "monthly-report"}
          onClick={() => selectView("monthly-report")}
        >
          Monthly report
        </button>
      </div>

      {activeView === "rate-book" && (
      <div className="exchange-rate-entry">
        <div className="exchange-rate-subheading">
          <h3>Maintain the local rate list</h3>
          <p>Use a rate from the transaction date. Monthly reference rates stay estimates until you select them.</p>
        </div>
      <form className="exchange-rate-form" aria-label="Record exchange rate" onSubmit={(event) => void saveRate(event)}>
        <label>
          Rate currency
          <select value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value)}>
            <option value="EUR">EUR</option>
            <option value="SEK">SEK</option>
            <option value="DKK">DKK</option>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
          </select>
        </label>
        <label>
          Rate NOK per 1 unit
          <input
            inputMode="decimal"
            value={rateNokPerUnit}
            onChange={(event) => setRateNokPerUnit(event.target.value)}
          />
        </label>
        <label>
          Rate effective date
          <input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
        </label>
        <label>
          Rate type
          <select value={kind} onChange={(event) => setKind(event.target.value as ExchangeRate["kind"])}>
            <option value="dated">Dated actual rate</option>
            <option value="monthly-reference">Monthly reference estimate</option>
          </select>
        </label>
        <label>
          Rate source
          <input value={source} onChange={(event) => setSource(event.target.value)} />
        </label>
        <button type="submit" disabled={isSaving}>Save local exchange rate</button>
        <button className="action-secondary" type="button" onClick={() => void importRates()} disabled={isSaving}>
          Import local rate CSV
        </button>
      </form>
      </div>
      )}

      {activeView === "rate-book" && (
      <section className="saved-exchange-rates" aria-label="Saved local exchange rates">
        <div className="exchange-rate-subheading">
          <h3>Saved rates</h3>
          <p>Each row keeps its source and effective date with the NOK-per-unit value.</p>
        </div>
        {rates.length === 0 ? (
          <div className="empty-state">
            <strong>No local exchange rates recorded.</strong>
            <p>Add a rate above or import a local CSV to build a converted report.</p>
          </div>
        ) : (
          <div className="saved-rate-table-scroll">
            <table aria-label="Saved local exchange rates">
              <thead>
                <tr>
                  <th scope="col">Currency</th>
                  <th scope="col">NOK per unit</th>
                  <th scope="col">Effective date</th>
                  <th scope="col">Rate type</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.id}>
                    <td data-label="Currency">{rate.currencyCode}</td>
                    <td data-label="NOK per unit" className="financial-value">{rate.rateNokPerUnit}</td>
                    <td data-label="Effective date"><time dateTime={rate.effectiveDate}>{rate.effectiveDate}</time></td>
                    <td data-label="Rate type">
                      {rate.kind === "monthly-reference" ? "Monthly estimate" : "Dated actual"}
                    </td>
                    <td data-label="Source">
                      <span>{rate.source}</span>
                      <small>{rate.provenance === "local-file" ? "Local file" : "Manual"}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {activeView === "rate-book" && monthlyReferenceRates.length > 0 && (
        <section className="monthly-reference-selection" aria-label="Monthly reference rate selection">
          <div className="exchange-rate-subheading">
            <h3>Monthly reference estimates</h3>
            <p>Select an estimate only for the currency and month where it should be used.</p>
          </div>
          {monthlyReferenceRates.map((rate) => (
            <label key={rate.id}>
              Use monthly estimate for {rate.currencyCode} ({rate.effectiveDate})
              <input
                type="checkbox"
                checked={selectedMonthlyReferenceRateIds[rate.currencyCode] === rate.id}
                onChange={(event) => {
                  setSelectedMonthlyReferenceRateIds((current) => {
                    const next = { ...current };
                    if (event.target.checked) next[rate.currencyCode] = rate.id;
                    else if (next[rate.currencyCode] === rate.id) delete next[rate.currencyCode];
                    return next;
                  });
                }}
              />
            </label>
          ))}
        </section>
      )}

      {activeView === "monthly-report" && (
        <div className="converted-report-content">
          <div className="exchange-rate-subheading">
            <h3>Convert a month</h3>
            <p>Historical totals use transaction-date rates; the latest-rate scenario is shown separately.</p>
          </div>
          <form className="converted-report-form" aria-label="Converted monthly report request" onSubmit={(event) => void loadReport(event)}>
            <label>
              Report month
              <input type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} />
            </label>
            <label className="latest-rate-scenario-toggle">
              <input
                type="checkbox"
                checked={useLatestRateScenario}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setUseLatestRateScenario(enabled);
                  if (!enabled) {
                    setScenarioReport(null);
                    return;
                  }
                  if (report === null) return;
                  window.budgetApi.exchangeRates.getMonthlyReport({
                    yearMonth: reportMonth,
                    ...(Object.keys(selectedMonthlyReferenceRateIds).length === 0
                      ? {}
                      : { monthlyReferenceRateIds: selectedMonthlyReferenceRateIds }),
                    useLatestRateScenario: true,
                  })
                    .then(setScenarioReport)
                    .catch((scenarioError: unknown) => {
                      setError(errorMessage(scenarioError, "Unable to build the latest-rate scenario."));
                    });
                }}
              />
              <span>
                <strong>Use latest rate scenario</strong>
                <small>Scenario only. Historical actuals do not change.</small>
              </span>
            </label>
            <button type="submit" disabled={isBuildingReport}>
              {isBuildingReport ? "Building report..." : "Load converted report"}
            </button>
          </form>
          {isBuildingReport && <p className="exchange-rate-message" role="status">Building the converted monthly report...</p>}

          {report !== null && (
            <section className="converted-monthly-report" aria-label="Converted monthly report">
              <div className="converted-report-heading">
                <h3>Converted report for {report.yearMonth}</h3>
                <p>Native amounts remain visible beside the transaction-date NOK conversion.</p>
              </div>
              <div className="native-currency-subtotals" role="group" aria-label="Native currency subtotals">
                <h4>Native-currency subtotals</h4>
                <dl>
                  {report.nativeSubtotals.map((subtotal) => (
                    <div key={subtotal.currencyCode}>
                      <dt>{subtotal.currencyCode}</dt>
                      <dd>{formatMinor(subtotal.totalMinor, subtotal.currencyCode)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              {report.nokSubtotalMinor === null ? (
                <p className="converted-report-status is-incomplete" role="status">
                  NOK subtotal incomplete. Missing rates: {report.incompleteCurrencies.join(", ")}.
                  Partial converted subtotal: {formatMinor(report.partialNokSubtotalMinor, "NOK")}.
                </p>
              ) : (
                <p className="converted-report-status is-complete" role="status">
                  NOK subtotal: {formatMinor(report.nokSubtotalMinor, "NOK")}
                </p>
              )}
              <ul aria-label="Converted transaction amounts">
                {report.transactions.map((item) => {
                  const scenarioItem = scenarioReport?.transactions.find(
                    (candidate) => candidate.transactionId === item.transactionId
                  );
                  return (
                    <li key={item.transactionId}>
                      <section role="group" aria-label={item.merchantRaw}>
                        <h4>{item.merchantRaw}</h4>
                        <p>
                          {formatMinor(item.nativeAmountMinor, item.nativeCurrencyCode)}
                          {" — "}
                          {item.nokAmountMinor === null
                            ? "NOK conversion incomplete"
                            : formatMinor(item.nokAmountMinor, "NOK")}
                        </p>
                        {item.exchangeRate !== null && (
                          <p>
                            Rate {item.exchangeRate.rateNokPerUnit} NOK per {item.nativeCurrencyCode}
                            {" — "}{item.exchangeRate.effectiveDate}, {item.exchangeRate.source}
                            {item.isEstimate ? " — estimate" : ""}
                          </p>
                        )}
                        {scenarioItem?.nokAmountMinor !== null && scenarioItem !== undefined && (
                          <p className="scenario-amount">Scenario NOK {formatMinor(scenarioItem.nokAmountMinor, "NOK").replace(/^NOK\s*/, "")}</p>
                        )}
                      </section>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {report !== null && useLatestRateScenario && scenarioReport === null && reportCurrencies.length > 0 && (
            <p role="status">Latest-rate scenario has no complete rate set for this report.</p>
          )}
        </div>
      )}
    </section>
  );
}
