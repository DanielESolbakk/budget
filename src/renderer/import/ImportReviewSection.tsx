import React from "react";
import type {
  ImportReviewCorrectionResult,
  ImportReviewDismissalResult,
} from "../../app/reviewService.js";
import type { Account, ImportReviewItem } from "../../domain/types.js";
import { CSV_COLUMN_NAMES } from "../../domain/import/csvColumns.js";

interface ImportReviewSectionProps {
  isActive: boolean;
  refreshKey: number;
  onReviewChange: () => void;
}

interface ImportReviewDraft {
  bookedAtIso: string;
  amount: string;
  merchantRaw: string;
  accountId: string;
  currencyCode: string;
  dismissalReason: string;
  sourceEvidenceError?: string;
}

interface SourceRowFields {
  [key: string]: string;
}

const IMPORT_REVIEW_DRAFT_STORAGE_PREFIX = "budget.import-review-draft.v1:";

function importReviewDraftStorageKey(itemId: string): string {
  return `${IMPORT_REVIEW_DRAFT_STORAGE_PREFIX}${itemId}`;
}

function isImportReviewDraft(value: unknown): value is ImportReviewDraft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.bookedAtIso === "string" &&
    typeof draft.amount === "string" &&
    typeof draft.merchantRaw === "string" &&
    typeof draft.accountId === "string" &&
    typeof draft.currencyCode === "string" &&
    typeof draft.dismissalReason === "string" &&
    (draft.sourceEvidenceError === undefined || typeof draft.sourceEvidenceError === "string")
  );
}

function readSavedDraft(item: ImportReviewItem): { draft?: ImportReviewDraft; error?: string } {
  try {
    const storedDraft = window.localStorage.getItem(importReviewDraftStorageKey(item.id));
    if (storedDraft === null) return {};
    const parsed: unknown = JSON.parse(storedDraft);
    if (!isImportReviewDraft(parsed)) {
      return {
        error: `The saved correction for row ${item.sourceRowIndex + 1} could not be restored. Check the original source row and enter the correction again.`,
      };
    }
    return { draft: parsed };
  } catch (error: unknown) {
    const reason = error instanceof Error ? ` ${error.message}` : "";
    return {
      error: `The saved correction for row ${item.sourceRowIndex + 1} could not be read from this device.${reason}`,
    };
  }
}

function parseCsvSourceRow(item: ImportReviewItem): { fields?: SourceRowFields; error?: string } {
  if (item.sourceType !== "csv") return {};

  try {
    const parsed: unknown = JSON.parse(item.rawRow);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { error: "CSV source fields could not be read. Enter the transaction details manually." };
    }
    const entries = Object.entries(parsed);
    if (!entries.every(([, value]) => typeof value === "string")) {
      return { error: "CSV source fields could not be read. Enter the transaction details manually." };
    }
    return { fields: Object.fromEntries(entries) as SourceRowFields };
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return { error: "CSV source fields could not be read. Enter the transaction details manually." };
    }
    throw error;
  }
}

