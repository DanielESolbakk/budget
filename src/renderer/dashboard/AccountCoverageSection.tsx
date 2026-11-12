import React from "react";
import type {
  Account,
  AccountBalanceCheckpoint,
  AccountCoverageAssessment,
  AccountStatementCoveragePeriod,
} from "../../domain/types.js";
import type { ImportJobHistoryEntry } from "../../domain/import/importJobHistory.js";
import { formatMinorUnits } from "../../domain/money/minorUnits.js";
import {
  AccountInputValidationError,
  normalizeAccountInput,
  normalizeAccountUpdateInput,
} from "../../shared/accountLifecycle.js";
import type { AccountHistorySummary } from "../../shared/accountLifecycle.js";
import { parseSignedAmountMinor as parseAmountMinor } from "../amountInputs.js";

const amountFormatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "long",
  timeZone: "UTC",
});

function displayMinorAmount(amountMinor: number, currencyCode: string): string {
  return `${currencyCode} ${formatMinorUnits(amountMinor, amountFormatter)}`;
}

function displayDate(dateIso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (match === null) return dateIso;
  return dateFormatter.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function hasAccountHistory(summary: AccountHistorySummary | null): boolean {
  return summary !== null && (
    summary.transactionCount > 0 ||
    summary.coveragePeriodCount > 0 ||
    summary.checkpointCount > 0
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

interface AccountCoverageData {
  periods: AccountStatementCoveragePeriod[];
  checkpoints: AccountBalanceCheckpoint[];
  assessments: Map<string, AccountCoverageAssessment>;
}

async function loadAccountCoverageData(accountId: string): Promise<AccountCoverageData> {
  const [periods, checkpoints] = await Promise.all([
    window.budgetApi.accountCoverage.listPeriods(accountId),
    window.budgetApi.accountCoverage.listCheckpoints(accountId),
  ]);
  const assessments = await Promise.all(
    periods.map(async (period) => [
      period.id,
      await window.budgetApi.accountCoverage.getAssessment(period.id, new Date().toISOString()),
    ] as const)
  );
  return { periods, checkpoints, assessments: new Map(assessments) };
}

interface AccountCoverageSectionProps {
  refreshKey: number;
  onAccountsChanged: () => void;
}

export function AccountCoverageSection({
  refreshKey,
  onAccountsChanged,
}: AccountCoverageSectionProps): React.JSX.Element {
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [importJobs, setImportJobs] = React.useState<ImportJobHistoryEntry[]>([]);
  const [selectedAccountId, setSelectedAccountId] = React.useState("");
  const [data, setData] = React.useState<AccountCoverageData>({
    periods: [],
    checkpoints: [],
    assessments: new Map(),
  });
  const [startDateIso, setStartDateIso] = React.useState("");
  const [endDateIso, setEndDateIso] = React.useState("");
  const [sourceName, setSourceName] = React.useState("");
  const [sourceType, setSourceType] = React.useState<AccountStatementCoveragePeriod["sourceType"]>("manual");
  const [importJobId, setImportJobId] = React.useState("");
  const [checkpointDateIso, setCheckpointDateIso] = React.useState("");
  const [checkpointBalance, setCheckpointBalance] = React.useState("");
  const [checkpointSource, setCheckpointSource] = React.useState("");
  const [revision, setRevision] = React.useState(0);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [accountName, setAccountName] = React.useState("");
  const [accountCurrencyCode, setAccountCurrencyCode] = React.useState("NOK");
  const [accountFieldError, setAccountFieldError] =
    React.useState<AccountInputValidationError | null>(null);
  const [accountError, setAccountError] = React.useState<string | null>(null);
  const [accountStatus, setAccountStatus] = React.useState<string | null>(null);
  const [accountArchiveError, setAccountArchiveError] = React.useState<string | null>(null);
  const [isCreatingAccount, setIsCreatingAccount] = React.useState(false);
  const [archivingAccountId, setArchivingAccountId] = React.useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = React.useState<string | null>(null);
  const [editAccountName, setEditAccountName] = React.useState("");
  const [editAccountCurrencyCode, setEditAccountCurrencyCode] = React.useState("NOK");
  const [editAccountHistory, setEditAccountHistory] = React.useState<AccountHistorySummary | null>(null);
  const [editAccountFieldError, setEditAccountFieldError] =
    React.useState<AccountInputValidationError | null>(null);
  const [editAccountError, setEditAccountError] = React.useState<string | null>(null);
  const [editAccountStatus, setEditAccountStatus] = React.useState<string | null>(null);
  const [isLoadingEditContext, setIsLoadingEditContext] = React.useState(false);
  const [isUpdatingAccount, setIsUpdatingAccount] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const checkpointFormRef = React.useRef<HTMLFormElement>(null);
  const checkpointDateInputRef = React.useRef<HTMLInputElement>(null);
  const accountFormRef = React.useRef<HTMLFormElement>(null);
  const editAccountNameInputRef = React.useRef<HTMLInputElement>(null);
  const editButtonRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const editContextRequestId = React.useRef(0);
  const previousEditingAccountId = React.useRef<string | null>(null);
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const accountImportJobs = importJobs.filter((job) => job.accountId === selectedAccountId);
  const activeAccountCount = accounts.filter((account) => account.archivedAtIso === undefined).length;

  React.useEffect(() => {
    let active = true;
    Promise.all([
      window.budgetApi.accounts.getCurrent(),
      window.budgetApi.import.history.list(),
    ])
      .then(async ([current, loadedImportJobs]) => {
        if (!active) return;
        if (current === null) {
          throw new Error("Household account is unavailable.");
        }
        const householdAccounts = await window.budgetApi.accounts.list(current.householdId);
        if (!active) return;
        setAccounts(householdAccounts);
        setImportJobs(loadedImportJobs);
        setSelectedAccountId((selected) => selected || householdAccounts[0]?.id || "");
        setIsLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(errorMessage(loadError, "Unable to load household accounts."));
        setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  React.useEffect(() => {
    if (selectedAccountId === "") return;
    let active = true;
    setError(null);
    setIsLoading(true);
    loadAccountCoverageData(selectedAccountId)
      .then((loaded) => {
        if (active) setData(loaded);
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError, "Unable to load account coverage."));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedAccountId, revision]);

  React.useEffect(() => {
    if (editingAccountId !== null && !isLoadingEditContext) {
      editAccountNameInputRef.current?.focus();
    }
    if (editingAccountId === null && previousEditingAccountId.current !== null) {
      editButtonRefs.current.get(previousEditingAccountId.current)?.focus();
    }
    previousEditingAccountId.current = editingAccountId;
  }, [editingAccountId, isLoadingEditContext]);

  async function refresh(): Promise<void> {
    if (selectedAccountId === "") return;
    setRevision((current) => current + 1);
  }

  async function createAccount(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isCreatingAccount) return;

    setAccountFieldError(null);
    setAccountError(null);
    setAccountStatus(null);
    let input: ReturnType<typeof normalizeAccountInput>;
    try {
      input = normalizeAccountInput({
        accountName,
        currencyCode: accountCurrencyCode,
      });
    } catch (validationError: unknown) {
      if (!(validationError instanceof AccountInputValidationError)) throw validationError;
      setAccountFieldError(validationError);
      accountFormRef.current
        ?.querySelector<HTMLInputElement>(`[name="${validationError.field}"]`)
        ?.focus();
      return;
    }

    setIsCreatingAccount(true);
    try {
      const account = await window.budgetApi.accounts.create(input);
      setAccounts((current) => [...current, account]);
      setSelectedAccountId(account.id);
      setAccountName("");
      setAccountCurrencyCode("NOK");
      setAccountStatus(`${account.name} account added in ${account.currencyCode}.`);
      onAccountsChanged();
    } catch (createError: unknown) {
      setAccountError(errorMessage(createError, "Unable to add the account."));
    } finally {
      setIsCreatingAccount(false);
    }
  }

  async function beginAccountEdit(account: Account): Promise<void> {
    const requestId = editContextRequestId.current + 1;
    editContextRequestId.current = requestId;
    setEditingAccountId(account.id);
    setEditAccountName(account.name);
    setEditAccountCurrencyCode(account.currencyCode);
    setEditAccountHistory(null);
    setEditAccountFieldError(null);
    setEditAccountError(null);
    setEditAccountStatus(null);
    setAccountStatus(null);
    setIsLoadingEditContext(true);

    try {
      const history = await window.budgetApi.accounts.getHistorySummary(account.id);
      if (editContextRequestId.current === requestId) setEditAccountHistory(history);
    } catch (loadError: unknown) {
      if (editContextRequestId.current === requestId) {
        setEditAccountError(errorMessage(loadError, "Unable to load account history."));
      }
    } finally {
      if (editContextRequestId.current === requestId) setIsLoadingEditContext(false);
    }
  }

  function cancelAccountEdit(): void {
    editContextRequestId.current += 1;
    setEditingAccountId(null);
    setEditAccountHistory(null);
    setEditAccountFieldError(null);
    setEditAccountError(null);
    setEditAccountStatus(null);
    setIsLoadingEditContext(false);
  }

  async function updateAccount(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editingAccountId === null || isUpdatingAccount || editAccountHistory === null) return;
    const account = accounts.find((candidate) => candidate.id === editingAccountId);
    if (account === undefined) {
      setEditAccountError("This account is no longer available. Reload the Accounts workspace.");
      return;
    }

    setEditAccountFieldError(null);
    setEditAccountError(null);
    setEditAccountStatus(null);
    setAccountStatus(null);
    let input: ReturnType<typeof normalizeAccountUpdateInput>;
    try {
      input = normalizeAccountUpdateInput({
        accountName: editAccountName,
        currencyCode: editAccountCurrencyCode,
      }, account.currencyCode, editAccountHistory);
    } catch (validationError: unknown) {
      if (!(validationError instanceof AccountInputValidationError)) throw validationError;
      setEditAccountFieldError(validationError);
      document.getElementById(`account-edit-${validationError.field}`)?.focus();
      return;
    }

    setIsUpdatingAccount(true);
    try {
      const updatedAccount = await window.budgetApi.accounts.update({
        accountId: account.id,
        ...input,
      });
      setAccounts((current) => current.map((candidate) =>
        candidate.id === updatedAccount.id ? updatedAccount : candidate
      ));
      setSelectedAccountId((current) => current === account.id ? updatedAccount.id : current);
      setEditingAccountId(null);
      setEditAccountHistory(null);
      setEditAccountStatus("Account updated.");
      onAccountsChanged();
    } catch (updateError: unknown) {
      const detail = updateError instanceof Error ? ` Details: ${updateError.message}` : "";
      setEditAccountError(
        `Unable to save account changes. Your edits are still available to retry.${detail}`
      );
    } finally {
      setIsUpdatingAccount(false);
    }
  }

  async function archiveAccount(account: Account): Promise<void> {
    if (archivingAccountId !== null) return;
    const confirmed = window.confirm(
      `Archive ${account.name}? It will be removed from active account selections, but its transactions, statement periods, checkpoints, and exports will be retained.`
    );
    if (!confirmed) return;

    setAccountArchiveError(null);
    setAccountStatus(null);
    setArchivingAccountId(account.id);
    try {
      const archivedAccount = await window.budgetApi.accounts.archive(account.id);
      setAccounts((current) => current.map((candidate) =>
        candidate.id === archivedAccount.id ? archivedAccount : candidate
      ));
      setAccountStatus(`${account.name} has been archived.`);
      onAccountsChanged();
    } catch (archiveError: unknown) {
      setAccountArchiveError(errorMessage(archiveError, "Unable to archive the account."));
    } finally {
      setArchivingAccountId(null);
    }
  }

  function focusCheckpointEntry(): void {
    checkpointFormRef.current?.scrollIntoView({ block: "center" });
    checkpointDateInputRef.current?.focus();
  }

  async function saveCoveragePeriod(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (selectedAccount === undefined || startDateIso === "" || endDateIso === "" || sourceName.trim() === "") {
      setError("Choose an account, coverage dates, and a statement source.");
      return;
    }
    setError(null);
    setStatusMessage(null);
    const selectedImportJob = accountImportJobs.find((job) => job.id === importJobId);
    const importedAtIso = selectedImportJob?.finishedAtIso ?? selectedImportJob?.startedAtIso;
    const period: AccountStatementCoveragePeriod = {
      id: window.crypto.randomUUID(),
      accountId: selectedAccount.id,
      startDateIso,
      endDateIso,
      currencyCode: selectedAccount.currencyCode,
      sourceName: sourceName.trim(),
      sourceType,
      confirmed: false,
      ...(importJobId === "" ? {} : { importJobId }),
      ...(importedAtIso === undefined ? {} : { importedAtIso }),
    };
    try {
      await window.budgetApi.accountCoverage.savePeriod(period);
      setSourceName("");
      setStatusMessage("Statement period saved as unconfirmed.");
      await refresh();
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, "Unable to save statement coverage."));
    }
  }

  async function confirmPeriod(period: AccountStatementCoveragePeriod): Promise<void> {
    setError(null);
    setStatusMessage(null);
    try {
      await window.budgetApi.accountCoverage.savePeriod({
        ...period,
        confirmed: true,
        confirmedAtIso: new Date().toISOString(),
      });
      setStatusMessage("Statement coverage confirmed.");
      await refresh();
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, "Unable to confirm statement coverage."));
    }
  }

  async function saveCheckpoint(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const balanceMinor = parseAmountMinor(checkpointBalance);
    if (
      selectedAccount === undefined ||
      checkpointDateIso === "" ||
      balanceMinor === null ||
      checkpointSource.trim() === ""
    ) {
      setError("Enter a valid checkpoint date, balance, and source.");
      return;
    }
    setError(null);
    setStatusMessage(null);
    const checkpoint: AccountBalanceCheckpoint = {
      id: window.crypto.randomUUID(),
      accountId: selectedAccount.id,
      dateIso: checkpointDateIso,
      currencyCode: selectedAccount.currencyCode,
      balanceMinor,
      source: checkpointSource.trim(),
      recordedAtIso: new Date().toISOString(),
    };
    try {
      await window.budgetApi.accountCoverage.appendCheckpoint(checkpoint);
      setCheckpointBalance("");
      setCheckpointSource("");
      setStatusMessage("Balance checkpoint saved.");
      await refresh();
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, "Unable to save balance checkpoint."));
    }
  }

  return (
    <section className="account-coverage-section" aria-label="Account statement coverage" aria-busy={isLoading}>
      <div className="section-heading destination-heading">
        <h2>Account statement coverage</h2>
        <p>Record confirmed statement periods and dated balance checkpoints before relying on account trends.</p>
      </div>

      <section className="account-management" aria-labelledby="account-management-heading">
        <div className="account-management-heading">
          <h3 id="account-management-heading">Household accounts</h3>
          <p>Accounts are stored on this device and remain part of the household ledger.</p>
        </div>
        {accounts.length > 0 && (
          <ul className="account-management-list" aria-label="Household accounts">
            {accounts.map((account) => {
              const isEditing = editingAccountId === account.id;
              const accountHasHistory = isEditing && hasAccountHistory(editAccountHistory);
              return (
                <li key={account.id}>
                  {isEditing ? (
                    <form
                      className="account-coverage-form account-management-edit-form"
                      aria-label={`Edit account ${account.name}`}
                      noValidate
                      onSubmit={(event) => void updateAccount(event)}
                    >
                      <label>
                        Account name
                        <input
                          id="account-edit-accountName"
                          name="accountName"
                          aria-invalid={editAccountFieldError?.field === "accountName" || undefined}
                          aria-describedby={
                            editAccountFieldError?.field === "accountName"
                              ? "account-edit-accountName-error"
                              : undefined
                          }
                          autoComplete="off"
                          maxLength={100}
                          onChange={(event) => {
                            setEditAccountName(event.currentTarget.value);
                            setEditAccountFieldError(null);
                            setEditAccountError(null);
                          }}
                          ref={editAccountNameInputRef}
                          value={editAccountName}
                        />
                      </label>
                      <label>
                        Currency code
                        <input
                          id="account-edit-currencyCode"
                          name="currencyCode"
                          aria-invalid={editAccountFieldError?.field === "currencyCode" || undefined}
                          aria-describedby={[
                            editAccountFieldError?.field === "currencyCode"
                              ? "account-edit-currencyCode-error"
                              : null,
                            accountHasHistory ? "account-edit-currency-guidance" : null,
                          ].filter((value): value is string => value !== null).join(" ") || undefined}
                          autoCapitalize="characters"
                          disabled={isLoadingEditContext || accountHasHistory}
                          maxLength={3}
                          onChange={(event) => {
                            setEditAccountCurrencyCode(event.currentTarget.value.toUpperCase());
                            setEditAccountFieldError(null);
                            setEditAccountError(null);
                          }}
                          pattern="[A-Za-z]{3}"
                          value={editAccountCurrencyCode}
                        />
                      </label>
                      {isLoadingEditContext && (
                        <p className="account-coverage-message" role="status">Checking account history...</p>
                      )}
                      {accountHasHistory && (
                        <p id="account-edit-currency-guidance" className="account-coverage-message">
                          Currency cannot be changed while transactions, statement coverage or checkpoints exist.
                          Create another account instead.
                        </p>
                      )}
                      {editAccountFieldError !== null && (
                        <p
                          id={`account-edit-${editAccountFieldError.field}-error`}
                          className="account-coverage-message is-error"
                          role="alert"
                        >
                          {editAccountFieldError.message}
                        </p>
                      )}
                      {editAccountError !== null && (
                        <p className="account-coverage-message is-error" role="alert">{editAccountError}</p>
                      )}
                      <div className="account-management-edit-actions">
                        <button
                          type="submit"
                          disabled={isLoadingEditContext || editAccountHistory === null || isUpdatingAccount}
                        >
                          {isUpdatingAccount ? "Saving account..." : "Save account changes"}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={isUpdatingAccount}
                          onClick={cancelAccountEdit}
                        >
                          Cancel edit
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="account-management-summary">
                        <strong>{account.name}</strong>
                        <span>{account.currencyCode}</span>
                        {account.archivedAtIso !== undefined && <span>Archived</span>}
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        aria-label={`Edit account ${account.name}`}
                        ref={(element) => {
                          if (element === null) editButtonRefs.current.delete(account.id);
                          else editButtonRefs.current.set(account.id, element);
                        }}
                        onClick={() => void beginAccountEdit(account)}
                      >
                        Edit
                      </button>
                      {account.archivedAtIso === undefined && (
                        <button
                          type="button"
                          className="secondary-button"
                          aria-label={`Archive account ${account.name}`}
                          disabled={activeAccountCount <= 1 || archivingAccountId !== null}
                          onClick={() => void archiveAccount(account)}
                        >
                          {archivingAccountId === account.id ? "Archiving..." : "Archive"}
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {editAccountStatus !== null && (
          <p className="account-coverage-message is-success" role="status" aria-label="Account management status">
            {editAccountStatus}
          </p>
        )}
        {activeAccountCount <= 1 && (
          <p className="account-coverage-message">
            Keep at least one active account. Add another account before archiving this one.
          </p>
        )}
        {accountArchiveError !== null && (
          <p className="account-coverage-message is-error" role="alert">{accountArchiveError}</p>
        )}
        {accountStatus !== null && (
          <p className="account-coverage-message is-success" role="status" aria-label="Account management status">
            {accountStatus}
          </p>
        )}
        <form
          ref={accountFormRef}
          className="account-coverage-form account-management-form"
          aria-label="Add account"
          noValidate
          onSubmit={(event) => void createAccount(event)}
        >
          <div className="account-coverage-form-heading">
            <h3>Add an account</h3>
            <p>Add another account to the existing household without changing its current records.</p>
          </div>
          <label>
            Account name
            <input
              name="accountName"
              aria-invalid={accountFieldError?.field === "accountName" || undefined}
              aria-describedby={accountFieldError?.field === "accountName" ? "account-field-error" : undefined}
              autoComplete="off"
              maxLength={100}
              onChange={(event) => setAccountName(event.currentTarget.value)}
              value={accountName}
            />
          </label>
          <label>
            Currency code
            <input
              name="currencyCode"
              aria-invalid={accountFieldError?.field === "currencyCode" || undefined}
              aria-describedby={accountFieldError?.field === "currencyCode" ? "account-field-error" : undefined}
              autoCapitalize="characters"
              maxLength={3}
              onChange={(event) => setAccountCurrencyCode(event.currentTarget.value.toUpperCase())}
              pattern="[A-Za-z]{3}"
              value={accountCurrencyCode}
            />
          </label>
          {accountFieldError !== null && (
            <p id="account-field-error" className="account-coverage-message is-error" role="alert">
              {accountFieldError.message}
            </p>
          )}
          {accountError !== null && (
            <p className="account-coverage-message is-error" role="alert">{accountError}</p>
          )}
          <button type="submit" disabled={isCreatingAccount}>
            {isCreatingAccount ? "Adding account..." : "Add account"}
          </button>
        </form>
      </section>

      {error !== null && <p className="account-coverage-message is-error" role="alert">{error}</p>}
      {statusMessage !== null && <p className="account-coverage-message is-success" role="status">{statusMessage}</p>}
      {isLoading && <p className="account-coverage-message" role="status">Loading account coverage...</p>}

      <div className="account-coverage-account-picker">
        <label>
          Coverage account
          <select
            aria-label="Coverage account"
            value={selectedAccountId}
            onChange={(event) => setSelectedAccountId(event.target.value)}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name} ({account.currencyCode})</option>
            ))}
          </select>
        </label>
        <p>
          Statement periods and checkpoints below belong to{" "}
          <strong>{selectedAccount?.name ?? "the selected account"}</strong>
          {selectedAccount === undefined ? "." : ` (${selectedAccount.currencyCode}).`}
        </p>
      </div>

      <div className="account-coverage-forms">
        <form className="account-coverage-form" aria-label="Record statement coverage" onSubmit={(event) => void saveCoveragePeriod(event)}>
          <div className="account-coverage-form-heading">
            <h3>Statement period</h3>
            <p>Start with the exact dates and source shown on the statement.</p>
          </div>
          <label>
            Statement start date
            <input type="date" value={startDateIso} onChange={(event) => setStartDateIso(event.target.value)} />
          </label>
          <label>
            Statement end date
            <input type="date" value={endDateIso} onChange={(event) => setEndDateIso(event.target.value)} />
          </label>
          <label>
            Statement source
            <input value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
          </label>
          <label>
            Coverage source type
            <select
              aria-label="Coverage source type"
              value={sourceType}
              onChange={(event) => {
                setSourceType(event.target.value as AccountStatementCoveragePeriod["sourceType"]);
                setImportJobId("");
              }}
            >
              <option value="manual">Manual confirmation</option>
              <option value="csv">CSV import</option>
              <option value="pdf">PDF import</option>
            </select>
          </label>
          {sourceType !== "manual" && (
            <label>
              Coverage import job
              <select
                aria-label="Coverage import job"
                value={importJobId}
                onChange={(event) => {
                  const selectedJobId = event.target.value;
                  setImportJobId(selectedJobId);
                  const selectedJob = accountImportJobs.find((job) => job.id === selectedJobId);
                  if (selectedJob !== undefined) setSourceName(selectedJob.sourceName);
                }}
              >
                <option value="">No linked import job</option>
                {accountImportJobs
                  .filter((job) => job.sourceType === sourceType)
                  .map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.sourceName} — {job.id}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <button type="submit" disabled={selectedAccountId === "" || isLoading}>
            Save statement period
          </button>
        </form>

        <form
          ref={checkpointFormRef}
          className="account-coverage-form"
          aria-label="Add balance checkpoint"
          onSubmit={(event) => void saveCheckpoint(event)}
        >
          <div className="account-coverage-form-heading">
            <h3>Balance checkpoints</h3>
            <p>After confirming a statement period, add or review its opening and closing balances here.</p>
          </div>
          <label>
            Checkpoint date
            <input
              ref={checkpointDateInputRef}
              type="date"
              value={checkpointDateIso}
              onChange={(event) => setCheckpointDateIso(event.target.value)}
            />
          </label>
          <label>
            Checkpoint balance
            <input
              inputMode="decimal"
              value={checkpointBalance}
              onChange={(event) => setCheckpointBalance(event.target.value)}
              aria-describedby="checkpoint-balance-hint"
            />
          </label>
          <label>
            Checkpoint source
            <input value={checkpointSource} onChange={(event) => setCheckpointSource(event.target.value)} />
          </label>
          <p id="checkpoint-balance-hint">Enter the account balance in {selectedAccount?.currencyCode ?? "account currency"}.</p>
          <button type="submit" disabled={selectedAccountId === "" || isLoading}>
            Save balance checkpoint
          </button>
        </form>
      </div>

      {data.periods.length === 0 && !isLoading && (
        <div className="empty-state">
          <strong>No statement periods recorded.</strong>
          <p>Start with a statement period, then add its opening and closing balance checkpoints.</p>
        </div>
      )}
      {data.periods.length > 0 && (
        <div className="account-coverage-list-heading">
          <h3>Recorded statement periods</h3>
          <span>{data.periods.length}</span>
        </div>
      )}
      <div className="account-coverage-period-list">
        {data.periods.map((period) => {
          const assessment = data.assessments.get(period.id);
          const coverageStatus = assessment?.coverageStatus === "confirmed"
            ? "Coverage confirmed"
            : "Unknown";
          const checkpointStatus = assessment?.checkpointStatus ?? "Loading";
          const periodCheckpoints = data.checkpoints.filter((checkpoint) =>
            checkpoint.accountId === period.accountId &&
            checkpoint.dateIso >= period.startDateIso &&
            checkpoint.dateIso <= period.endDateIso
          );
          const checkpointsAreReconciled =
            assessment?.checkpointStatus === "available" &&
            assessment.reconciliationStatus === "matched";
          return (
            <fieldset
              className="account-coverage-period"
              key={period.id}
              aria-label={`Coverage period ${period.startDateIso} to ${period.endDateIso}`}
            >
              <legend>{displayDate(period.startDateIso)} – {displayDate(period.endDateIso)}</legend>
              <div className="account-coverage-statuses">
                <p className={`coverage-status ${period.confirmed ? "is-confirmed" : "is-unknown"}`}>
                  Coverage status: <strong>{coverageStatus}</strong>
                </p>
                <p className={`checkpoint-status is-${assessment?.checkpointStatus ?? "loading"}`}>
                  Checkpoint status: <strong>{checkpointStatus}</strong>
                </p>
              </div>
              <p className="account-coverage-period-description">
                {assessment === undefined
                  ? "Checking booked activity for this period."
                  : assessment.periodStatus === "empty"
                  ? "No booked transactions in this period."
                  : assessment?.periodStatus === "overlapping"
                    ? "Overlapping statement period requires review."
                    : assessment?.periodStatus === "late-arriving"
                      ? "Late-arriving import requires review."
                      : "Booked activity is present in this period."}
              </p>
              {assessment?.differenceMinor !== null && assessment?.differenceMinor !== undefined && (
                <p className="account-coverage-difference">
                  Difference: <strong>{displayMinorAmount(assessment.differenceMinor, period.currencyCode)}</strong>
                </p>
              )}
              <div className="account-coverage-provenance">
                <p>Source: <strong>{period.sourceName}</strong> ({period.sourceType})</p>
                {period.importJobId !== undefined && <p>Import job: <code>{period.importJobId}</code></p>}
              </div>
              {!period.confirmed && (
                <>
                  <p className="account-coverage-period-description">
                    This period is saved but unconfirmed. Confirm it only after checking the statement dates and source.
                  </p>
                  <button className="action-secondary" type="button" onClick={() => void confirmPeriod(period)}>
                    Confirm coverage
                  </button>
                </>
              )}
              {period.confirmed && !checkpointsAreReconciled && (
                <div className="account-coverage-next-action">
                  <p role="status">Next: add or review balance checkpoints.</p>
                  <button
                    className="action-secondary"
                    type="button"
                    onClick={focusCheckpointEntry}
                  >
                    Add or review balance checkpoints
                  </button>
                </div>
              )}
              <ul aria-label="Balance checkpoint history">
                {periodCheckpoints.map((checkpoint) => (
                  <li key={checkpoint.id}>
                    <time dateTime={checkpoint.dateIso}>{displayDate(checkpoint.dateIso)}</time>
                    {" — "}
                    <strong>{displayMinorAmount(checkpoint.balanceMinor, checkpoint.currencyCode)}</strong>
                    {" — "}
                    {checkpoint.source}
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
