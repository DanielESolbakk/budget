import React from "react";
import type {
  ManualEntryDuplicate,
  ManualEntryResponse,
  ManualEntrySuccess,
} from "../../app/import/manualEntry.js";
import type { Account, ManualEntryInput, ManualEntryValidationErrorCode } from "../../domain/types.js";
import { toLocalIsoDate } from "../../domain/date/localDateDefaults.js";
import { CATEGORY_OPTIONS } from "./categoryOptions.js";
import { parseNokAmountMinor } from "../parseNokAmountMinor.js";

interface ManualEntryFormValues {
  accountId: string;
  bookedAtIso: string;
  amountNok: string;
  merchantRaw: string;
  categoryId: string;
}

type ValidationCode = ManualEntryValidationErrorCode | "INVALID_AMOUNT_NOK";

const validationFields: Record<ValidationCode, keyof ManualEntryFormValues | null> = {
  INVALID_HOUSEHOLD_ID: null,
  INVALID_ACCOUNT_ID: "accountId",
  INVALID_BOOKED_AT_ISO: "bookedAtIso",
  INVALID_AMOUNT_MINOR_INTEGER: "amountNok",
  INVALID_AMOUNT_NOK: "amountNok",
  INVALID_MERCHANT_RAW: "merchantRaw",
  INVALID_CATEGORY_ID: "categoryId",
};

const validationMessages: Record<ManualEntryValidationErrorCode, string> = {
  INVALID_HOUSEHOLD_ID: "The household is unavailable. Return to Household and check your setup before adding a transaction.",
  INVALID_ACCOUNT_ID: "Choose an account belonging to this household.",
  INVALID_BOOKED_AT_ISO: "Choose a valid booked date.",
  INVALID_AMOUNT_MINOR_INTEGER: "Enter a NOK amount with up to two decimals.",
  INVALID_MERCHANT_RAW: "Enter a description or merchant, not just spaces.",
  INVALID_CATEGORY_ID: "Choose a category or leave the transaction uncategorized for review.",
};

type ManualEntryState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; response: ManualEntrySuccess }
  | { status: "duplicate"; response: ManualEntryDuplicate }
  | { status: "validation"; code: ValidationCode; message: string }
  | { status: "error"; message: string };

function createInitialFormValues(accountId = ""): ManualEntryFormValues {
  return {
    accountId,
    bookedAtIso: toLocalIsoDate(new Date()),
    amountNok: "",
    merchantRaw: "",
    categoryId: "",
  };
}

function toManualEntryInput(
  values: ManualEntryFormValues,
  householdId: string
): ManualEntryInput | null {
  const amountMinor = parseNokAmountMinor(values.amountNok);
  if (amountMinor === null) return null;

  const categoryId = values.categoryId.trim();
  return {
    householdId,
    accountId: values.accountId,
    bookedAtIso: values.bookedAtIso,
    amountMinor,
    merchantRaw: values.merchantRaw,
    ...(categoryId.length > 0 ? { categoryId } : {}),
  };
}

interface ManualEntrySectionProps {
  refreshKey: number;
  onEntrySuccess: () => void;
  onOpenLedger: () => void;
  onReviewUncategorized: () => void;
}

