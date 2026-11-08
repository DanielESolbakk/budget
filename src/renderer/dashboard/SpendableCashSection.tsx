import React from "react";
import type {
  SpendableCashEstimate,
  SpendableCashEstimateRequest,
} from "../../shared/dashboard.js";
import type { Account, ExchangeRate } from "../../domain/types.js";
import { formatCurrencySymbolAmount as formatAmount } from "../formatCurrencyAmount.js";
import { parseReserveMinor } from "../amountInputs.js";

interface SpendableCashSectionProps {
  isActive: boolean;
  refreshKey: number;
}

interface MonthlyRateRequest {
  currencyCode: string;
  yearMonth: string;
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function getMissingRateRequests(result: SpendableCashEstimate | null): MonthlyRateRequest[] {
  if (result?.state !== "incomplete") return [];
  const requests = new Map<string, MonthlyRateRequest>();
  for (const reason of result.incompleteReasons) {
    if (reason.code !== "missing-exchange-rate" || reason.currencyCode === undefined ||
        reason.dateIso === undefined) {
      continue;
    }
    const yearMonth = reason.dateIso.slice(0, 7);
    requests.set(`${reason.currencyCode}/${yearMonth}`, {
      currencyCode: reason.currencyCode,
      yearMonth,
    });
  }
  return [...requests.values()].sort((left, right) =>
    left.currencyCode.localeCompare(right.currencyCode) ||
    left.yearMonth.localeCompare(right.yearMonth)
  );
}

export function SpendableCashSection({
  isActive,
  refreshKey,
}: SpendableCashSectionProps): React.JSX.Element {
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = React.useState<string[]>([]);
  const [nextIncomeDateIso, setNextIncomeDateIso] = React.useState("");
  const [reserveAmount, setReserveAmount] = React.useState("0.00");
  const [monthlyReferenceRateIds, setMonthlyReferenceRateIds] =
    React.useState<Record<string, string>>({});
  const [monthlyReferenceRates, setMonthlyReferenceRates] = React.useState<ExchangeRate[]>([]);
  const [result, setResult] = React.useState<SpendableCashEstimate | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLoadingRates, setIsLoadingRates] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const initializedSelection = React.useRef(false);
  const missingRateRequests = getMissingRateRequests(result);

