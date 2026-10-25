import React from "react";
import type {
  Account,
  AccountBalanceCheckpoint,
  AccountCoverageAssessment,
  AccountStatementCoveragePeriod,
} from "../../domain/types.js";
import type { ImportJobHistoryEntry } from "../../domain/import/importJobHistory.js";

const amountFormatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "long",
  timeZone: "UTC",
});

function displayMinorAmount(amountMinor: number, currencyCode: string): string {
  return `${currencyCode} ${amountFormatter.format(amountMinor / 100)}`;
}

function displayDate(dateIso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (match === null) return dateIso;
  return dateFormatter.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function parseAmountMinor(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amountMinor = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(amountMinor) ? amountMinor : null;
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

export function AccountCoverageSection(): React.JSX.Element {
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
  const [isLoading, setIsLoading] = React.useState(true);
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const accountImportJobs = importJobs.filter((job) => job.accountId === selectedAccountId);

  React.useEffect(() => {
    let active = true;
    Promise.all([
      window.budgetApi.accounts.getCurrent(),
      window.budgetApi.import.history.list(),
    ])
      .then(([current, loadedImportJobs]) => {
        if (!active) return;
        if (current === null) {
          throw new Error("Household account is unavailable.");
        }
        setAccounts(current.accounts);
        setImportJobs(loadedImportJobs);
        setSelectedAccountId((selected) => selected || current.accounts[0]?.id || "");
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
  }, []);

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

  async function refresh(): Promise<void> {
    if (selectedAccountId === "") return;
    setRevision((current) => current + 1);
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
      <div className="section-heading">
        <h2>Account statement coverage</h2>
        <p>Record confirmed statement periods and dated balance checkpoints before relying on account trends.</p>
      </div>

      {error !== null && <p className="account-coverage-message is-error" role="alert">{error}</p>}
      {statusMessage !== null && <p className="account-coverage-message is-success" role="status">{statusMessage}</p>}
      {isLoading && <p className="account-coverage-message" role="status">Loading account coverage...</p>}

      <div className="account-coverage-forms">
        <form className="account-coverage-form" aria-label="Record statement coverage" onSubmit={(event) => void saveCoveragePeriod(event)}>
          <div className="account-coverage-form-heading">
            <h3>Statement period</h3>
            <p>Record the exact dates and source shown on the statement.</p>
          </div>
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

        <form className="account-coverage-form" aria-label="Add balance checkpoint" onSubmit={(event) => void saveCheckpoint(event)}>
          <div className="account-coverage-form-heading">
            <h3>Balance checkpoint</h3>
            <p>Keep opening and closing observations as dated history.</p>
          </div>
          <label>
            Checkpoint date
            <input type="date" value={checkpointDateIso} onChange={(event) => setCheckpointDateIso(event.target.value)} />
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
          <p className="account-coverage-account-context">
            Recording for <strong>{selectedAccount?.name ?? "the selected account"}</strong>
            {selectedAccount === undefined ? "" : ` (${selectedAccount.currencyCode})`}
          </p>
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
                <button className="action-secondary" type="button" onClick={() => void confirmPeriod(period)}>
                  Confirm coverage
                </button>
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
