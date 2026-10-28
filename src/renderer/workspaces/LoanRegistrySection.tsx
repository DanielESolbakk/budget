import React from "react";
import {
  LoanRecordValidationError,
  validateLoanBalanceInput,
  validateLoanRecordInput,
} from "../../domain/loanRecordValidation.js";
import type {
  LoanBalanceValidationField,
  LoanRecordValidationField,
} from "../../domain/loanRecordValidation.js";
import type {
  LoanBalanceInput,
  LoanPaymentFrequency,
  LoanRecordInput,
  LoanWithBalances,
  PropertyRecord,
} from "../../domain/types.js";
import { parseCurrencyAmountMinor } from "./parseCurrencyAmountMinor.js";

interface LoanRegistrySectionProps {
  isActive: boolean;
  refreshRevision: number;
}

interface LoanDraft {
  label: string;
  principal: string;
  annualInterestRate: string;
  termYears: string;
  paymentAmount: string;
  paymentFrequency: LoanPaymentFrequency;
  currencyCode: string;
  propertyId: string;
}

interface BalanceDraft {
  effectiveDateIso: string;
  amount: string;
}

interface FormError {
  message: string;
  field?: LoanRecordValidationField | LoanBalanceValidationField;
}

const EMPTY_LOAN_DRAFT: LoanDraft = {
  label: "",
  principal: "",
  annualInterestRate: "",
  termYears: "",
  paymentAmount: "",
  paymentFrequency: "monthly",
  currencyCode: "NOK",
  propertyId: "",
};

const EMPTY_BALANCE_DRAFT: BalanceDraft = {
  effectiveDateIso: "",
  amount: "",
};

const PAYMENT_FREQUENCY_LABELS: Record<LoanPaymentFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

const amountFormatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const timestampFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "short",
  timeStyle: "short",
});