export function ManualEntrySection({ refreshKey, onEntrySuccess, onOpenLedger, onReviewUncategorized }: ManualEntrySectionProps): React.JSX.Element {
  const [householdId, setHouseholdId] = React.useState<string | null>(null);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [accountState, setAccountState] = React.useState<"loading" | "ready" | "error">("loading");
  const [formValues, setFormValues] = React.useState<ManualEntryFormValues>(() => createInitialFormValues());
  const [entryState, setEntryState] = React.useState<ManualEntryState>({ status: "idle" });
  const [accountRetryKey, setAccountRetryKey] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    setAccountState("loading");
    window.budgetApi.accounts
      .getCurrent()
      .then((current) => {
        if (!active) return;
        const loadedAccounts = current?.accounts ?? [];
        setHouseholdId(current?.householdId ?? null);
        setAccounts(loadedAccounts);
        setFormValues((current) => ({
          ...current,
          accountId: current.accountId || loadedAccounts[0]?.id || "",
        }));
        setAccountState("ready");
      })
      .catch(() => {
        if (active) setAccountState("error");
      });

    return () => {
      active = false;
    };
  }, [accountRetryKey, refreshKey]);

  function updateField(field: keyof ManualEntryFormValues, value: string): void {
    setFormValues((current) => ({ ...current, [field]: value }));
    if (
      entryState.status === "validation" &&
      validationFields[entryState.code] === field
    ) {
      setEntryState({ status: "idle" });
    }
  }

  function fieldHasError(field: keyof ManualEntryFormValues): boolean {
    return entryState.status === "validation" && validationFields[entryState.code] === field;
  }

  function validationAttributes(field: keyof ManualEntryFormValues, helpId?: string): React.AriaAttributes {
    return {
      "aria-invalid": fieldHasError(field) ? true : undefined,
      "aria-describedby": fieldHasError(field)
        ? [helpId, `manual-${field}-error`].filter(Boolean).join(" ")
        : helpId,
    };
  }

  function renderFieldError(field: keyof ManualEntryFormValues): React.JSX.Element | null {
    return fieldHasError(field) && entryState.status === "validation"
      ? <p id={`manual-${field}-error`} role="alert">{entryState.message}</p>
      : null;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (householdId === null) return;

    const input = toManualEntryInput(formValues, householdId);
    if (input === null) {
      setEntryState({
        status: "validation",
        code: "INVALID_AMOUNT_NOK",
        message:
          "Enter a NOK amount with up to two decimals. Use a negative amount for an expense and a positive amount for income.",
      });
      return;
    }

    setEntryState({ status: "pending" });

    window.budgetApi.import
      .addManualTransaction(input)
      .then((response: ManualEntryResponse) => {
        if (response.ok) {
          setEntryState({ status: "success", response });
          setFormValues((current) => createInitialFormValues(current.accountId));
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
          message: validationMessages[response.code],
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
          {...validationAttributes("accountId")}
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
        {renderFieldError("accountId")}

        <label htmlFor="manual-booked-date">Booked date</label>
        <input
          id="manual-booked-date"
          {...validationAttributes("bookedAtIso")}
          type="date"
          value={formValues.bookedAtIso}
          onChange={(event) => updateField("bookedAtIso", event.target.value)}
          required
          disabled={entryState.status === "pending"}
        />
        {renderFieldError("bookedAtIso")}

        <label htmlFor="manual-amount-nok">Amount (NOK)</label>
        <input
          id="manual-amount-nok"
          type="text"
          inputMode="decimal"
          value={formValues.amountNok}
          onChange={(event) => updateField("amountNok", event.target.value)}
          {...validationAttributes("amountNok", "manual-amount-help")}
          placeholder="-12,50"
          required
          disabled={entryState.status === "pending"}
        />
        <p id="manual-amount-help" className="field-help">
          Enter an amount with up to two decimals. Use a negative number for an expense and a positive number for income.
        </p>
        {renderFieldError("amountNok")}

        <label htmlFor="manual-merchant-raw">Description or merchant</label>
        <input
          id="manual-merchant-raw"
          {...validationAttributes("merchantRaw")}
          type="text"
          value={formValues.merchantRaw}
          onChange={(event) => updateField("merchantRaw", event.target.value)}
          required
          disabled={entryState.status === "pending"}
        />
        {renderFieldError("merchantRaw")}

        <label htmlFor="manual-category-id">Category (optional)</label>
        <select
          id="manual-category-id"
          {...validationAttributes("categoryId")}
          value={formValues.categoryId}
          onChange={(event) => updateField("categoryId", event.target.value)}
          disabled={entryState.status === "pending"}
        >
          <option value="">Leave uncategorized for review</option>
          {CATEGORY_OPTIONS.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>
        {renderFieldError("categoryId")}

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
      {accountState === "error" && (
        <div role="alert">
          <p>Accounts could not be loaded.</p>
          <button type="button" onClick={() => setAccountRetryKey((current) => current + 1)}>
            Retry accounts
          </button>
        </div>
      )}
      {accountState === "ready" && accounts.length === 0 && (
        <p role="alert">No accounts are available for this household.</p>
      )}
      {entryState.status === "success" && (
        <div className="import-success">
          <p role="status">Added {entryState.response.transaction.merchantRaw} to your ledger.</p>
          <div className="import-success-actions" aria-label="Next transaction actions">
            <button type="button" onClick={onReviewUncategorized}>Review category decisions</button>
            <button type="button" className="import-secondary-action" onClick={onOpenLedger}>Return to ledger</button>
          </div>
        </div>
      )}
      {entryState.status === "duplicate" && (
        <div role="alert">
          <p>This transaction is already in your ledger.</p>
          <p>Check the Ledger section to review the existing entry before adding another one.</p>
        </div>
      )}
      {entryState.status === "validation" && validationFields[entryState.code] === null && (
        <div role="alert">
          <p>{entryState.message}</p>
        </div>
      )}
      {entryState.status === "error" && (
        <div role="alert">
          <p>Saving this transaction could not be confirmed.</p>
          <p>Your entries are kept here. Check the ledger before trying again to avoid adding the transaction twice.</p>
          <button type="button" onClick={onOpenLedger}>Open ledger</button>
          <details>
            <summary>Error details</summary>
            <p>{entryState.message}</p>
          </details>
        </div>
      )}
    </section>
  );
}
