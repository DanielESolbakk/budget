import React from "react";

interface HouseholdSetupProps {
  onComplete: () => void;
}

export function HouseholdSetup({ onComplete }: HouseholdSetupProps): React.JSX.Element {
  const [householdName, setHouseholdName] = React.useState("");
  const [accountName, setAccountName] = React.useState("");
  const [currencyCode, setCurrencyCode] = React.useState("NOK");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await window.budgetApi.setup.create({ householdName, accountName, currencyCode });
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
          <form className="first-run-form" onSubmit={handleSubmit}>
            <label>
              Household name
              <input
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
                  autoCapitalize="characters"
                  maxLength={3}
                  onChange={(event) => setCurrencyCode(event.currentTarget.value.toUpperCase())}
                  pattern="[A-Za-z]{3}"
                  required
                  value={currencyCode}
                />
              </label>
            </div>
            <p className="first-run-local-note">
              Household and account details are saved in a local SQLite file on this device. This does not set up online sync.
            </p>
            {errorMessage !== null && <p className="first-run-error" role="alert">{errorMessage}</p>}
            <button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Creating ledger..." : "Create local ledger"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}