function toDateInputValue(value: string): string {
  const norwegianDate = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (norwegianDate !== null) {
    return `${norwegianDate[3]}-${norwegianDate[2]}-${norwegianDate[1]}`;
  }
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

function toAmountInputValue(amountIn: string, amountOut: string): string {
  const isOutflow = amountOut.trim().length > 0;
  const rawAmount = (isOutflow ? amountOut : amountIn).trim();
  const normalized = rawAmount.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return "";
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return "";
  return (isOutflow ? -Math.abs(amount) : amount).toFixed(2);
}

function createDraft(item: ImportReviewItem, accounts: readonly Account[]): ImportReviewDraft {
  const source = parseCsvSourceRow(item);
  const fields = source.fields ?? {};
  return {
    bookedAtIso: toDateInputValue(fields[CSV_COLUMN_NAMES.bookedDate] ?? fields[CSV_COLUMN_NAMES.executionDate] ?? ""),
    amount: toAmountInputValue(
      fields[CSV_COLUMN_NAMES.amountIn] ?? "",
      fields[CSV_COLUMN_NAMES.amountOut] ?? ""
    ),
    merchantRaw: fields[CSV_COLUMN_NAMES.description] ?? "",
    accountId: accounts.some((account) => account.id === item.accountId)
      ? item.accountId
      : accounts[0]?.id ?? "",
    currencyCode: fields[CSV_COLUMN_NAMES.currency] ?? accounts[0]?.currencyCode ?? "NOK",
    dismissalReason: "",
    ...(source.error === undefined ? {} : { sourceEvidenceError: source.error }),
  };
}

function toAmountMinor(value: string): number | undefined {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return undefined;
  const amountMinor = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(amountMinor) ? amountMinor : undefined;
}

function fileNameFromPath(filePath: string): string {
  return filePath.trim().split(/[\\/]/).at(-1) || filePath;
}

function statusLabel(status: ImportReviewItem["status"]): string {
  if (status === "corrected") return "Corrected";
  if (status === "dismissed") return "Dismissed";
  return "Needs review";
}

const CSV_DIAGNOSTIC_FIELD_LABELS: Record<string, string> = {
  [CSV_COLUMN_NAMES.executionDate]: "Execution date",
  [CSV_COLUMN_NAMES.bookedDate]: "Booked date",
  [CSV_COLUMN_NAMES.description]: "Description",
  [CSV_COLUMN_NAMES.amountIn]: "Amount in",
  [CSV_COLUMN_NAMES.amountOut]: "Amount out",
  [CSV_COLUMN_NAMES.currency]: "Currency",
  [CSV_COLUMN_NAMES.status]: "Status",
  [CSV_COLUMN_NAMES.reference]: "Reference",
};

const CSV_DIAGNOSTIC_MESSAGES: Record<string, string> = {
  EMPTY_CSV: "The CSV file has no transaction rows.",
  INVALID_ROW_SHAPE: "The row does not match the CSV header. Check the original source row.",
  MISSING_DATE: "Add a booked date or an execution date.",
  INVALID_DATE_FORMAT: "Use the date format shown in the original source row (dd.MM.yyyy).",
  MISSING_DESCRIPTION: "Add a transaction description.",
  AMBIGUOUS_AMOUNT: "Use either an incoming or outgoing amount, not both.",
  INVALID_AMOUNT_FORMAT: "Enter a valid amount. Check the original source row.",
};

function formatParserDiagnostic(
  item: ImportReviewItem,
  error: ImportReviewItem["parserErrors"][number]
): string {
  const field = error.field === undefined
    ? undefined
    : item.sourceType === "csv"
      ? CSV_DIAGNOSTIC_FIELD_LABELS[error.field] ?? error.field
      : error.field;
  const message = item.sourceType === "csv"
    ? CSV_DIAGNOSTIC_MESSAGES[error.code] ?? error.message
    : error.message;
  return field === undefined ? message : `${field}: ${message}`;
}

function parserDiagnosticSummary(item: ImportReviewItem): string {
  const codes = new Set(item.parserErrors.map((error) => error.code));
  const issues: string[] = [];
  if (codes.has("MISSING_DATE") || codes.has("INVALID_DATE_FORMAT")) issues.push("date");
  if (codes.has("MISSING_DESCRIPTION")) issues.push("description");
  if (codes.has("INVALID_AMOUNT_FORMAT") || codes.has("AMBIGUOUS_AMOUNT")) issues.push("amount");
  if (codes.has("INVALID_ROW_SHAPE") || issues.length === 0) issues.push("source row");

  const finalIssue = issues.pop() ?? "source row";
  const summary = issues.length === 0
    ? finalIssue
    : `${issues.join(", ")} and ${finalIssue}`;
  return `Review the ${summary}.`;
}

export function ImportReviewSection({
  isActive,
  refreshKey,
  onReviewChange,
}: ImportReviewSectionProps): React.JSX.Element {
  const [items, setItems] = React.useState<ImportReviewItem[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [drafts, setDrafts] = React.useState<Record<string, ImportReviewDraft>>({});
  const [draftStorageError, setDraftStorageError] = React.useState<string | null>(null);
  const [loadState, setLoadState] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionErrors, setActionErrors] = React.useState<Record<string, string>>({});
  const [pendingItemId, setPendingItemId] = React.useState<string | null>(null);
  const [retryKey, setRetryKey] = React.useState(0);

  React.useEffect(() => {
    if (!isActive) return;

    let active = true;
    setLoadState("loading");
    setLoadError(null);
    Promise.all([
      window.budgetApi.import.review.list(),
      window.budgetApi.accounts.getCurrent(),
    ]).then(([loadedItems, current]) => {
      if (!active) return;
      const loadedAccounts = current?.accounts ?? [];
      const restoredDrafts: Record<string, ImportReviewDraft> = {};
      const draftReadErrors: string[] = [];
      for (const item of loadedItems) {
        if (item.status !== "unresolved") continue;
        const storedDraft = readSavedDraft(item);
        if (storedDraft.draft !== undefined) restoredDrafts[item.id] = storedDraft.draft;
        if (storedDraft.error !== undefined) draftReadErrors.push(storedDraft.error);
      }
      setItems(loadedItems);
      setAccounts(loadedAccounts);
      setDraftStorageError(draftReadErrors.length === 0 ? null : draftReadErrors.join(" "));
      setDrafts((currentDrafts) => Object.fromEntries(
        loadedItems
          .filter((item) => item.status === "unresolved")
          .map((item) => [
            item.id,
            currentDrafts[item.id] ?? restoredDrafts[item.id] ?? createDraft(item, loadedAccounts),
          ])
      ));
      setLoadState("ready");
    }).catch((error: unknown) => {
      if (!active) return;
      setLoadError(error instanceof Error ? error.message : "Could not load import review items.");
      setLoadState("error");
    });

    return () => {
      active = false;
    };
  }, [isActive, refreshKey, retryKey]);

  React.useEffect(() => {
    for (const [itemId, draft] of Object.entries(drafts)) {
      try {
        window.localStorage.setItem(importReviewDraftStorageKey(itemId), JSON.stringify(draft));
      } catch (error: unknown) {
        const reason = error instanceof Error ? ` ${error.message}` : "";
        setDraftStorageError(
          `Correction drafts could not be saved on this device. Save each correction before closing the app.${reason}`
        );
        return;
      }
    }
  }, [drafts]);

  function updateDraft(itemId: string, field: keyof ImportReviewDraft, value: string): void {
    setDraftStorageError(null);
    setDrafts((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] ?? {
          bookedAtIso: "",
          amount: "",
          merchantRaw: "",
          accountId: "",
          currencyCode: "",
          dismissalReason: "",
        }),
        [field]: value,
      },
    }));
    setActionErrors((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  function removeSavedDraft(itemId: string): void {
    try {
      window.localStorage.removeItem(importReviewDraftStorageKey(itemId));
    } catch (error: unknown) {
      const reason = error instanceof Error ? ` ${error.message}` : "";
      setDraftStorageError(
        `The review decision was saved, but its temporary correction draft could not be cleared from this device.${reason}`
      );
    }
  }

  async function saveCorrection(item: ImportReviewItem): Promise<void> {
    const draft = drafts[item.id];
    if (draft === undefined) return;
    const amountMinor = toAmountMinor(draft.amount);
    if (amountMinor === undefined) {
      setActionErrors((current) => ({ ...current, [item.id]: "Enter a valid amount with up to two decimal places." }));
      return;
    }

    setPendingItemId(item.id);
    setActionErrors((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    try {
      const response: ImportReviewCorrectionResult = await window.budgetApi.import.review.correct({
        reviewItemId: item.id,
        correction: {
          bookedAtIso: draft.bookedAtIso,
          amountMinor,
          merchantRaw: draft.merchantRaw,
          accountId: draft.accountId,
          currencyCode: draft.currencyCode,
        },
      });
      if (!response.ok) {
        setActionErrors((current) => ({ ...current, [item.id]: response.message }));
        return;
      }
      removeSavedDraft(item.id);
      setItems((current) => current.map((candidate) =>
        candidate.id === item.id ? response.item : candidate
      ));
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      onReviewChange();
    } catch (error: unknown) {
      setActionErrors((current) => ({
        ...current,
        [item.id]: error instanceof Error ? error.message : "Could not save the corrected transaction.",
      }));
    } finally {
      setPendingItemId(null);
    }
  }

  async function dismissItem(item: ImportReviewItem): Promise<void> {
    const reason = drafts[item.id]?.dismissalReason ?? "";
    if (!reason.trim()) return;

    setPendingItemId(item.id);
    setActionErrors((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    try {
      const response: ImportReviewDismissalResult = await window.budgetApi.import.review.dismiss({
        reviewItemId: item.id,
        reason,
      });
      if (!response.ok) {
        setActionErrors((current) => ({ ...current, [item.id]: response.message }));
        return;
      }
      removeSavedDraft(item.id);
      setItems((current) => current.map((candidate) =>
        candidate.id === item.id ? response.item : candidate
      ));
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      onReviewChange();
    } catch (error: unknown) {
      setActionErrors((current) => ({
        ...current,
        [item.id]: error instanceof Error ? error.message : "Could not dismiss the unresolved row.",
      }));
    } finally {
      setPendingItemId(null);
    }
  }

  const unresolvedItems = items.filter((item) => item.status === "unresolved");
  const reviewedItems = items.filter((item) => item.status !== "unresolved");

  function renderReviewItem(item: ImportReviewItem): React.JSX.Element {
    const rowNumber = item.sourceRowIndex + 1;
    const draft = drafts[item.id];
    const isPending = pendingItemId === item.id;

    return (
      <li key={item.id}>
        <section className="import-review-row" role="group" aria-label={`Import review row ${rowNumber}`}>
          <div className="import-review-source">
            <p className="import-review-status" role="status">{statusLabel(item.status)}</p>
            <p><strong>Source:</strong> {fileNameFromPath(item.sourceName)}</p>
            <p><strong>Row:</strong> {rowNumber}</p>
            <details>
              <summary>Original source row</summary>
              <pre>{item.rawRow}</pre>
            </details>
            {item.sourceEvidence !== undefined && (
              <details className="import-review-source-evidence">
                <summary>PDF source page evidence</summary>
                <p>Page {item.sourceEvidence.pageNumber}</p>
                <ol aria-label={`PDF page ${item.sourceEvidence.pageNumber} source lines`}>
                  {item.sourceEvidence.sourceLines.map((line) => (
                    <li key={`${line.pageNumber}-${line.lineNumber}-${line.startOffset}`}>
                      <p>
                        Line {line.lineNumber} - offsets {line.startOffset}-{line.endOffset}
                        {line.classification === undefined ? "" : ` - ${line.classification}`}
                      </p>
                      <pre>{line.rawText || "(blank line)"}</pre>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {item.parserErrors.length > 0 && (
              <div className="import-review-diagnostics">
                <p className="import-review-diagnostic-summary">{parserDiagnosticSummary(item)}</p>
                <details>
                  <summary>Why this row needs review ({item.parserErrors.length})</summary>
                  <ul aria-label="Parser diagnostics">
                    {item.parserErrors.map((error, index) => (
                      <li key={`${error.code}-${index}`}>{formatParserDiagnostic(item, error)}</li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
            {item.status === "corrected" && (
              <p>
                Corrected transaction {item.correctedTransactionId} at {item.correctedAtIso}.
              </p>
            )}
            {item.status === "dismissed" && (
              <p>
                Dismissed at {item.dismissedAtIso}: {item.dismissalReason}
              </p>
            )}
          </div>
          {item.status === "unresolved" && draft !== undefined && (
            <div className="import-review-actions">
              {draft.sourceEvidenceError !== undefined && <p role="alert">{draft.sourceEvidenceError}</p>}
              <details className="import-review-resolution">
                <summary>Correct transaction</summary>
                <form
                  aria-label={`Correct import review row ${rowNumber}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveCorrection(item);
                  }}
                >
                  <label htmlFor={`import-review-date-${item.id}`}>Transaction date</label>
                  <input
                    id={`import-review-date-${item.id}`}
                    type="date"
                    aria-describedby={`import-review-date-help-${item.id}`}
                    value={draft.bookedAtIso}
                    onChange={(event) => updateDraft(item.id, "bookedAtIso", event.target.value)}
                    required
                    disabled={isPending}
                  />
                  <p id={`import-review-date-help-${item.id}`} className="import-review-field-help">
                    Use the booked date when available; otherwise use the execution date.
                  </p>
                  <label htmlFor={`import-review-amount-${item.id}`}>Amount</label>
                  <input
                    id={`import-review-amount-${item.id}`}
                    type="number"
                    step="0.01"
                    aria-describedby={`import-review-amount-help-${item.id}`}
                    value={draft.amount}
                    onChange={(event) => updateDraft(item.id, "amount", event.target.value)}
                    required
                    disabled={isPending}
                  />
                  <p id={`import-review-amount-help-${item.id}`} className="import-review-field-help">
                    Enter income as a positive amount and spending as a negative amount.
                  </p>
                  <label htmlFor={`import-review-merchant-${item.id}`}>Merchant</label>
                  <input
                    id={`import-review-merchant-${item.id}`}
                    type="text"
                    value={draft.merchantRaw}
                    onChange={(event) => updateDraft(item.id, "merchantRaw", event.target.value)}
                    required
                    disabled={isPending}
                  />
                  <label htmlFor={`import-review-account-${item.id}`}>Account</label>
                  <select
                    id={`import-review-account-${item.id}`}
                    value={draft.accountId}
                    onChange={(event) => updateDraft(item.id, "accountId", event.target.value)}
                    required
                    disabled={isPending || accounts.length === 0}
                  >
                    <option value="" disabled>Select an account</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>{account.name}</option>
                    ))}
                  </select>
                  <label htmlFor={`import-review-currency-${item.id}`}>Currency</label>
                  <input
                    id={`import-review-currency-${item.id}`}
                    type="text"
                    value={draft.currencyCode}
                    onChange={(event) => updateDraft(item.id, "currencyCode", event.target.value)}
                    maxLength={3}
                    required
                    disabled={isPending}
                  />
                  <button type="submit" disabled={isPending || accounts.length === 0}>
                    Save corrected transaction
                  </button>
                </form>
              </details>
              <details className="import-review-resolution">
                <summary>Dismiss this row</summary>
                <label htmlFor={`import-review-dismiss-reason-${item.id}`}>Reason for dismissal (required)</label>
                <p id={`import-review-dismiss-reason-help-${item.id}`} className="import-review-field-help">
                  Required. This reason is saved with the original row in your local review history.
                </p>
                <textarea
                  id={`import-review-dismiss-reason-${item.id}`}
                  aria-describedby={`import-review-dismiss-reason-help-${item.id}`}
                  value={draft.dismissalReason}
                  onChange={(event) => updateDraft(item.id, "dismissalReason", event.target.value)}
                  required
                  disabled={isPending}
                />
                <button
                  type="button"
                  className="import-secondary-action"
                  onClick={() => void dismissItem(item)}
                  disabled={isPending || draft.dismissalReason.trim().length === 0}
                >
                  Dismiss row
                </button>
              </details>
              {actionErrors[item.id] !== undefined && <p role="alert">{actionErrors[item.id]}</p>}
            </div>
          )}
        </section>
      </li>
    );
  }

  return (
    <section id="import-review-queue" className="import-review-queue" aria-label="Import review queue" tabIndex={-1}>
      <h3>Import review</h3>
      <p className="section-intro">Unresolved source rows stay out of the ledger until you correct or dismiss them.</p>
      {draftStorageError === null
        ? <p className="import-review-draft-note">Correction drafts are saved on this device and remain available after you close the app.</p>
        : <p className="import-review-draft-error" role="alert">{draftStorageError}</p>}
      {loadState === "loading" && <p role="status">Loading import review...</p>}
      {loadState === "error" && (
        <div role="alert">
          <p>{loadError ?? "Could not load import review items."}</p>
          <button type="button" onClick={() => setRetryKey((current) => current + 1)}>Retry import review</button>
        </div>
      )}
      {loadState === "ready" && unresolvedItems.length === 0 && (
        <p className="empty-state">No import rows need review.</p>
      )}
      {loadState === "ready" && unresolvedItems.length > 0 && (
        <ul className="import-review-list" aria-label="Import review items">
          {unresolvedItems.map(renderReviewItem)}
        </ul>
      )}
      {loadState === "ready" && reviewedItems.length > 0 && (
        <details className="import-reviewed-history">
          <summary>Reviewed rows ({reviewedItems.length})</summary>
          <ul className="import-review-list" aria-label="Reviewed import items">
            {reviewedItems.map(renderReviewItem)}
          </ul>
        </details>
      )}
    </section>
  );
}
