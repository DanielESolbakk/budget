import React from "react";
import type {
  ManualEntryDuplicate,
  ManualEntryResponse,
  ManualEntrySuccess,
} from "../../app/import/manualEntry.js";
import type { Account, ManualEntryInput } from "../../domain/types.js";

const DEFAULT_HOUSEHOLD_ID = "sample-hh";

interface ManualEntryFormValues {
  accountId: string;
  bookedAtIso: string;
  amountMinor: string;
  merchantRaw: string;
  categoryId: string;
}

type ManualEntryState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; response: ManualEntrySuccess }
  | { status: "duplicate"; response: ManualEntryDuplicate }
  | { status: "validation"; code: string; message: string }
  | { status: "error"; message: string };

const initialFormValues: ManualEntryFormValues = {
  accountId: "",
  bookedAtIso: "2026-05-23",
  amountMinor: "",
  merchantRaw: "",
  categoryId: "",
};

function toManualEntryInput(values: ManualEntryFormValues): ManualEntryInput {
  const categoryId = values.categoryId.trim();
  return {
    householdId: DEFAULT_HOUSEHOLD_ID,
    accountId: values.accountId,
    bookedAtIso: values.bookedAtIso,
    amountMinor: Number(values.amountMinor),
    merchantRaw: values.merchantRaw,
    ...(categoryId.length > 0 ? { categoryId } : {}),
  };
}

interface ManualEntrySectionProps {
  onEntrySuccess: () => void;
}

export function ManualEntrySection({ onEntrySuccess }: ManualEntrySectionProps): React.JSX.Element {
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [accountState, setAccountState] = React.useState<"loading" | "ready" | "error">("loading");
  const [formValues, setFormValues] = React.useState<ManualEntryFormValues>(initialFormValues);
  const [entryState, setEntryState] = React.useState<ManualEntryState>({ status: "idle" });

  React.useEffect(() => {
    window.budgetApi.accounts
      .list(DEFAULT_HOUSEHOLD_ID)
      .then((loadedAccounts) => {
        setAccounts(loadedAccounts);
        setFormValues((current) => ({
          ...current,
          accountId: current.accountId || loadedAccounts[0]?.id || "",
        }));
        setAccountState("ready");
      })
      .catch(() => setAccountState("error"));
  }, []);

  function updateField(field: keyof ManualEntryFormValues, value: string): void {
    setFormValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setEntryState({ status: "pending" });

    window.budgetApi.import
      .addManualTransaction(toManualEntryInput(formValues))
      .then((response: ManualEntryResponse) => {
        if (response.ok) {
          setEntryState({ status: "success", response });
          setFormValues((current) => ({ ...initialFormValues, accountId: current.accountId }));
          onEntrySuccess();
          return;
        }

        if (response.reason === "duplicate") {
          setEntryState({ status: "duplicate", response });
          return;
        }

        setEntryState({
          status: "validation",
          code: response.code,
          message: response.message,
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown manual entry error.";
        setEntryState({ status: "error", message });
      });
  }

  return (
    <section aria-label="Manual Entry">
      <h2>Add transaction manually</h2>
      <form aria-label="Manual transaction entry form" onSubmit={handleSubmit}>
        <label htmlFor="manual-account-id">Account</label>
        <select
          id="manual-account-id"
          value={formValues.accountId}
          onChange={(event) => updateField("accountId", event.target.value)}
          required
          disabled={entryState.status === "pending" || accountState !== "ready"}
        >
          <option value="" disabled>Select an account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.id})
            </option>
          ))}
        </select>

        <label htmlFor="manual-booked-date">Booked date</label>
        <input
          id="manual-booked-date"
          type="date"
          value={formValues.bookedAtIso}
          onChange={(event) => updateField("bookedAtIso", event.target.value)}
          required
          disabled={entryState.status === "pending"}
        />

        <label htmlFor="manual-amount-minor">Amount (minor units)</label>
        <input
          id="manual-amount-minor"
          type="number"
          inputMode="numeric"
          step="1"
          value={formValues.amountMinor}
          onChange={(event) => updateField("amountMinor", event.target.value)}
          placeholder="-1250"
          required
          disabled={entryState.status === "pending"}
        />

        <label htmlFor="manual-merchant-raw">Description or merchant</label>
        <input
          id="manual-merchant-raw"
          type="text"
          value={formValues.merchantRaw}
          onChange={(event) => updateField("merchantRaw", event.target.value)}
          required
          disabled={entryState.status === "pending"}
        />

        <label htmlFor="manual-category-id">Manual category ID (optional)</label>
        <input
          id="manual-category-id"
          type="text"
          value={formValues.categoryId}
          onChange={(event) => updateField("categoryId", event.target.value)}
          disabled={entryState.status === "pending"}
        />

        <button
          type="submit"
          disabled={
            entryState.status === "pending" ||
            accountState !== "ready" ||
            accounts.length === 0
          }
        >
          Add transaction
        </button>
      </form>

      {entryState.status === "pending" && <p role="status">Saving transaction...</p>}
      {accountState === "loading" && <p role="status">Loading accounts...</p>}
      {accountState === "error" && <p role="alert">Accounts could not be loaded.</p>}
      {accountState === "ready" && accounts.length === 0 && (
        <p role="alert">No accounts are available for this household.</p>
      )}
      {entryState.status === "success" && (
        <p role="status">
          Transaction added: {entryState.response.transaction.merchantRaw}; account {entryState.response.transaction.accountId}; date {entryState.response.transaction.bookedAtIso}; amount {entryState.response.transaction.amountMinor} minor units; category {entryState.response.transaction.categoryId ?? "uncategorized"}.
        </p>
      )}
      {entryState.status === "duplicate" && (
        <div role="alert">
          <p>Duplicate transaction detected.</p>
          <p>Matching ledger row: {entryState.response.matchingTransactionId}.</p>
          <p>Fingerprint: {entryState.response.fingerprint}</p>
        </div>
      )}
      {entryState.status === "validation" && (
        <div role="alert">
          <p>Manual entry validation failed: {entryState.code}</p>
          <p>{entryState.message}</p>
        </div>
      )}
      {entryState.status === "error" && <p role="alert">Manual entry failed: {entryState.message}</p>}
    </section>
  );
}
