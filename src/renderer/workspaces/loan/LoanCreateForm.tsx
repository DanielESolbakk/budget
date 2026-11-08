import React from "react";
import type {
  LoanPaymentFrequency,
  PropertyRecord
} from "../../../domain/types.js";
import type { LoanRecordValidationField } from "../../../domain/loanRecordValidation.js";
import {
  type FocusableFieldRefs, type LoanDraft, type LoanFieldErrors,
  PAYMENT_FREQUENCY_LABELS, describedBy,
} from "./loanFormState.js";

interface LoanCreateFormProps {
  addLoan: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  loanFieldErrors: LoanFieldErrors;
  updateLoanDraft: (field: keyof LoanDraft, value: string) => void;
  loanFieldRefs: React.MutableRefObject<FocusableFieldRefs<LoanRecordValidationField>>;
  loanDraft: LoanDraft;
  properties: PropertyRecord[];
  isSaving: boolean;
  isLoading: boolean;
  loadError: string | null;
  cancelLoanForm: () => void;
}

export function LoanCreateForm({
  addLoan, loanFieldErrors, updateLoanDraft, loanFieldRefs, loanDraft, properties,
  isSaving, isLoading, loadError, cancelLoanForm,
}: LoanCreateFormProps): React.JSX.Element {
  return (<form
    className="loan-create-form"
    aria-label="Add loan"
    onSubmit={(event) => void addLoan(event)}
  >
    <p className="loan-required-note">
      All loan details are required except the property link.
    </p>
    <fieldset className="loan-create-group">
      <legend>Loan details</legend>
      <div className="loan-create-fields">
        <div className="loan-field">
          <label htmlFor="loan-label">Loan label</label>
          <input
            id="loan-label"
            autoComplete="off"
            autoFocus
            aria-required="true"
            aria-invalid={loanFieldErrors.label !== undefined ? true : undefined}
            aria-describedby={describedBy(
              "loan-label-hint",
              loanFieldErrors.label === undefined ? undefined : "loan-create-error-label"
            )}
            maxLength={100}
            onChange={(event) => updateLoanDraft("label", event.currentTarget.value)}
            ref={(element) => { loanFieldRefs.current.label = element; }}
            value={loanDraft.label}
          />
          <span id="loan-label-hint" className="loan-field-hint">
            Use a name you will recognize, such as Home mortgage.
          </span>
          {loanFieldErrors.label !== undefined && (
            <span id="loan-create-error-label" className="loan-field-error">
              {loanFieldErrors.label}
            </span>
          )}
        </div>
        <div className="loan-field">
          <label htmlFor="loan-principal">Principal amount</label>
          <input
            id="loan-principal"
            inputMode="decimal"
            aria-required="true"
            aria-invalid={loanFieldErrors.principalMinor !== undefined ? true : undefined}
            aria-describedby={describedBy(
              "loan-principal-hint",
              loanFieldErrors.principalMinor === undefined
                ? undefined
                : "loan-create-error-principalMinor"
            )}
            onChange={(event) => updateLoanDraft("principal", event.currentTarget.value)}
            ref={(element) => { loanFieldRefs.current.principalMinor = element; }}
            value={loanDraft.principal}
          />
          <span id="loan-principal-hint" className="loan-field-hint">
            Use digits, with an optional comma or period and up to two decimal places.
            Example: 3000000,00.
          </span>
          {loanFieldErrors.principalMinor !== undefined && (
            <span id="loan-create-error-principalMinor" className="loan-field-error">
              {loanFieldErrors.principalMinor}
            </span>
          )}
        </div>
        <div className="loan-field">
          <label htmlFor="loan-interest-rate">Annual interest rate (%)</label>
          <input
            id="loan-interest-rate"
            inputMode="decimal"
            aria-required="true"
            aria-invalid={loanFieldErrors.annualInterestRateBasisPoints !== undefined
              ? true
              : undefined}
            aria-describedby={describedBy(
              "loan-interest-rate-hint",
              loanFieldErrors.annualInterestRateBasisPoints === undefined
                ? undefined
                : "loan-create-error-annualInterestRateBasisPoints"
            )}
            onChange={(event) => updateLoanDraft(
              "annualInterestRate",
              event.currentTarget.value
            )}
            ref={(element) => {
              loanFieldRefs.current.annualInterestRateBasisPoints = element;
            }}
            value={loanDraft.annualInterestRate}
          />
          <span id="loan-interest-rate-hint" className="loan-field-hint">
            Enter 0 to 100 percent, up to two decimal places. Example: 5,00.
          </span>
          {loanFieldErrors.annualInterestRateBasisPoints !== undefined && (
            <span
              id="loan-create-error-annualInterestRateBasisPoints"
              className="loan-field-error"
            >
              {loanFieldErrors.annualInterestRateBasisPoints}
            </span>
          )}
        </div>
        <div className="loan-field">
          <label htmlFor="loan-term-years">Term (years)</label>
          <input
            id="loan-term-years"
            inputMode="numeric"
            aria-required="true"
            aria-invalid={loanFieldErrors.termMonths !== undefined ? true : undefined}
            aria-describedby={describedBy(
              "loan-term-years-hint",
              loanFieldErrors.termMonths === undefined
                ? undefined
                : "loan-create-error-termMonths"
            )}
            onChange={(event) => updateLoanDraft("termYears", event.currentTarget.value)}
            ref={(element) => { loanFieldRefs.current.termMonths = element; }}
            value={loanDraft.termYears}
          />
          <span id="loan-term-years-hint" className="loan-field-hint">
            Enter whole years. Example: 25.
          </span>
          {loanFieldErrors.termMonths !== undefined && (
            <span id="loan-create-error-termMonths" className="loan-field-error">
              {loanFieldErrors.termMonths}
            </span>
          )}
        </div>
      </div>
    </fieldset>
    <fieldset className="loan-create-group">
      <legend>Payment details</legend>
      <div className="loan-create-fields">
        <div className="loan-field">
          <label htmlFor="loan-payment-amount">Regular payment amount</label>
          <input
            id="loan-payment-amount"
            inputMode="decimal"
            aria-required="true"
            aria-invalid={loanFieldErrors.paymentAmountMinor !== undefined ? true : undefined}
            aria-describedby={describedBy(
              "loan-payment-amount-hint",
              loanFieldErrors.paymentAmountMinor === undefined
                ? undefined
                : "loan-create-error-paymentAmountMinor"
            )}
            onChange={(event) => updateLoanDraft("paymentAmount", event.currentTarget.value)}
            ref={(element) => { loanFieldRefs.current.paymentAmountMinor = element; }}
            value={loanDraft.paymentAmount}
          />
          <span id="loan-payment-amount-hint" className="loan-field-hint">
            Use digits, with an optional comma or period and up to two decimal places.
            Example: 17500,00.
          </span>
          {loanFieldErrors.paymentAmountMinor !== undefined && (
            <span id="loan-create-error-paymentAmountMinor" className="loan-field-error">
              {loanFieldErrors.paymentAmountMinor}
            </span>
          )}
        </div>
        <div className="loan-field">
          <label htmlFor="loan-payment-frequency">Payment frequency</label>
          <select
            id="loan-payment-frequency"
            aria-required="true"
            aria-invalid={loanFieldErrors.paymentFrequency !== undefined ? true : undefined}
            aria-describedby={loanFieldErrors.paymentFrequency === undefined
              ? undefined
              : "loan-create-error-paymentFrequency"}
            onChange={(event) => updateLoanDraft(
              "paymentFrequency",
              event.currentTarget.value as LoanPaymentFrequency
            )}
            ref={(element) => {
              loanFieldRefs.current.paymentFrequency = element;
            }}
            value={loanDraft.paymentFrequency}
          >
            {Object.entries(PAYMENT_FREQUENCY_LABELS).map(([frequency, label]) => (
              <option key={frequency} value={frequency}>{label}</option>
            ))}
          </select>
          {loanFieldErrors.paymentFrequency !== undefined && (
            <span id="loan-create-error-paymentFrequency" className="loan-field-error">
              {loanFieldErrors.paymentFrequency}
            </span>
          )}
        </div>
        <div className="loan-field">
          <label htmlFor="loan-currency-code">Currency code</label>
          <input
            id="loan-currency-code"
            autoCapitalize="characters"
            aria-required="true"
            aria-invalid={loanFieldErrors.currencyCode !== undefined ? true : undefined}
            aria-describedby={describedBy(
              "loan-currency-code-hint",
              loanFieldErrors.currencyCode === undefined
                ? undefined
                : "loan-create-error-currencyCode"
            )}
            maxLength={3}
            onChange={(event) => updateLoanDraft("currencyCode", event.currentTarget.value)}
            ref={(element) => { loanFieldRefs.current.currencyCode = element; }}
            value={loanDraft.currencyCode}
          />
          <span id="loan-currency-code-hint" className="loan-field-hint">
            Enter a three-letter uppercase code such as NOK or EUR.
          </span>
          {loanFieldErrors.currencyCode !== undefined && (
            <span id="loan-create-error-currencyCode" className="loan-field-error">
              {loanFieldErrors.currencyCode}
            </span>
          )}
        </div>
      </div>
    </fieldset>
    <fieldset className="loan-create-group">
      <legend>Property link</legend>
      <div className="loan-create-fields loan-create-fields-single">
        <div className="loan-field">
          <label htmlFor="loan-property">Property (optional)</label>
          <select
            id="loan-property"
            aria-invalid={loanFieldErrors.propertyId !== undefined ? true : undefined}
            aria-describedby={describedBy(
              "loan-property-hint",
              loanFieldErrors.propertyId === undefined
                ? undefined
                : "loan-create-error-propertyId"
            )}
            onChange={(event) => updateLoanDraft("propertyId", event.currentTarget.value)}
            ref={(element) => { loanFieldRefs.current.propertyId = element; }}
            value={loanDraft.propertyId}
          >
            <option value="">No property linked</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>{property.label}</option>
            ))}
          </select>
          <span id="loan-property-hint" className="loan-field-hint">
            Select a property or leave the link blank.
          </span>
          {loanFieldErrors.propertyId !== undefined && (
            <span id="loan-create-error-propertyId" className="loan-field-error">
              {loanFieldErrors.propertyId}
            </span>
          )}
        </div>
      </div>
    </fieldset>
    <div className="loan-create-actions">
      <button disabled={isSaving || isLoading || loadError !== null} type="submit">
        {isSaving ? "Saving loan..." : "Save loan"}
      </button>
      <button disabled={isSaving} onClick={cancelLoanForm} type="button">
        Cancel
      </button>
    </div>
  </form>);
}