function parseTermMonths(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const years = Number(normalized);
  const termMonths = years * 12;
  return Number.isSafeInteger(termMonths) && termMonths > 0 ? termMonths : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatAmount(amountMinor: number, currencyCode: string): string {
  return `${currencyCode} ${amountFormatter.format(amountMinor / 100)}`;
}

function formatTerm(termMonths: number): string {
  const years = Math.floor(termMonths / 12);
  const months = termMonths % 12;
  if (months === 0) return `${years} ${years === 1 ? "year" : "years"}`;
  if (years === 0) return `${months} ${months === 1 ? "month" : "months"}`;
  return `${years} ${years === 1 ? "year" : "years"}, ${months} ${months === 1 ? "month" : "months"}`;
}

function formatRecordedAt(recordedAtIso: string): string {
  return timestampFormatter.format(new Date(recordedAtIso));
}

function validationError(error: unknown, fallback: string): FormError {
  if (error instanceof LoanRecordValidationError) {
    return { field: error.field, message: error.message };
  }
  return { message: errorMessage(error, fallback) };
}

export function LoanRegistrySection({
  isActive,
  refreshRevision,
}: LoanRegistrySectionProps): React.JSX.Element {
  const [loans, setLoans] = React.useState<LoanWithBalances[]>([]);
  const [properties, setProperties] = React.useState<PropertyRecord[]>([]);
  const [loanDraft, setLoanDraft] = React.useState<LoanDraft>(EMPTY_LOAN_DRAFT);
  const [balanceDrafts, setBalanceDrafts] = React.useState<Record<string, BalanceDraft>>({});
  const [balanceErrors, setBalanceErrors] = React.useState<Record<string, FormError>>({});
  const [balanceStatuses, setBalanceStatuses] = React.useState<Record<string, string>>({});
  const [loanError, setLoanError] = React.useState<FormError | null>(null);
  const [loanStatus, setLoanStatus] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isActive) return;
    let active = true;
    setIsLoading(true);
    setLoadError(null);
    Promise.all([
      window.budgetApi.loanRegistry.list(),
      window.budgetApi.propertyRegistry.list(),
    ])
      .then(([loadedLoans, loadedProperties]) => {
        if (!active) return;
        setLoans(loadedLoans);
        setProperties(loadedProperties);
      })
      .catch((loadFailure: unknown) => {
        if (active) {
          setLoadError(errorMessage(loadFailure, "Unable to load local loan records."));
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isActive, refreshRevision, revision]);

  function updateLoanDraft(field: keyof LoanDraft, value: string): void {
    setLoanError(null);
    setLoanStatus(null);
    setLoanDraft((current) => ({ ...current, [field]: value }));
  }

  function updateBalanceDraft(loanId: string, field: keyof BalanceDraft, value: string): void {
    setLoanStatus(null);
    setBalanceErrors((current) => {
      const next = { ...current };
      delete next[loanId];
      return next;
    });
    setBalanceStatuses((current) => {
      const next = { ...current };
      delete next[loanId];
      return next;
    });
    setBalanceDrafts((current) => ({
      ...current,
      [loanId]: {
        ...(current[loanId] ?? EMPTY_BALANCE_DRAFT),
        [field]: value,
      },
    }));
  }

  async function addLoan(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSaving || isLoading || loadError !== null) return;
    setLoanError(null);
    setLoanStatus(null);
    if (loanDraft.label.trim().length === 0) {
      setLoanError({ field: "label", message: "Enter a loan label." });
      return;
    }

    const principalMinor = parseCurrencyAmountMinor(loanDraft.principal);
    if (principalMinor === null || principalMinor <= 0) {
      setLoanError({
        field: "principalMinor",
        message: "Enter a positive principal amount with up to two decimal places.",
      });
      return;
    }
    const annualInterestRateBasisPoints = parseCurrencyAmountMinor(loanDraft.annualInterestRate);
    if (annualInterestRateBasisPoints === null) {
      setLoanError({
        field: "annualInterestRateBasisPoints",
        message: "Enter an annual interest rate from 0 to 100 percent.",
      });
      return;
    }
    const termMonths = parseTermMonths(loanDraft.termYears);
    if (termMonths === null) {
      setLoanError({
        field: "termMonths",
        message: "Enter the loan term in whole years.",
      });
      return;
    }
    const paymentAmountMinor = parseCurrencyAmountMinor(loanDraft.paymentAmount);
    if (paymentAmountMinor === null || paymentAmountMinor <= 0) {
      setLoanError({
        field: "paymentAmountMinor",
        message: "Enter a positive payment amount with up to two decimal places.",
      });
      return;
    }

    let validated: LoanRecordInput;
    try {
      validated = validateLoanRecordInput({
        label: loanDraft.label,
        principalMinor,
        annualInterestRateBasisPoints,
        termMonths,
        paymentAmountMinor,
        paymentFrequency: loanDraft.paymentFrequency,
        currencyCode: loanDraft.currencyCode,
        ...(loanDraft.propertyId.length === 0 ? {} : { propertyId: loanDraft.propertyId }),
      }, properties.map((property) => property.id));
    } catch (validationFailure: unknown) {
      setLoanError(validationError(validationFailure, "Unable to validate the loan."));
      return;
    }

    setIsSaving(true);
    try {
      await window.budgetApi.loanRegistry.create(validated);
      setLoanDraft(EMPTY_LOAN_DRAFT);
      setLoanStatus("Loan added. Add an actual balance to begin its history.");
      setRevision((current) => current + 1);
    } catch (saveFailure: unknown) {
      setLoanError(validationError(saveFailure, "Unable to add the loan."));
    } finally {
      setIsSaving(false);
    }
  }

  async function addBalance(
    event: React.FormEvent<HTMLFormElement>,
    loan: LoanWithBalances
  ): Promise<void> {
    event.preventDefault();
    if (isSaving || isLoading || loadError !== null) return;
    setLoanStatus(null);
    const draft = balanceDrafts[loan.id] ?? EMPTY_BALANCE_DRAFT;
    const amountMinor = parseCurrencyAmountMinor(draft.amount);
    if (amountMinor === null) {
      setBalanceErrors((current) => ({
        ...current,
        [loan.id]: {
          field: "amountMinor",
          message: "Enter a non-negative balance with up to two decimal places.",
        },
      }));
      return;
    }

    let validated: LoanBalanceInput;
    try {
      validated = validateLoanBalanceInput({
        loanId: loan.id,
        effectiveDateIso: draft.effectiveDateIso,
        amountMinor,
      });
    } catch (validationFailure: unknown) {
      setBalanceErrors((current) => ({
        ...current,
        [loan.id]: validationError(validationFailure, "Unable to validate the balance."),
      }));
      return;
    }

    setBalanceErrors((current) => {
      const next = { ...current };
      delete next[loan.id];
      return next;
    });
    setBalanceStatuses((current) => {
      const next = { ...current };
      delete next[loan.id];
      return next;
    });
    setIsSaving(true);
    try {
      await window.budgetApi.loanRegistry.appendBalance(validated);
      setBalanceDrafts((current) => ({
        ...current,
        [loan.id]: { ...draft, effectiveDateIso: "", amount: "" },
      }));
      setBalanceStatuses((current) => ({
        ...current,
        [loan.id]: `Actual balance added for ${loan.label}.`,
      }));
      setRevision((current) => current + 1);
    } catch (saveFailure: unknown) {
      setBalanceErrors((current) => ({
        ...current,
        [loan.id]: validationError(saveFailure, "Unable to add the loan balance."),
      }));
    } finally {
      setIsSaving(false);
    }
  }

  const loanErrorId = "loan-create-error";

  return (
    <section className="property-registry-section loan-registry-section" aria-label="Loan registry">
      <header className="property-registry-heading">
        <h3>Loan registry</h3>
        <p>Keep loan terms and dated actual balances separate from forecast projections.</p>
      </header>
      <form className="loan-create-form" aria-label="Add loan" onSubmit={(event) => void addLoan(event)}>
        <label>
          Loan label
          <input
            autoComplete="off"
            aria-invalid={loanError?.field === "label" ? true : undefined}
            aria-describedby={loanError?.field === "label" ? loanErrorId : undefined}
            maxLength={100}
            onChange={(event) => updateLoanDraft("label", event.currentTarget.value)}
            value={loanDraft.label}
          />
        </label>
        <label>
          Principal amount
          <input
            inputMode="decimal"
            aria-invalid={loanError?.field === "principalMinor" ? true : undefined}
            aria-describedby={loanError?.field === "principalMinor" ? loanErrorId : undefined}
            onChange={(event) => updateLoanDraft("principal", event.currentTarget.value)}
            value={loanDraft.principal}
          />
        </label>
        <label>
          Annual interest rate (%)
          <input
            inputMode="decimal"
            aria-invalid={loanError?.field === "annualInterestRateBasisPoints" ? true : undefined}
            aria-describedby={loanError?.field === "annualInterestRateBasisPoints" ? loanErrorId : undefined}
            onChange={(event) => updateLoanDraft("annualInterestRate", event.currentTarget.value)}
            value={loanDraft.annualInterestRate}
          />
        </label>
        <label>
          Term (years)
          <input
            inputMode="numeric"
            aria-invalid={loanError?.field === "termMonths" ? true : undefined}
            aria-describedby={loanError?.field === "termMonths" ? loanErrorId : undefined}
            onChange={(event) => updateLoanDraft("termYears", event.currentTarget.value)}
            value={loanDraft.termYears}
          />
        </label>
        <label>
          Regular payment amount
          <input
            inputMode="decimal"
            aria-invalid={loanError?.field === "paymentAmountMinor" ? true : undefined}
            aria-describedby={loanError?.field === "paymentAmountMinor" ? loanErrorId : undefined}
            onChange={(event) => updateLoanDraft("paymentAmount", event.currentTarget.value)}
            value={loanDraft.paymentAmount}
          />
        </label>
        <label>
          Payment frequency
          <select
            aria-invalid={loanError?.field === "paymentFrequency" ? true : undefined}
            aria-describedby={loanError?.field === "paymentFrequency" ? loanErrorId : undefined}
            onChange={(event) => updateLoanDraft(
              "paymentFrequency",
              event.currentTarget.value as LoanPaymentFrequency
            )}
            value={loanDraft.paymentFrequency}
          >
            {Object.entries(PAYMENT_FREQUENCY_LABELS).map(([frequency, label]) => (
              <option key={frequency} value={frequency}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Currency code
          <input
            autoCapitalize="characters"
            aria-invalid={loanError?.field === "currencyCode" ? true : undefined}
            aria-describedby={loanError?.field === "currencyCode" ? loanErrorId : undefined}
            maxLength={3}
            onChange={(event) => updateLoanDraft("currencyCode", event.currentTarget.value)}
            value={loanDraft.currencyCode}
          />
        </label>
        <label>
          Property (optional)
          <select
            aria-invalid={loanError?.field === "propertyId" ? true : undefined}
            aria-describedby={loanError?.field === "propertyId" ? loanErrorId : undefined}
            onChange={(event) => updateLoanDraft("propertyId", event.currentTarget.value)}
            value={loanDraft.propertyId}
          >
            <option value="">Unsecured</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>{property.label}</option>
            ))}
          </select>
        </label>
        <button disabled={isSaving || isLoading || loadError !== null} type="submit">
          Add loan
        </button>
      </form>
      {loanError !== null && (
        <p id={loanErrorId} className="property-registry-message" role="alert">
          {loanError.message}
        </p>
      )}
      {loanStatus !== null && (
        <p className="property-registry-message" role="status">{loanStatus}</p>
      )}
      <p className="property-registry-local-note">
        Loan terms and actual balance history stay on this device and are included in local backup snapshots.
        No rates are substituted and nothing is fetched online.
      </p>
      {loadError !== null && <p className="property-registry-message" role="alert">{loadError}</p>}
      {isLoading ? (
        <p className="property-registry-empty" role="status">Loading loan records...</p>
      ) : loans.length === 0 ? (
        loadError === null && <p className="property-registry-empty">No loans have been recorded.</p>
      ) : (
        <div className="loan-record-list">
          {loans.map((loan) => {
            const balanceDraft = balanceDrafts[loan.id] ?? EMPTY_BALANCE_DRAFT;
            const balanceError = balanceErrors[loan.id];
            const balanceErrorId = `loan-balance-error-${loan.id}`;
            const linkedProperty = loan.propertyId === undefined
              ? undefined
              : properties.find((property) => property.id === loan.propertyId);
            return (
              <section className="loan-record" aria-label={`Loan ${loan.label}`} key={loan.id}>
                <div className="loan-record-heading">
                  <h4>{loan.label}</h4>
                  <span>Actual balance history</span>
                </div>
                <dl className="loan-terms">
                  <div>
                    <dt>Principal</dt>
                    <dd>{formatAmount(loan.principalMinor, loan.currencyCode)}</dd>
                  </div>
                  <div>
                    <dt>Annual interest rate</dt>
                    <dd>{amountFormatter.format(loan.annualInterestRateBasisPoints / 100)}%</dd>
                  </div>
                  <div>
                    <dt>Term</dt>
                    <dd>{formatTerm(loan.termMonths)}</dd>
                  </div>
                  <div>
                    <dt>Regular payment</dt>
                    <dd>
                      {formatAmount(loan.paymentAmountMinor, loan.currencyCode)}
                      {" / "}
                      {PAYMENT_FREQUENCY_LABELS[loan.paymentFrequency].toLowerCase()}
                    </dd>
                  </div>
                  <div>
                    <dt>Property</dt>
                    <dd>{linkedProperty?.label ?? "Unsecured"}</dd>
                  </div>
                </dl>
                <form
                  className="loan-balance-form"
                  aria-label={`Add balance for ${loan.label}`}
                  onSubmit={(event) => void addBalance(event, loan)}
                >
                  <label>
                    Effective date
                    <input
                      type="date"
                      aria-invalid={balanceError?.field === "effectiveDateIso" ? true : undefined}
                      aria-describedby={balanceError?.field === "effectiveDateIso"
                        ? balanceErrorId
                        : undefined}
                      onChange={(event) => updateBalanceDraft(
                        loan.id,
                        "effectiveDateIso",
                        event.currentTarget.value
                      )}
                      value={balanceDraft.effectiveDateIso}
                    />
                  </label>
                  <label>
                    Current balance
                    <input
                      inputMode="decimal"
                      aria-invalid={balanceError?.field === "amountMinor" ? true : undefined}
                      aria-describedby={balanceError?.field === "amountMinor"
                        ? balanceErrorId
                        : undefined}
                      onChange={(event) => updateBalanceDraft(
                        loan.id,
                        "amount",
                        event.currentTarget.value
                      )}
                      value={balanceDraft.amount}
                    />
                  </label>
                  <button disabled={isSaving || isLoading || loadError !== null} type="submit">
                    Add balance
                  </button>
                </form>
                {balanceError !== undefined && (
                  <p id={balanceErrorId} className="property-registry-message" role="alert">
                    {balanceError.message}
                  </p>
                )}
                {balanceStatuses[loan.id] !== undefined && (
                  <p className="property-registry-message" role="status">
                    {balanceStatuses[loan.id]}
                  </p>
                )}
                {loan.balances.length === 0 && (
                  <p className="property-registry-empty">
                    No actual balances recorded. Forecasts remain separate.
                  </p>
                )}
                <div className="loan-balance-table-wrap">
                  <table aria-label="Balance history">
                    <thead>
                      <tr>
                        <th scope="col">Effective date</th>
                        <th scope="col">Recorded at</th>
                        <th scope="col">Actual balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loan.balances.map((balance) => (
                        <tr key={balance.id}>
                          <td>
                            <time dateTime={balance.effectiveDateIso}>{balance.effectiveDateIso}</time>
                          </td>
                          <td>
                            <time dateTime={balance.recordedAtIso}>
                              {formatRecordedAt(balance.recordedAtIso)}
                            </time>
                          </td>
                          <td className="loan-balance-value">
                            {formatAmount(balance.amountMinor, balance.currencyCode)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
