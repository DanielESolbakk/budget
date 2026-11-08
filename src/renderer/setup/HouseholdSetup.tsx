import React from "react";
import {
  HouseholdSetupValidationError,
  normalizeHouseholdSetupInput,
  type HouseholdSetupInput,
} from "../../shared/householdSetup.js";

interface HouseholdSetupProps {
  onComplete: () => void;
}

export function HouseholdSetup({ onComplete }: HouseholdSetupProps): React.JSX.Element {
  const [householdName, setHouseholdName] = React.useState("");
  const [accountName, setAccountName] = React.useState("");
  const [currencyCode, setCurrencyCode] = React.useState("NOK");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<HouseholdSetupValidationError | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);
    setFieldError(null);
    let input: HouseholdSetupInput;
    try {
      input = normalizeHouseholdSetupInput({ householdName, accountName, currencyCode });
    } catch (error: unknown) {
      if (!(error instanceof HouseholdSetupValidationError)) throw error;
      setFieldError(error);
      formRef.current?.querySelector<HTMLInputElement>(`[name="${error.field}"]`)?.focus();
      return;
    }
    setIsSubmitting(true);
    try {
      await window.budgetApi.setup.create(input);
      onComplete();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to create the local ledger.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="first-run-shell">
      <header className="app-header first-run-header">
        <div className="brand-lockup">
          <span className="brand-stamp" aria-hidden="true">BP</span>
          <div>
            <h1>Budget Planner</h1>
            <p>Local household ledger</p>
          </div>
        </div>
        <span className="first-run-device-label">On device</span>
      </header>
      <main className="first-run-main">
        <section className="first-run-panel" aria-labelledby="household-setup-heading">
          <h2 id="household-setup-heading">Set up your household</h2>
          <p className="first-run-description">
            Create a household and its first account to begin importing or recording transactions.
          </p>
          <form ref={formRef} className="first-run-form" noValidate onSubmit={handleSubmit}>
            <p className="first-run-description">All fields are required.</p>
            <label>
              Household name
              <input
                name="householdName"
                aria-invalid={fieldError?.field === "householdName" || undefined}
                aria-describedby={fieldError?.field === "householdName" ? "setup-field-error" : undefined}
                autoComplete="organization"
                maxLength={100}
                onChange={(event) => setHouseholdName(event.currentTarget.value)}
                required
                value={householdName}
              />
            </label>
            <div className="first-run-account-fields">
              <label>
                Account name
                <input
                  name="accountName"
                  aria-invalid={fieldError?.field === "accountName" || undefined}
                  aria-describedby={fieldError?.field === "accountName" ? "setup-field-error" : undefined}
                  autoComplete="off"
                  maxLength={100}
                  onChange={(event) => setAccountName(event.currentTarget.value)}
                  required
                  value={accountName}
                />
              </label>
              <label>
                Currency code
                <input
                  name="currencyCode"
                  aria-invalid={fieldError?.field === "currencyCode" || undefined}
                  aria-describedby={fieldError?.field === "currencyCode" ? "setup-field-error setup-currency-help" : "setup-currency-help"}
                  autoCapitalize="characters"
                  maxLength={3}
                  onChange={(event) => setCurrencyCode(event.currentTarget.value.toUpperCase())}
                  pattern="[A-Za-z]{3}"
                  required
                  value={currencyCode}
                />
              </label>
            </div>
            <p id="setup-currency-help" className="first-run-description">Use a three-letter currency code, such as NOK.</p>
            {fieldError !== null && <p id="setup-field-error" className="first-run-error" role="alert">{fieldError.message}</p>}
            <p className="first-run-local-note">
              Saved on this device. No online sync.
            </p>
            {errorMessage !== null && (
              <div className="first-run-error" role="alert">
                <p>Could not create your household and account. Your entries are kept. Try again.</p>
                <details><summary>Error details</summary>{errorMessage}</details>
              </div>
            )}
            <button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Creating ledger..." : "Create local ledger"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}