  React.useEffect(() => {
    if (!isActive) return;
    let active = true;
    setIsLoading(true);
    setError(null);
    window.budgetApi.accounts.getCurrent()
      .then((current) => {
        if (!active) return;
        if (current === null) {
          throw new Error("Household accounts are unavailable.");
        }
        setAccounts(current.accounts);
        const availableIds = new Set(current.accounts.map((account) => account.id));
        if (!initializedSelection.current) {
          initializedSelection.current = true;
          setSelectedAccountIds(current.accounts.map((account) => account.id));
        } else {
          setSelectedAccountIds((selected) => selected.filter((id) => availableIds.has(id)));
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(describeError(loadError, "Unable to load household accounts."));
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isActive, refreshKey]);

  function updateSelectedAccount(accountId: string, checked: boolean): void {
    setSelectedAccountIds((selected) => checked
      ? [...new Set([...selected, accountId])]
      : selected.filter((id) => id !== accountId));
    setResult(null);
    setError(null);
  }

  async function loadMonthlyReferenceRates(): Promise<void> {
    setIsLoadingRates(true);
    try {
      setMonthlyReferenceRates(await window.budgetApi.exchangeRates.list());
    } catch (loadError) {
      setError(describeError(loadError, "Unable to load local monthly reference rates."));
    } finally {
      setIsLoadingRates(false);
    }
  }

  async function submitEstimate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (selectedAccountIds.length === 0) {
      setError("Select at least one liquid account.");
      return;
    }

    let reserveMinor: number;
    try {
      reserveMinor = parseReserveMinor(reserveAmount);
    } catch (inputError) {
      setError(describeError(inputError, "Enter a valid reserve amount."));
      return;
    }

    setIsSubmitting(true);
    try {
      const request: SpendableCashEstimateRequest = {
        selectedAccountIds,
        nextIncomeDateIso,
        reserveMinor,
        ...(Object.keys(monthlyReferenceRateIds).length === 0
          ? {}
          : { monthlyReferenceRateIds }),
      };
      const estimate = await window.budgetApi.spendableCash.getEstimate(request);
      setResult(estimate);
      if (getMissingRateRequests(estimate).length > 0 && monthlyReferenceRates.length === 0) {
        await loadMonthlyReferenceRates();
      }
    } catch (estimateError) {
      setError(describeError(estimateError, "Unable to calculate spendable cash."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section
      id="spendable-cash"
      className="spendable-cash-section"
      aria-label="Spendable cash until income"
      aria-busy={isLoading || isSubmitting}
      tabIndex={-1}
    >
      <header className="spendable-cash-heading">
        <div>
          <h2>Spendable cash until income</h2>
          <p>
            An advisory estimate from selected cash accounts, pending debits, and confirmed
            commitments. Property, investments, and credit are not included.
          </p>
        </div>
      </header>

      {error !== null && <p className="spendable-cash-message is-error" role="alert">{error}</p>}
      {isLoading ? (
        <p className="spendable-cash-message" role="status">Loading local account list...</p>
      ) : (
        <div className="spendable-cash-layout">
          <form
            className="spendable-cash-form"
            aria-label="Spendable cash estimate inputs"
            onSubmit={(event) => void submitEstimate(event)}
          >
            <p id="spendable-locale-entry-help" className="field-help">
              The date field follows your system order; enter amounts using the decimal separator shown (1 234,50 or 1234.50). Results use Norwegian NOK formatting.
            </p>
            <fieldset className="spendable-cash-account-list">
              <legend>Liquid accounts</legend>
              {accounts.length === 0 ? (
                <p className="field-help">No liquid accounts are available.</p>
              ) : accounts.map((account) => (
                <label key={account.id} className="spendable-cash-account-option">
                  <input
                    type="checkbox"
                    checked={selectedAccountIds.includes(account.id)}
                    onChange={(event) => updateSelectedAccount(account.id, event.target.checked)}
                  />
                  <span>{account.name}</span>
                  <small>{account.currencyCode}</small>
                </label>
              ))}
            </fieldset>

            <div className="spendable-cash-fields">
              <label className="spendable-cash-field">
                <span>Next income date</span>
                <input
                  type="date"
                  lang="nb-NO"
                  aria-describedby="spendable-locale-entry-help"
                  value={nextIncomeDateIso}
                  onChange={(event) => {
                    setNextIncomeDateIso(event.target.value);
                    setResult(null);
                    setError(null);
                  }}
                  required
                />
              </label>
              <label className="spendable-cash-field">
                <span>Reserve (NOK)</span>
                <input
                  type="number"
                  lang="nb-NO"
                  aria-describedby="spendable-locale-entry-help"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={reserveAmount}
                  onChange={(event) => {
                    setReserveAmount(event.target.value);
                    setResult(null);
                    setError(null);
                  }}
                  required
                />
              </label>
            </div>

            {missingRateRequests.length > 0 && (
              <div className="spendable-cash-monthly-rates">
                <h3>Monthly reference estimates</h3>
                <p className="field-help">
                  Select a local monthly rate explicitly to use an estimate for the listed currency and month.
                </p>
                {isLoadingRates ? (
                  <p className="field-help" role="status">Loading local exchange rates...</p>
                ) : missingRateRequests.map(({ currencyCode, yearMonth }) => {
                  const key = `${currencyCode}/${yearMonth}`;
                  const rates = monthlyReferenceRates.filter((rate) =>
                    rate.currencyCode === currencyCode &&
                    rate.kind === "monthly-reference" &&
                    rate.effectiveDate.slice(0, 7) === yearMonth
                  );
                  return rates.length === 0 ? (
                    <p className="field-help" key={key}>
                      No monthly estimate is available for {currencyCode} in {yearMonth}. Add a local dated or monthly rate in Exchange rates.
                    </p>
                  ) : (
                    <label className="spendable-cash-field" key={key}>
                      <span>Monthly estimate for {currencyCode} in {yearMonth}</span>
                      <select
                        aria-label={`Monthly estimate for ${currencyCode} ${yearMonth}`}
                        value={monthlyReferenceRateIds[key] ?? ""}
                        onChange={(event) => setMonthlyReferenceRateIds((selected) => ({
                          ...selected,
                          [key]: event.target.value,
                        }))}
                      >
                        <option value="">Choose a local monthly rate</option>
                        {rates.map((rate) => (
                          <option key={rate.id} value={rate.id}>
                            {rate.effectiveDate} · {rate.rateNokPerUnit} NOK per {rate.currencyCode}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="action-row">
              <button type="submit" disabled={isSubmitting || accounts.length === 0}>
                {isSubmitting ? "Calculating..." : "Estimate spendable cash"}
              </button>
            </div>
          </form>

          <div className="spendable-cash-results">
            {result === null ? (
              <p className="field-help">
                Choose accounts, a next-income date, and a reserve to calculate an advisory amount.
              </p>
            ) : result.state === "incomplete" ? (
              <div
                className="spendable-cash-outcome spendable-cash-incomplete"
                role="status"
                aria-label="Spendable cash estimate"
              >
                <h3>Estimate incomplete</h3>
                <p>
                  A confident spendable amount is unavailable until the missing inputs are resolved.
                </p>
                <ul className="spendable-cash-reasons">
                  {result.incompleteReasons.map((reason, index) => (
                    <li key={`${reason.code}:${reason.accountId ?? reason.commitmentId ?? index}`}>
                      {reason.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : result.spendableCashNokMinor === null ||
              result.lowestProjectedCashNokMinor === null ? (
              <p className="spendable-cash-message is-error" role="alert">
                The estimate result is missing its projected balance.
              </p>
            ) : (
              <div
                className="spendable-cash-outcome"
                role="status"
                aria-label="Spendable cash estimate"
              >
                <h3>
                  {result.spendableCashNokMinor < 0
                    ? "Projected shortfall"
                    : "Advisory spendable cash"}
                </h3>
                <p className="spendable-cash-value" aria-label="Spendable amount">
                  {formatAmount(result.spendableCashNokMinor, "NOK")}
                </p>
                <p className="field-help">
                  Lowest projected balance less a reserve of {formatAmount(result.reserveNokMinor, "NOK")},
                  through {result.nextIncomeDateIso}. This is not financial advice.
                </p>

                <div className="spendable-cash-detail-group">
                  <h4>Selected balances</h4>
                  <ul className="financial-rows">
                    {result.selectedAccounts.map((selectedAccount) => (
                      <li key={selectedAccount.accountId}>
                        <span>
                          {selectedAccount.accountName} · Balance as of {selectedAccount.balanceDateIso}
                          {selectedAccount.isEstimate ? " · Monthly estimate" : ""}
                        </span>
                        <span className="financial-row-value">
                          {formatAmount(selectedAccount.balanceNokMinor, "NOK")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="spendable-cash-detail-group">
                  <h4>Included movements before income</h4>
                  {result.lineItems.length === 0 ? (
                    <p className="field-help">No additional booked, pending, or scheduled outflows were included.</p>
                  ) : (
                    <ul className="spendable-cash-line-items">
                      {result.lineItems.map((item, index) => (
                        <li key={`${item.kind}:${item.id}:${item.dateIso}:${index}`}>
                          <span>
                            {item.dateIso} · {item.description} · {item.kind.replaceAll("-", " ")}
                          </span>
                          <span className="financial-row-value">
                            {formatAmount(item.amountMinor, item.currencyCode)}
                            {item.currencyCode === "NOK"
                              ? ""
                              : ` · ${formatAmount(item.amountNokMinor, "NOK")}`}
                            {item.isEstimate ? " · Monthly estimate" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="spendable-cash-detail-group">
                  <h4>Native-currency subtotals</h4>
                  <ul className="spendable-cash-line-items">
                    {result.nativeSubtotals.map((subtotal) => (
                      <li key={subtotal.currencyCode}>
                        <span>{subtotal.currencyCode} balance · booked · pending · commitments</span>
                        <span className="financial-row-value">
                          {formatAmount(subtotal.balanceMinor, subtotal.currencyCode)} ·{" "}
                          {formatAmount(subtotal.bookedMinor, subtotal.currencyCode)} ·{" "}
                          {formatAmount(subtotal.pendingMinor, subtotal.currencyCode)} ·{" "}
                          {formatAmount(subtotal.commitmentsMinor, subtotal.currencyCode)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
