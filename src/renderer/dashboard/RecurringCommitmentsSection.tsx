import React from "react";
import { parseCurrencyAmountMinor } from "../workspaces/parseCurrencyAmountMinor.js";
import type {
  RecurringCommitment,
  RecurringCommitmentInput,
  RecurringCommitmentPaymentCandidate,
  RecurringCommitmentPaymentLinkInput,
  RecurringCommitmentSchedule,
  RecurringCommitmentScheduleOccurrence,
} from "../../domain/types.js";

const amountFormatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "medium",
  timeZone: "UTC",
});

interface RecurringCommitmentsSectionProps {
  isActive: boolean;
  refreshKey: number;
}

interface CommitmentDraft {
  description: string;
  currencyCode: string;
  amount: string;
  isVariable: boolean;
  cadence: RecurringCommitmentInput["cadence"];
  firstDueDateIso: string;
  activeFromIso: string;
  activeUntilIso: string;
}

function localDateInputValue(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function emptyDraft(): CommitmentDraft {
  const today = localDateInputValue();
  return {
    description: "",
    currencyCode: "NOK",
    amount: "",
    isVariable: false,
    cadence: "monthly",
    firstDueDateIso: today,
    activeFromIso: today,
    activeUntilIso: "",
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatCurrencyAmount(amountMinor: number, currencyCode: string): string {
  const amount = amountFormatter.format(Math.abs(amountMinor) / 100);
  const currencyAmount = currencyCode === "NOK" ? `${amount} kr` : `${currencyCode} ${amount}`;
  if (amountMinor < 0) return `-${currencyAmount}`;
  return currencyAmount;
}

function formatDate(dateIso: string): string {
  return dateFormatter.format(new Date(`${dateIso}T00:00:00.000Z`));
}

function commitmentStatusLabel(status: RecurringCommitment["status"]): string {
  switch (status) {
    case "suggested":
      return "Suggested";
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "ended":
      return "Ended";
  }
}

function dueStatusLabel(occurrence: RecurringCommitmentScheduleOccurrence): string {
  switch (occurrence.dueStatus) {
    case "upcoming":
      return "Upcoming";
    case "due":
      return "Due today";
    case "past-due":
      return "Past due";
  }
}

function paymentStatusLabel(occurrence: RecurringCommitmentScheduleOccurrence): string {
  if (occurrence.paymentStatus === "unmatched") return "Unmatched";
  return occurrence.linkedTransactionId === undefined
    ? "Matched to pending payment"
    : "Matched to booked transaction";
}

function occurrenceKey(occurrence: RecurringCommitmentScheduleOccurrence): string {
  return `${occurrence.commitmentId}:${occurrence.dueDateIso}`;
}

function paymentCandidateValue(sourceType: "transaction" | "pending", id: string): string {
  return `${sourceType}:${id}`;
}

export function RecurringCommitmentsSection({
  isActive,
  refreshKey,
}: RecurringCommitmentsSectionProps): React.JSX.Element {
  const [schedule, setSchedule] = React.useState<RecurringCommitmentSchedule | null>(null);
  const [draft, setDraft] = React.useState<CommitmentDraft>(emptyDraft);
  const [editingCommitment, setEditingCommitment] = React.useState<RecurringCommitment | null>(null);
  const [selectedPayments, setSelectedPayments] = React.useState<Record<string, string>>({});
  const [paymentSearches, setPaymentSearches] = React.useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const scheduleRequestId = React.useRef(0);

  const loadSchedule = React.useCallback(async (): Promise<void> => {
    const requestId = ++scheduleRequestId.current;
    const loadedSchedule = await window.budgetApi.recurringCommitments.getSchedule(
      new Date().toISOString()
    );
    if (requestId === scheduleRequestId.current) setSchedule(loadedSchedule);
  }, []);

  const refreshSchedule = React.useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      await loadSchedule();
    } catch (loadError: unknown) {
      setError(errorMessage(loadError, "Unable to load local recurring commitments."));
    } finally {
      setIsLoading(false);
    }
  }, [loadSchedule]);

  React.useEffect(() => {
    if (isActive) void refreshSchedule();
  }, [isActive, refreshKey, refreshSchedule]);

  async function runMutation(
    mutation: () => Promise<unknown>,
    successMessage: string,
    fallbackError: string
  ): Promise<boolean> {
    setIsSaving(true);
    setError(null);
    setStatusMessage(null);
    try {
      await mutation();
    } catch (mutationError: unknown) {
      setError(errorMessage(mutationError, fallbackError));
      setIsSaving(false);
      return false;
    }

    setSelectedPayments({});
    setPaymentSearches({});
    setStatusMessage(successMessage);
    try {
      await loadSchedule();
    } catch (loadError: unknown) {
      setError(
        `Saved locally, but the schedule could not be refreshed: ${
          errorMessage(loadError, "Unknown refresh error.")
        }`
      );
    }
    setIsSaving(false);
    return true;
  }

  function beginEdit(commitment: RecurringCommitment): void {
    setEditingCommitment(commitment);
    setDraft({
      description: commitment.description,
      currencyCode: commitment.currencyCode,
      amount: commitment.amountMinor === null ? "" : (commitment.amountMinor / 100).toFixed(2),
      isVariable: commitment.isVariable,
      cadence: commitment.cadence,
      firstDueDateIso: commitment.firstDueDateIso,
      activeFromIso: commitment.activeFromIso,
      activeUntilIso: commitment.activeUntilIso ?? "",
    });
    setError(null);
    setStatusMessage(null);
  }

  function cancelEdit(): void {
    setEditingCommitment(null);
    setDraft(emptyDraft());
    setError(null);
    setStatusMessage(null);
  }

  async function saveCommitment(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const amountText = draft.amount.trim();
    const amountMinor = amountText === "" ? null : parseCurrencyAmountMinor(amountText);
    if (amountText !== "" && (amountMinor === null || amountMinor <= 0)) {
      setError("Enter a positive amount with up to two decimal places.");
      return;
    }
    if (!draft.isVariable && amountMinor === null) {
      setError("Enter an amount or mark the commitment as variable.");
      return;
    }

    const input: RecurringCommitmentInput = {
      description: draft.description.trim(),
      currencyCode: draft.currencyCode.trim().toUpperCase(),
      amountMinor,
      isVariable: draft.isVariable,
      cadence: draft.cadence,
      firstDueDateIso: draft.firstDueDateIso,
      activeFromIso: draft.activeFromIso,
      ...(draft.activeUntilIso === "" ? {} : { activeUntilIso: draft.activeUntilIso }),
    };
    const editing = editingCommitment;
    const saved = await runMutation(
      () => editing === null
        ? window.budgetApi.recurringCommitments.create(input)
        : window.budgetApi.recurringCommitments.update(editing.id, input),
      editing === null ? "Commitment saved as a suggestion." : "Commitment changes saved.",
      "Unable to save the recurring commitment."
    );
    if (saved) {
      setEditingCommitment(null);
      setDraft(emptyDraft());
    }
  }

  async function confirmCommitment(commitment: RecurringCommitment): Promise<void> {
    await runMutation(
      () => window.budgetApi.recurringCommitments.confirm(commitment.id),
      "Commitment confirmed and added to the schedule.",
      "Unable to confirm the recurring commitment."
    );
  }

  async function pauseCommitment(commitment: RecurringCommitment): Promise<void> {
    await runMutation(
      () => window.budgetApi.recurringCommitments.pause(commitment.id),
      "Commitment paused.",
      "Unable to pause the recurring commitment."
    );
  }

  async function resumeCommitment(commitment: RecurringCommitment): Promise<void> {
    await runMutation(
      () => window.budgetApi.recurringCommitments.resume(commitment.id),
      "Commitment resumed.",
      "Unable to resume the recurring commitment."
    );
  }

  async function endCommitment(commitment: RecurringCommitment): Promise<void> {
    await runMutation(
      () => window.budgetApi.recurringCommitments.end(commitment.id),
      "Commitment ended.",
      "Unable to end the recurring commitment."
    );
  }

  async function linkPayment(occurrence: RecurringCommitmentScheduleOccurrence): Promise<void> {
    const selected = selectedPayments[occurrenceKey(occurrence)];
    if (selected === undefined) {
      setError("Choose a local payment to match to this occurrence.");
      return;
    }
    const separator = selected.indexOf(":");
    if (separator <= 0) {
      setError("Choose a valid local payment to match to this occurrence.");
      return;
    }
    const sourceType = selected.slice(0, separator);
    const paymentId = selected.slice(separator + 1);
    if (
      paymentId.length === 0 ||
      (sourceType !== "transaction" && sourceType !== "pending")
    ) {
      setError("Choose a valid local payment to match to this occurrence.");
      return;
    }
    const input: RecurringCommitmentPaymentLinkInput = {
      commitmentId: occurrence.commitmentId,
      occurrenceDateIso: occurrence.dueDateIso,
      ...(sourceType === "transaction"
        ? { transactionId: paymentId }
        : { pendingObservationId: paymentId }),
    };
    await runMutation(
      () => window.budgetApi.recurringCommitments.linkPayment(input),
      "Payment matched to the scheduled occurrence.",
      "Unable to match the local payment."
    );
  }

  async function confirmPriceChange(
    commitmentId: string,
    newAmountMinor: number
  ): Promise<void> {
    await runMutation(
      () => window.budgetApi.recurringCommitments.confirmPriceChange(commitmentId, newAmountMinor),
      "Recurring amount updated after confirmation.",
      "Unable to confirm the observed price change."
    );
  }

  const commitments = schedule?.commitments ?? [];
  const occurrences = schedule?.occurrences ?? [];
  const paymentCandidatesByCurrency = React.useMemo(() => {
    const candidatesByCurrency = new Map<string, RecurringCommitmentPaymentCandidate[]>();
    for (const candidate of schedule?.paymentCandidates ?? []) {
      const candidates = candidatesByCurrency.get(candidate.currencyCode) ?? [];
      candidates.push(candidate);
      candidatesByCurrency.set(candidate.currencyCode, candidates);
    }
    return candidatesByCurrency;
  }, [schedule]);

  return (
    <section
      className="recurring-commitments-section"
      aria-label="Recurring commitments"
      aria-busy={isLoading || isSaving}
    >
      <header className="recurring-commitments-heading">
        <div>
          <h2>Recurring commitments</h2>
          <p>Confirmed bills stay separate from booked transactions; variable amounts and missing NOK rates remain explicit.</p>
        </div>
        <button
          type="button"
          className="action-secondary"
          onClick={() => void refreshSchedule()}
          disabled={isLoading || isSaving}
        >
          Refresh commitments
        </button>
      </header>

      {error !== null && <p className="recurring-commitment-message is-error" role="alert">{error}</p>}
      {statusMessage !== null && <p className="recurring-commitment-message is-success" role="status">{statusMessage}</p>}
      {isLoading && schedule === null && (
        <p className="recurring-commitment-message" role="status">Loading local commitments...</p>
      )}

      <div className="recurring-commitment-layout">
        <form
          className="recurring-commitment-form"
          aria-label="Recurring commitment form"
          onSubmit={(event) => void saveCommitment(event)}
        >
          <h3>{editingCommitment === null ? "Add a commitment" : "Edit commitment"}</h3>
          <div className="recurring-commitment-fields">
            <label className="recurring-field recurring-field--wide">
              <span>Commitment description</span>
              <input
                type="text"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                required
              />
            </label>
            <label className="recurring-field">
              <span>Commitment currency</span>
              <input
                type="text"
                list="recurring-currency-options"
                value={draft.currencyCode}
                onChange={(event) => setDraft({
                  ...draft,
                  currencyCode: event.target.value.toUpperCase(),
                })}
                maxLength={3}
                pattern="[A-Za-z]{3}"
                autoCapitalize="characters"
                title="Use a three-letter currency code, such as NOK or EUR."
                required
                disabled={editingCommitment !== null && editingCommitment.status !== "suggested"}
              />
              <datalist id="recurring-currency-options">
                <option value="NOK" />
                <option value="EUR" />
                <option value="USD" />
                <option value="SEK" />
                <option value="DKK" />
                <option value="GBP" />
                <option value="CHF" />
              </datalist>
            </label>
            <label className="recurring-field">
              <span>Commitment amount or estimate</span>
              <input
                type="text"
                inputMode="decimal"
                value={draft.amount}
                onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                required={!draft.isVariable}
                placeholder="129,00"
                disabled={editingCommitment !== null && editingCommitment.status !== "suggested"}
              />
            </label>
            <label className="recurring-variable-field">
              <input
                type="checkbox"
                checked={draft.isVariable}
                onChange={(event) => setDraft({ ...draft, isVariable: event.target.checked })}
                disabled={editingCommitment !== null && editingCommitment.status !== "suggested"}
              />
              <span>Variable amount</span>
            </label>
            <label className="recurring-field">
              <span>Recurring cadence</span>
              <select
                value={draft.cadence}
                onChange={(event) => {
                  const cadence = event.target.value;
                  if (cadence !== "monthly" && cadence !== "annual") return;
                  setDraft({ ...draft, cadence });
                }}
              >
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label className="recurring-field">
              <span>First due date</span>
              <input
                type="date"
                value={draft.firstDueDateIso}
                onChange={(event) => setDraft({ ...draft, firstDueDateIso: event.target.value })}
                required
              />
            </label>
            <label className="recurring-field">
              <span>Active from</span>
              <input
                type="date"
                value={draft.activeFromIso}
                onChange={(event) => setDraft({ ...draft, activeFromIso: event.target.value })}
                required
              />
            </label>
            <label className="recurring-field">
              <span>Active until (optional)</span>
              <input
                type="date"
                value={draft.activeUntilIso}
                onChange={(event) => setDraft({ ...draft, activeUntilIso: event.target.value })}
              />
            </label>
          </div>
          {editingCommitment !== null && editingCommitment.status !== "suggested" && (
            <p className="field-help">
              Confirmed amounts cannot be edited here. Review observed payment changes before updating them.
            </p>
          )}
          <div className="action-row">
            <button type="submit" disabled={isSaving}>
              {editingCommitment === null ? "Save as suggestion" : "Save commitment changes"}
            </button>
            {editingCommitment !== null && (
              <button type="button" className="action-secondary" onClick={cancelEdit} disabled={isSaving}>
                Cancel editing
              </button>
            )}
          </div>
        </form>

        <div className="recurring-commitment-results">
          <section aria-label="Commitment records">
            <h3>Commitment records</h3>
            {commitments.length === 0 ? (
              <p>No recurring commitments have been recorded yet.</p>
            ) : (
              <ul className="recurring-commitment-list">
                {commitments.map((commitment) => (
                  <li key={commitment.id}>
                    <fieldset
                      className="recurring-commitment-record"
                      role="group"
                      aria-label={`Commitment ${commitment.description}`}
                    >
                      <legend>Commitment {commitment.description}</legend>
                      <dl className="recurring-record-details">
                        <div>
                          <dt>Status</dt>
                          <dd>{commitmentStatusLabel(commitment.status)}</dd>
                        </div>
                        <div>
                          <dt>Amount</dt>
                          <dd>
                            {commitment.amountMinor === null
                              ? "Amount unknown"
                              : formatCurrencyAmount(commitment.amountMinor, commitment.currencyCode)}
                            {commitment.isVariable ? " · Estimate" : ""}
                          </dd>
                        </div>
                        <div>
                          <dt>Cadence</dt>
                          <dd>{commitment.cadence === "monthly" ? "Monthly" : "Annual"}</dd>
                        </div>
                        <div>
                          <dt>First due</dt>
                          <dd>{formatDate(commitment.firstDueDateIso)}</dd>
                        </div>
                        <div>
                          <dt>Active period</dt>
                          <dd>
                            {formatDate(commitment.activeFromIso)}
                            {commitment.activeUntilIso === undefined
                              ? " onward"
                              : ` to ${formatDate(commitment.activeUntilIso)}`}
                          </dd>
                        </div>
                      </dl>
                      <div className="action-row recurring-commitment-actions">
                        {commitment.status === "suggested" && (
                          <button
                            type="button"
                            onClick={() => void confirmCommitment(commitment)}
                            disabled={isSaving}
                          >
                            Confirm commitment
                          </button>
                        )}
                        {commitment.status !== "ended" && (
                          <button
                            type="button"
                            className="action-secondary"
                            onClick={() => beginEdit(commitment)}
                            disabled={isSaving}
                          >
                            Edit commitment
                          </button>
                        )}
                        {commitment.status === "active" && (
                          <button
                            type="button"
                            className="action-secondary"
                            onClick={() => void pauseCommitment(commitment)}
                            disabled={isSaving}
                          >
                            Pause commitment
                          </button>
                        )}
                        {commitment.status === "paused" && (
                          <button
                            type="button"
                            className="action-secondary"
                            onClick={() => void resumeCommitment(commitment)}
                            disabled={isSaving}
                          >
                            Resume commitment
                          </button>
                        )}
                        {commitment.status !== "ended" && (
                          <button
                            type="button"
                            className="action-secondary"
                            onClick={() => void endCommitment(commitment)}
                            disabled={isSaving}
                          >
                            End commitment
                          </button>
                        )}
                      </div>
                    </fieldset>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Recurring schedule">
            <h3>Upcoming and past-due schedule</h3>
            {occurrences.length === 0 ? (
              <p>Confirmed active commitments will appear here. Suggestions are not scheduled.</p>
            ) : (
              <ul className="recurring-occurrence-list">
                {occurrences.map((occurrence) => {
                  const key = occurrenceKey(occurrence);
                  const candidates =
                    paymentCandidatesByCurrency.get(occurrence.nativeCurrencyCode) ?? [];
                  const searchText = (paymentSearches[key] ?? "").trim().toLowerCase();
                  const matchingCandidates = searchText.length < 2
                    ? []
                    : candidates.filter((candidate) =>
                        `${candidate.description} ${candidate.dateIso} ${
                          formatCurrencyAmount(Math.abs(candidate.amountMinor), candidate.currencyCode)
                        } ${candidate.sourceType}`.toLowerCase().includes(searchText)
                      );
                  const visibleCandidates = matchingCandidates.slice(0, 50);
                  return (
                    <li key={key}>
                      <fieldset
                        className="recurring-commitment-occurrence"
                        role="group"
                        aria-label={`Occurrence ${occurrence.description} due ${occurrence.dueDateIso}`}
                      >
                        <legend>
                          Occurrence {occurrence.description} due {occurrence.dueDateIso}
                        </legend>
                        <dl className="recurring-occurrence-details">
                          <div>
                            <dt>Due date</dt>
                            <dd>{formatDate(occurrence.dueDateIso)}</dd>
                          </div>
                          <div>
                            <dt>
                              {occurrence.nativeCurrencyCode === "NOK"
                                ? "Amount (NOK)"
                                : "Native amount"}
                            </dt>
                            <dd>
                              {occurrence.nativeAmountMinor === null
                                ? "Amount unknown"
                                : formatCurrencyAmount(
                                    occurrence.nativeAmountMinor,
                                    occurrence.nativeCurrencyCode
                                  )}
                            </dd>
                          </div>
                          {occurrence.nativeCurrencyCode !== "NOK" && (
                            <div>
                              <dt>NOK equivalent</dt>
                              <dd>
                                {occurrence.conversionStatus === "incomplete" ||
                                  occurrence.nokAmountMinor === null
                                  ? "NOK conversion incomplete"
                                  : formatCurrencyAmount(occurrence.nokAmountMinor, "NOK")}
                              </dd>
                            </div>
                          )}
                          <div>
                            <dt>Due status</dt>
                            <dd>
                              <span className={`recurring-state recurring-state--${occurrence.dueStatus}`}>
                                {dueStatusLabel(occurrence)}
                              </span>
                            </dd>
                          </div>
                          <div>
                            <dt>Payment status</dt>
                            <dd>
                              <span className={`recurring-state recurring-state--${occurrence.paymentStatus}`}>
                                {paymentStatusLabel(occurrence)}
                              </span>
                            </dd>
                          </div>
                          {occurrence.isEstimate && (
                            <div>
                              <dt>Amount basis</dt>
                              <dd>
                                Estimate — not a booked transaction
                              </dd>
                            </div>
                          )}
                        </dl>
                        {occurrence.paymentStatus === "unmatched" ? (
                          <div className="recurring-payment-controls">
                            <label className="recurring-field">
                              <span>Search local payments for {occurrence.dueDateIso}</span>
                              <input
                                type="search"
                                value={paymentSearches[key] ?? ""}
                                onChange={(event) => {
                                  setPaymentSearches({
                                    ...paymentSearches,
                                    [key]: event.target.value,
                                  });
                                  setSelectedPayments({
                                    ...selectedPayments,
                                    [key]: "",
                                  });
                                }}
                                placeholder="Search payments"
                                disabled={isSaving}
                              />
                            </label>
                            <label className="recurring-field">
                              <span>Payment for {occurrence.dueDateIso}</span>
                              <select
                                value={selectedPayments[key] ?? ""}
                                onChange={(event) => setSelectedPayments({
                                  ...selectedPayments,
                                  [key]: event.target.value,
                                })}
                                disabled={isSaving}
                              >
                                <option value="">Choose a local payment</option>
                                {visibleCandidates.map((candidate) => (
                                  <option
                                    key={`${candidate.sourceType}:${candidate.id}`}
                                    value={paymentCandidateValue(candidate.sourceType, candidate.id)}
                                  >
                                    {formatDate(candidate.dateIso)} — {candidate.description} —{" "}
                                    {formatCurrencyAmount(
                                      Math.abs(candidate.amountMinor),
                                      candidate.currencyCode
                                    )}{" "}
                                    ({candidate.sourceType === "pending" ? "pending" : "booked"})
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              className="action-secondary"
                              onClick={() => void linkPayment(occurrence)}
                              disabled={isSaving || !selectedPayments[key]}
                            >
                              Link payment
                            </button>
                            {candidates.length === 0 ? (
                              <p className="field-help">
                                No unlinked local payments in {occurrence.nativeCurrencyCode} are available.
                              </p>
                            ) : searchText.length < 2 ? (
                              <p className="field-help">
                                Search local payment history by description, date, or amount.
                              </p>
                            ) : matchingCandidates.length === 0 ? (
                              <p className="field-help">No local payments match that search.</p>
                            ) : matchingCandidates.length > visibleCandidates.length ? (
                              <p className="field-help">
                                Showing the first 50 of {matchingCandidates.length} matches. Refine the search.
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="field-help">{paymentStatusLabel(occurrence)} is linked once to this scheduled obligation.</p>
                        )}
                      </fieldset>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {schedule?.priceChanges.map((priceChange) => (
            <section
              key={priceChange.commitmentId}
              className="recurring-price-review"
              aria-label={`Price change review ${priceChange.description}`}
            >
              <h3>Price change review: {priceChange.description}</h3>
              <dl className="recurring-price-details">
                <div>
                  <dt>Previous confirmed amount</dt>
                  <dd>{formatCurrencyAmount(priceChange.previousAmountMinor, priceChange.currencyCode)}</dd>
                </div>
                <div>
                  <dt>Latest confirmed amount</dt>
                  <dd>{formatCurrencyAmount(priceChange.observedAmountMinor, priceChange.currencyCode)}</dd>
                </div>
                <div>
                  <dt>Difference</dt>
                  <dd>
                    {priceChange.differenceMinor > 0 ? "+" : ""}
                    {formatCurrencyAmount(priceChange.differenceMinor, priceChange.currencyCode)}
                  </dd>
                </div>
              </dl>
              <p>Commitment amounts change only after you confirm this observed price.</p>
              <button
                type="button"
                onClick={() => void confirmPriceChange(
                  priceChange.commitmentId,
                  priceChange.observedAmountMinor
                )}
                disabled={isSaving}
              >
                Confirm new amount
              </button>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
