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
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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
    }
  }

  const monthlyReferenceRates = rates.filter((rate) => rate.kind === "monthly-reference");
  const reportCurrencies = report?.nativeSubtotals.map((subtotal) => subtotal.currencyCode) ?? [];

  return (
    <section className="exchange-rates-section" aria-label="Exchange rates" aria-busy={isLoading || isSaving}>
      <div className="section-heading">
        <h2>Local exchange rates</h2>
        <p>Record or import dated NOK rates. Native amounts remain unchanged; no rates are fetched online.</p>
      </div>

      {error !== null && <p role="alert">{error}</p>}
      {statusMessage !== null && <p role="status">{statusMessage}</p>}
      {isLoading && <p role="status">Loading local exchange rates...</p>}

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
        <button type="button" onClick={() => void importRates()} disabled={isSaving}>
          Import local rate CSV
        </button>
      </form>

      <section className="saved-exchange-rates" aria-label="Saved local exchange rates">
        <h3>Saved rates</h3>
        {rates.length === 0 ? (
          <p>No local exchange rates recorded.</p>
        ) : (
          <ul>
            {rates.map((rate) => (
              <li key={rate.id}>
                {rate.currencyCode} {rate.rateNokPerUnit} NOK per unit, effective {rate.effectiveDate}
                {" — "}{rate.source} ({rate.provenance === "local-file" ? "local file" : "manual"})
                {rate.kind === "monthly-reference" ? " — estimate" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {monthlyReferenceRates.length > 0 && (
        <section className="monthly-reference-selection" aria-label="Monthly reference rate selection">
          <h3>Explicit monthly estimates</h3>
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

      <form className="converted-report-form" aria-label="Converted monthly report request" onSubmit={(event) => void loadReport(event)}>
        <label>
          Report month
          <input type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} />
        </label>
        <label>
          Use latest rate scenario
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
          <span>Scenario only; historical actual reporting does not change.</span>
        </label>
        <button type="submit">Load converted report</button>
      </form>

      {report !== null && (
        <section className="converted-monthly-report" aria-label="Converted monthly report">
          <h3>Converted report for {report.yearMonth}</h3>
          <section aria-label="Native currency subtotals">
            <h4>Native-currency subtotals</h4>
            <ul>
              {report.nativeSubtotals.map((subtotal) => (
                <li key={subtotal.currencyCode}>
                  {formatMinor(subtotal.totalMinor, subtotal.currencyCode)}
                </li>
              ))}
            </ul>
          </section>
          {report.nokSubtotalMinor === null ? (
            <p role="status">
              NOK subtotal incomplete. Missing rates: {report.incompleteCurrencies.join(", ")}.
              Partial converted subtotal: {formatMinor(report.partialNokSubtotalMinor, "NOK")}.
            </p>
          ) : (
            <p>NOK subtotal: {formatMinor(report.nokSubtotalMinor, "NOK")}</p>
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
                      <p>Scenario NOK {formatMinor(scenarioItem.nokAmountMinor, "NOK").replace(/^NOK\s*/, "")}</p>
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
    </section>
  );
}
