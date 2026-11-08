import React from "react";
import { DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS } from "../../../domain/householdShareValidation.js";
import type {
  LoanBalanceValidationField,
  LoanRecordValidationField,
} from "../../../domain/loanRecordValidation.js";
import {
  validateLoanBalanceInput,
  validateLoanRecordInput
} from "../../../domain/loanRecordValidation.js";
import type {
  LoanBalanceInput,
  LoanRecordInput,
  LoanWithBalances,
  PropertyRecord
} from "../../../domain/types.js";
import { isCurrencyCode } from "../../../domain/types.js";
import { HouseholdShareForm, useHouseholdShareFormStates } from "../HouseholdShareForm.js";
import { parseCurrencyAmountMinor } from "../parseCurrencyAmountMinor.js";
import { errorMessage } from "../registryErrorMessage.js";
import { LoanCreateForm } from "./LoanCreateForm.js";
import { type BalanceDraft, type BalanceFieldErrors, type FocusableFieldRefs, type LoanDraft, type LoanFieldErrors, type LoanRegistrySectionProps, BALANCE_FIELD_ORDER, EMPTY_BALANCE_DRAFT, EMPTY_LOAN_DRAFT, LOAN_DRAFT_VALIDATION_FIELDS, LOAN_FIELD_ORDER, PAYMENT_FREQUENCY_LABELS, amountFormatter, describedBy, formatAmount, formatTerm, parseTermMonths, validationError } from "./loanFormState.js";
import { LoanHistory } from "./LoanHistory.js";
export function LoanRegistrySection({
  isActive,
  refreshRevision,
  onViewProperty,
}: LoanRegistrySectionProps): React.JSX.Element {
  const [loans, setLoans] = React.useState<LoanWithBalances[]>([]);
  const [properties, setProperties] = React.useState<PropertyRecord[]>([]);
  const [selectedLoanId, setSelectedLoanId] = React.useState<string | null>(null);
  const [isCompactLoanDetailOpen, setIsCompactLoanDetailOpen] = React.useState(false);
  const [loanDraft, setLoanDraft] = React.useState<LoanDraft>(EMPTY_LOAN_DRAFT);
  const [shareFormStates, setShareFormStates] = useHouseholdShareFormStates();
  const [balanceDrafts, setBalanceDrafts] = React.useState<Record<string, BalanceDraft>>({});
  const [balanceErrors, setBalanceErrors] = React.useState<Record<string, BalanceFieldErrors>>({});
  const [balanceFormErrors, setBalanceFormErrors] = React.useState<Record<string, string>>({});
  const [balanceStatuses, setBalanceStatuses] = React.useState<Record<string, string>>({});
  const [loanFieldErrors, setLoanFieldErrors] = React.useState<LoanFieldErrors>({});
  const [loanFormError, setLoanFormError] = React.useState<string | null>(null);
  const [loanStatus, setLoanStatus] = React.useState<string | null>(null);
  const [isLoanFormOpen, setIsLoanFormOpen] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const loanFieldRefs = React.useRef<FocusableFieldRefs<LoanRecordValidationField>>({});
  const balanceFieldRefs = React.useRef<
    Record<string, FocusableFieldRefs<LoanBalanceValidationField>>
  >({});
  const loanNavigationButtonRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const loanRecordRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const focusSelectedLoanIdRef = React.useRef<string | null>(null);
  const restoreLoanNavigationFocusIdRef = React.useRef<string | null>(null);
  const addLoanButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const restoreAddLoanFocusRef = React.useRef(false);

  React.useEffect(() => {
    if (isLoanFormOpen || !restoreAddLoanFocusRef.current) return;
    restoreAddLoanFocusRef.current = false;
    addLoanButtonRef.current?.focus();
  }, [isLoanFormOpen]);

  React.useLayoutEffect(() => {
    const loanId = focusSelectedLoanIdRef.current;
    if (loanId === null || isLoanFormOpen) return;
    const loanRecord = loanRecordRefs.current[loanId] ??
      document.getElementById(`loan-record-${loanId}`);
    if (loanRecord === null || loanRecord === undefined) return;
    focusSelectedLoanIdRef.current = null;
    loanRecord.scrollIntoView({ block: "start" });
    loanRecord.focus();
  }, [isLoanFormOpen, loans, selectedLoanId]);

  React.useLayoutEffect(() => {
    if (isCompactLoanDetailOpen) return;
    const loanId = restoreLoanNavigationFocusIdRef.current;
    if (loanId === null) return;
    restoreLoanNavigationFocusIdRef.current = null;
    loanNavigationButtonRefs.current[loanId]?.focus();
  }, [isCompactLoanDetailOpen]);

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
        setSelectedLoanId((selectedId) => (
          selectedId !== null && loadedLoans.some((loan) => loan.id === selectedId)
            ? selectedId
            : loadedLoans[0]?.id ?? null
        ));
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
    const validationField = LOAN_DRAFT_VALIDATION_FIELDS[field];
    setLoanFieldErrors((current) => {
      const next = { ...current };
      delete next[validationField];
      return next;
    });
    setLoanFormError(null);
    setLoanStatus(null);
    setLoanDraft((current) => ({ ...current, [field]: value }));
  }

  function updateBalanceDraft(loanId: string, field: keyof BalanceDraft, value: string): void {
    setLoanStatus(null);
    setBalanceErrors((current) => {
      const next = { ...current };
      const nextLoanErrors = { ...(next[loanId] ?? {}) };
      delete nextLoanErrors[field === "effectiveDateIso" ? "effectiveDateIso" : "amountMinor"];
      if (Object.keys(nextLoanErrors).length === 0) {
        delete next[loanId];
      } else {
        next[loanId] = nextLoanErrors;
      }
      return next;
    });
    setBalanceFormErrors((current) => {
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

  function openLoanForm(): void {
    setLoanFieldErrors({});
    setLoanFormError(null);
    setLoanStatus(null);
    setIsLoanFormOpen(true);
  }

  function selectLoan(loanId: string): void {
    focusSelectedLoanIdRef.current = loanId;
    setSelectedLoanId(loanId);
    setIsCompactLoanDetailOpen(true);
  }

  function showLoanList(loanId: string): void {
    restoreLoanNavigationFocusIdRef.current = loanId;
    setIsCompactLoanDetailOpen(false);
  }

  function cancelLoanForm(): void {
    if (isSaving) return;
    const hasDraft =
      loanDraft.label.trim().length > 0 ||
      loanDraft.principal.length > 0 ||
      loanDraft.annualInterestRate.length > 0 ||
      loanDraft.termYears.length > 0 ||
      loanDraft.paymentAmount.length > 0 ||
      loanDraft.paymentFrequency !== EMPTY_LOAN_DRAFT.paymentFrequency ||
      loanDraft.currencyCode !== EMPTY_LOAN_DRAFT.currencyCode ||
      loanDraft.propertyId.length > 0;
    if (hasDraft && !window.confirm("Discard the unsaved loan details?")) return;

    setLoanDraft(EMPTY_LOAN_DRAFT);
    setLoanFieldErrors({});
    setLoanFormError(null);
    setLoanStatus(null);
    restoreAddLoanFocusRef.current = true;
    setIsLoanFormOpen(false);
  }

  async function addLoan(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSaving || isLoading || loadError !== null) return;
    setLoanFieldErrors({});
    setLoanFormError(null);
    setLoanStatus(null);
    const fieldErrors: LoanFieldErrors = {};
    if (loanDraft.label.trim().length === 0 || loanDraft.label.trim().length > 100) {
      fieldErrors.label = "Enter a loan label up to 100 characters.";
    }
    const principalMinor = parseCurrencyAmountMinor(loanDraft.principal);
    if (principalMinor === null || principalMinor <= 0) {
      fieldErrors.principalMinor =
        "Enter a positive principal amount with up to two decimal places.";
    }
    const annualInterestRateBasisPoints = parseCurrencyAmountMinor(loanDraft.annualInterestRate);
    if (
      annualInterestRateBasisPoints === null ||
      annualInterestRateBasisPoints < 0 ||
      annualInterestRateBasisPoints > 10_000
    ) {
      fieldErrors.annualInterestRateBasisPoints =
        "Enter an annual interest rate from 0 to 100 percent.";
    }
    const termMonths = parseTermMonths(loanDraft.termYears);
    if (termMonths === null) {
      fieldErrors.termMonths = "Enter the loan term in whole years.";
    }
    const paymentAmountMinor = parseCurrencyAmountMinor(loanDraft.paymentAmount);
    if (paymentAmountMinor === null || paymentAmountMinor <= 0) {
      fieldErrors.paymentAmountMinor =
        "Enter a positive payment amount with up to two decimal places.";
    }
    if (!isCurrencyCode(loanDraft.currencyCode)) {
      fieldErrors.currencyCode =
        "Enter a three-letter uppercase currency code, such as NOK or EUR.";
    }
    if (
      loanDraft.propertyId.length > 0 &&
      !properties.some((property) => property.id === loanDraft.propertyId)
    ) {
      fieldErrors.propertyId = "Choose an existing property or leave the loan unlinked.";
    }

    if (
      Object.keys(fieldErrors).length > 0 ||
      principalMinor === null ||
      annualInterestRateBasisPoints === null ||
      termMonths === null ||
      paymentAmountMinor === null
    ) {
      setLoanFieldErrors(fieldErrors);
      const firstInvalidField = LOAN_FIELD_ORDER.find((field) => fieldErrors[field] !== undefined);
      if (firstInvalidField !== undefined) {
        loanFieldRefs.current[firstInvalidField]?.focus();
      }
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
      setLoanFormError(validationError(validationFailure, "Unable to validate the loan.").message);
      return;
    }

    setIsSaving(true);
    try {
      const loan = await window.budgetApi.loanRegistry.create(validated);
      setLoanDraft(EMPTY_LOAN_DRAFT);
      setLoanStatus("Loan added. Add an actual balance to begin its history.");
      selectLoan(loan.id);
      setRevision((current) => current + 1);
      restoreAddLoanFocusRef.current = true;
      setIsLoanFormOpen(false);
    } catch (saveFailure: unknown) {
      setLoanFormError(validationError(saveFailure, "Unable to add the loan.").message);
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
    setBalanceErrors((current) => {
      const next = { ...current };
      delete next[loan.id];
      return next;
    });
    setBalanceFormErrors((current) => {
      const next = { ...current };
      delete next[loan.id];
      return next;
    });
    setBalanceStatuses((current) => {
      const next = { ...current };
      delete next[loan.id];
      return next;
    });
    const draft = balanceDrafts[loan.id] ?? EMPTY_BALANCE_DRAFT;
    const fieldErrors: BalanceFieldErrors = {};
    if (draft.effectiveDateIso.trim().length === 0) {
      fieldErrors.effectiveDateIso = "Choose the date this balance applies to.";
    }
    const amountMinor = parseCurrencyAmountMinor(draft.amount);
    if (amountMinor === null || amountMinor < 0) {
      fieldErrors.amountMinor = "Enter a non-negative balance with up to two decimal places.";
    }
    if (
      Object.keys(fieldErrors).length > 0 ||
      amountMinor === null
    ) {
      setBalanceErrors((current) => ({ ...current, [loan.id]: fieldErrors }));
      const firstInvalidField = BALANCE_FIELD_ORDER.find((field) => fieldErrors[field] !== undefined);
      if (firstInvalidField !== undefined) {
        balanceFieldRefs.current[loan.id]?.[firstInvalidField]?.focus();
      }
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
      const failure = validationError(validationFailure, "Unable to validate the balance.");
      if (failure.field === "effectiveDateIso") {
        setBalanceErrors((current) => ({
          ...current,
          [loan.id]: { effectiveDateIso: failure.message },
        }));
        balanceFieldRefs.current[loan.id]?.effectiveDateIso?.focus();
      } else if (failure.field === "amountMinor") {
        setBalanceErrors((current) => ({
          ...current,
          [loan.id]: { amountMinor: failure.message },
        }));
        balanceFieldRefs.current[loan.id]?.amountMinor?.focus();
      } else {
        setBalanceFormErrors((current) => ({ ...current, [loan.id]: failure.message }));
      }
      return;
    }

    setBalanceErrors((current) => {
      const next = { ...current };
      delete next[loan.id];
      return next;
    });
    setBalanceFormErrors((current) => {
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
      const failure = validationError(saveFailure, "Unable to add the loan balance.");
      if (failure.field === "effectiveDateIso") {
        setBalanceErrors((current) => ({
          ...current,
          [loan.id]: { effectiveDateIso: failure.message },
        }));
        balanceFieldRefs.current[loan.id]?.effectiveDateIso?.focus();
      } else if (failure.field === "amountMinor") {
        setBalanceErrors((current) => ({
          ...current,
          [loan.id]: { amountMinor: failure.message },
        }));
        balanceFieldRefs.current[loan.id]?.amountMinor?.focus();
      } else {
        setBalanceFormErrors((current) => ({ ...current, [loan.id]: failure.message }));
      }
    } finally {
      setIsSaving(false);
    }
  }

  const loanErrorCount = LOAN_FIELD_ORDER.filter((field) => loanFieldErrors[field] !== undefined).length;
  const loanErrorSummary = `Fix ${loanErrorCount} highlighted ${loanErrorCount === 1 ? "field" : "fields"
    } before adding the loan.`;
  const activeLoanId = selectedLoanId ?? loans[0]?.id ?? null;

  const isRegistryEmpty = !isLoading && loadError === null && loans.length === 0 && !isLoanFormOpen;

  return (
    <section className={`property-registry-section loan-registry-section${isRegistryEmpty ? " registry-empty-state" : ""}`} aria-label="Loan registry">
      {isRegistryEmpty && <p className="property-registry-empty">No loans have been recorded.</p>}
      {!isLoanFormOpen && (
        <button
          ref={addLoanButtonRef}
          type="button"
          disabled={isLoading || isSaving || loadError !== null}
          onClick={openLoanForm}
        >
          Add loan
        </button>
      )}
      {isLoanFormOpen && (
        <LoanCreateForm
          addLoan={addLoan}
          loanFieldErrors={loanFieldErrors}
          updateLoanDraft={updateLoanDraft}
          loanFieldRefs={loanFieldRefs}
          loanDraft={loanDraft}
          properties={properties}
          isSaving={isSaving}
          isLoading={isLoading}
          loadError={loadError}
          cancelLoanForm={cancelLoanForm}
        />
      )}
      {loanErrorCount > 0 && (
        <p className="loan-form-errors" role="alert">
          {loanErrorSummary}
        </p>
      )}
      {loanFormError !== null && (
        <p className="property-registry-message" role="alert">{loanFormError}</p>
      )}
      {loanStatus !== null && (
        <p className="property-registry-message" role="status">{loanStatus}</p>
      )}
      {loadError !== null && <p className="property-registry-message" role="alert">{loadError}</p>}
      {isLoading ? (
        <p className="property-registry-empty" role="status">Loading loan records...</p>
      ) : loans.length === 0 ? null : (
        <div className={`loan-workspace-grid${isCompactLoanDetailOpen
          ? " is-compact-detail-open"
          : ""}`}>
          <nav className="loan-record-navigation" aria-label="Loan records">
            {loans.map((loan) => {
              const latestBalance = loan.balances.reduce<
                LoanWithBalances["balances"][number] | undefined
              >((latest, balance) => (
                latest === undefined || balance.recordedAtIso > latest.recordedAtIso
                  ? balance
                  : latest
              ), undefined);
              return (
                <button
                  key={loan.id}
                  ref={(element) => { loanNavigationButtonRefs.current[loan.id] = element; }}
                  type="button"
                  aria-label={`Select loan ${loan.label}`}
                  aria-current={loan.id === activeLoanId ? "page" : undefined}
                  onClick={() => selectLoan(loan.id)}
                >
                  <span>{loan.label}</span>
                  <small>
                    {latestBalance === undefined
                      ? "No balance recorded"
                      : `Last recorded: ${formatAmount(latestBalance.amountMinor, latestBalance.currencyCode)}`}
                  </small>
                </button>
              );
            })}
          </nav>
          <div className="loan-record-detail">
            {loans.filter((loan) => loan.id === activeLoanId).map((loan) => {
              const balanceDraft = balanceDrafts[loan.id] ?? EMPTY_BALANCE_DRAFT;
              const balanceError = balanceErrors[loan.id] ?? {};
              const balanceFormError = balanceFormErrors[loan.id];
              const balanceErrorCount = BALANCE_FIELD_ORDER
                .filter((field) => balanceError[field] !== undefined).length;
              const balanceErrorSummary = `Fix ${balanceErrorCount} highlighted ${balanceErrorCount === 1 ? "field" : "fields"
                } before adding the balance.`;
              const balanceErrorId = `loan-balance-error-${loan.id}`;
              const linkedProperty = loan.propertyId === undefined
                ? undefined
                : properties.find((property) => property.id === loan.propertyId);
              const latestRecordedBalance = loan.balances.reduce<
                LoanWithBalances["balances"][number] | undefined
              >((latest, balance) => (
                latest === undefined || balance.recordedAtIso > latest.recordedAtIso
                  ? balance
                  : latest
              ), undefined);
              return (
                <section
                  className="loan-record"
                  id={`loan-record-${loan.id}`}
                  aria-label={`Loan ${loan.label}`}
                  key={loan.id}
                  ref={(element) => { loanRecordRefs.current[loan.id] = element; }}
                  tabIndex={-1}
                >
                  {isCompactLoanDetailOpen && (
                    <button
                      className="loan-detail-back"
                      onClick={() => showLoanList(loan.id)}
                      type="button"
                    >
                      Back to loans
                    </button>
                  )}
                  <div className="loan-record-heading">
                    <h4>{loan.label}</h4>
                    <span>
                      {latestRecordedBalance === undefined
                        ? "No balance recorded."
                        : `Last recorded balance: ${formatAmount(latestRecordedBalance.amountMinor, latestRecordedBalance.currencyCode)
                        } · effective ${latestRecordedBalance.effectiveDateIso}`}
                    </span>
                  </div>
                  <HouseholdShareForm
                    recordId={loan.id}
                    formStates={shareFormStates}
                    setFormStates={setShareFormStates}
                    label="Household loan responsibility share (%)"
                    buttonLabel="Save responsibility share"
                    successMessage="Responsibility share saved."
                    value={loan.responsibilityShareBasisPoints ?? DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS}
                    onSave={async (responsibilityShareBasisPoints) => {
                      await window.budgetApi.loanRegistry.updateResponsibilityShare({
                        loanId: loan.id, responsibilityShareBasisPoints,
                      });
                      setLoans((current) => current.map((record) => record.id === loan.id
                        ? { ...record, responsibilityShareBasisPoints }
                        : record));
                    }}
                  />
                  <details className="loan-record-details">
                    <summary>
                      <span className="loan-details-summary-content">
                        <span>Loan terms and balance history</span>
                        <span>
                          {loan.balances.length}{" "}
                          {loan.balances.length === 1 ? "snapshot" : "snapshots"}
                        </span>
                      </span>
                    </summary>
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
                        <dd>
                          {linkedProperty === undefined ? "No property linked" : (
                            <>
                              {linkedProperty.label}
                              <button
                                className="loan-view-property"
                                onClick={() => onViewProperty(linkedProperty.id)}
                                type="button"
                              >
                                View property
                              </button>
                            </>
                          )}
                        </dd>
                      </div>
                    </dl>
                    <LoanHistory
                      loan={loan}
                    />
                  </details>
                  <p id="loan-balance-history-guidance" className="loan-balance-history-guidance">
                    Each entry stays in history. Add another recorded balance to capture a new amount
                    and effective date. Recorded at shows when it was entered.
                  </p>
                  <form
                    className="loan-balance-form"
                    aria-label={`Add balance for ${loan.label}`}
                    onSubmit={(event) => void addBalance(event, loan)}
                  >
                    <div className="loan-field">
                      <label htmlFor={`loan-balance-date-${loan.id}`}>Effective date</label>
                      <input
                        id={`loan-balance-date-${loan.id}`}
                        type="date"
                        aria-required="true"
                        aria-invalid={balanceError.effectiveDateIso !== undefined ? true : undefined}
                        aria-describedby={describedBy(
                          `loan-balance-date-hint-${loan.id}`,
                          "loan-balance-history-guidance",
                          balanceError.effectiveDateIso === undefined
                            ? undefined
                            : `${balanceErrorId}-effectiveDateIso`
                        )}
                        onChange={(event) => updateBalanceDraft(
                          loan.id,
                          "effectiveDateIso",
                          event.currentTarget.value
                        )}
                        ref={(element) => {
                          const fieldRefs = balanceFieldRefs.current[loan.id] ?? {};
                          fieldRefs.effectiveDateIso = element;
                          balanceFieldRefs.current[loan.id] = fieldRefs;
                        }}
                        value={balanceDraft.effectiveDateIso}
                      />
                      <span id={`loan-balance-date-hint-${loan.id}`} className="loan-field-hint">
                        Choose the date this amount applies; Recorded at is set when you save.
                      </span>
                      {balanceError.effectiveDateIso !== undefined && (
                        <span
                          id={`${balanceErrorId}-effectiveDateIso`}
                          className="loan-field-error"
                        >
                          {balanceError.effectiveDateIso}
                        </span>
                      )}
                    </div>
                    <div className="loan-field">
                      <label htmlFor={`loan-balance-amount-${loan.id}`}>
                        Actual balance on this date
                      </label>
                      <input
                        id={`loan-balance-amount-${loan.id}`}
                        inputMode="decimal"
                        aria-required="true"
                        aria-invalid={balanceError.amountMinor !== undefined ? true : undefined}
                        aria-describedby={describedBy(
                          `loan-balance-amount-hint-${loan.id}`,
                          "loan-balance-history-guidance",
                          balanceError.amountMinor === undefined
                            ? undefined
                            : `${balanceErrorId}-amountMinor`
                        )}
                        onChange={(event) => updateBalanceDraft(
                          loan.id,
                          "amount",
                          event.currentTarget.value
                        )}
                        ref={(element) => {
                          const fieldRefs = balanceFieldRefs.current[loan.id] ?? {};
                          fieldRefs.amountMinor = element;
                          balanceFieldRefs.current[loan.id] = fieldRefs;
                        }}
                        value={balanceDraft.amount}
                      />
                      <span id={`loan-balance-amount-hint-${loan.id}`} className="loan-field-hint">
                        In {loan.currencyCode}; use digits with an optional comma or period, up to
                        two decimal places. Example: 2995000,00.
                      </span>
                      {balanceError.amountMinor !== undefined && (
                        <span id={`${balanceErrorId}-amountMinor`} className="loan-field-error">
                          {balanceError.amountMinor}
                        </span>
                      )}
                    </div>
                    <button disabled={isSaving || isLoading || loadError !== null} type="submit">
                      Add balance
                    </button>
                  </form>
                  {balanceErrorCount > 0 && (
                    <p className="loan-form-errors" role="alert">
                      {balanceErrorSummary}
                    </p>
                  )}
                  {balanceFormError !== undefined && (
                    <p className="property-registry-message" role="alert">{balanceFormError}</p>
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
                </section>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
