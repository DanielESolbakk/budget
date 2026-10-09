import React from "react";
import type {
  SameMerchantPropagationOperation,
  SameMerchantPropagationPreview,
  Transaction,
} from "../../domain/types.js";
import { CATEGORY_OPTIONS } from "./categoryOptions.js";

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function formatAmount(amountMinor: number, currencyCode = "NOK"): string {
  let formatter = currencyFormatters.get(currencyCode);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat("nb-NO", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currencyFormatters.set(currencyCode, formatter);
  }
  return formatter.format(amountMinor / 100);
}

function getCategoryLabel(categoryId: string): string {
  return CATEGORY_OPTIONS.find((category) => category.id === categoryId)?.label ?? categoryId;
}

function getCategorizationReviewReason(transaction: Transaction): string | undefined {
  const categorization = transaction.categorization;
  if (categorization === undefined) return undefined;
  if (categorization.status === "unmatched") return "No matching rule";
  if (categorization.status === "ambiguous") return "Conflicting rules";
  return "Low confidence";
}

interface CategoryReviewSectionProps {
  refreshKey: number;
  onCategorySaved: () => void;
  onUncategorizedQueueStateChange: (state: UncategorizedQueueState) => void;
  focusFirstRequest: number;
}

export interface UncategorizedQueueState {
  count: number;
  isReady: boolean;
}

export function CategoryReviewSection({
  refreshKey,
  onCategorySaved,
  onUncategorizedQueueStateChange,
  focusFirstRequest,
}: CategoryReviewSectionProps): React.JSX.Element {
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [selectedCategories, setSelectedCategories] = React.useState<Record<string, string>>({});
  const [hasLoaded, setHasLoaded] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveStatus, setSaveStatus] = React.useState<string | null>(null);
  const [propagationPreview, setPropagationPreview] = React.useState<SameMerchantPropagationPreview | null>(null);
  const [propagationDialogMode, setPropagationDialogMode] = React.useState<"preview" | "confirmation" | null>(null);
  const [selectedPropagationTransactionIds, setSelectedPropagationTransactionIds] = React.useState<string[]>([]);
  const [propagationError, setPropagationError] = React.useState<string | null>(null);
  const [propagationResult, setPropagationResult] = React.useState<string | null>(null);
  const [isApplyingPropagation, setIsApplyingPropagation] = React.useState(false);
  const [undoPropagationOperation, setUndoPropagationOperation] =
    React.useState<SameMerchantPropagationOperation | null>(null);
  const [isUndoingPropagation, setIsUndoingPropagation] = React.useState(false);
  const [reviewedCount, setReviewedCount] = React.useState(0);
  const [savingTransactionId, setSavingTransactionId] = React.useState<string | null>(null);
  const [retryKey, setRetryKey] = React.useState(0);
  const queueHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const propagationDialogRef = React.useRef<HTMLDialogElement>(null);
  const pendingFocusTransactionId = React.useRef<string | null>(null);
  const focusQueueHeading = React.useRef(false);
  const lastHandledFocusRequest = React.useRef(0);

  React.useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError(null);

    window.budgetApi.review
      .list()
      .then((reviewTransactions) => {
        if (!active) return;
        setTransactions(reviewTransactions);
        setHasLoaded(true);
      })
      .catch((reviewError: unknown) => {
        if (!active) return;
        setLoadError(reviewError instanceof Error ? reviewError.message : "Unable to load review queue.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshKey, retryKey]);

  React.useEffect(() => {
    onUncategorizedQueueStateChange({
      count: transactions.length,
      isReady: hasLoaded && !isLoading && loadError === null,
    });
  }, [transactions.length, hasLoaded, isLoading, loadError, onUncategorizedQueueStateChange]);

  React.useEffect(() => {
    const shouldFocusFirstTransaction = focusFirstRequest > lastHandledFocusRequest.current;

    const nextTransactionId = pendingFocusTransactionId.current;
    if (nextTransactionId !== null) {
      document.getElementById(`category-for-${nextTransactionId}`)?.focus();
    } else if (focusQueueHeading.current) {
      queueHeadingRef.current?.focus();
    } else if (shouldFocusFirstTransaction) {
      if (!hasLoaded || isLoading || loadError !== null) return;
      lastHandledFocusRequest.current = focusFirstRequest;
      const firstTransaction = transactions[0];
      if (firstTransaction === undefined) queueHeadingRef.current?.focus();
      else document.getElementById(`category-for-${firstTransaction.id}`)?.focus();
    }
    pendingFocusTransactionId.current = null;
    focusQueueHeading.current = false;
  }, [transactions, focusFirstRequest, hasLoaded, isLoading, loadError]);

  React.useEffect(() => {
    const dialog = propagationDialogRef.current;
    if (dialog === null) return;
    if (propagationDialogMode === null && dialog.open) dialog.close();
    else if (propagationDialogMode !== null && !dialog.open) dialog.showModal();
  }, [propagationDialogMode]);

  async function saveCategory(transaction: Transaction): Promise<void> {
    const categoryId = selectedCategories[transaction.id]?.trim() ?? "";
    if (!categoryId) return;

    setSaveError(null);
    setSaveStatus(null);
    setSavingTransactionId(transaction.id);
    try {
      const result = await window.budgetApi.review.updateCategory({
        transactionId: transaction.id,
        categoryId,
      });
      setPropagationDialogMode(null);
      setPropagationPreview(null);
      setSelectedPropagationTransactionIds([]);
      setPropagationError(null);
      setPropagationResult(null);
      setUndoPropagationOperation(null);
      const transactionIndex = transactions.findIndex((item) => item.id === transaction.id);
      const nextTransaction = transactions[transactionIndex + 1] ?? transactions[transactionIndex - 1];
      pendingFocusTransactionId.current = nextTransaction?.id ?? null;
      focusQueueHeading.current = nextTransaction === undefined;
      setTransactions((current) => current.filter((item) => item.id !== transaction.id));
      setReviewedCount((current) => current + 1);
      const categoryLabel = CATEGORY_OPTIONS.find((category) => category.id === categoryId)?.label ?? categoryId;
      setSaveStatus(result.futureMatchingChanged
        ? `Category saved. Future matching for this merchant will use ${categoryLabel}.`
        : "Category saved. Future matching was unchanged.");
      onCategorySaved();
      try {
        const preview = await window.budgetApi.review.propagation.preview({
          sourceTransactionId: transaction.id,
        });
        setPropagationPreview(preview);
      } catch (previewError: unknown) {
        setPropagationError(
          previewError instanceof Error ? previewError.message : "Unable to preview same-merchant transactions."
        );
      }
    } catch (saveError: unknown) {
      setSaveError(saveError instanceof Error ? saveError.message : "Unable to save category.");
    } finally {
      setSavingTransactionId(null);
    }
  }

  function openPropagationPreview(): void {
    if (propagationPreview === null || propagationPreview.candidates.length === 0) return;
    setSelectedPropagationTransactionIds([]);
    setPropagationDialogMode("preview");
  }

  function cancelPropagationPreview(): void {
    setSelectedPropagationTransactionIds([]);
    setPropagationDialogMode(null);
  }

  function togglePropagationCandidate(transactionId: string): void {
    setSelectedPropagationTransactionIds((current) => current.includes(transactionId)
      ? current.filter((selectedId) => selectedId !== transactionId)
      : [...current, transactionId]
    );
  }

  async function applyPropagation(): Promise<void> {
    if (propagationPreview === null || selectedPropagationTransactionIds.length === 0) return;

    const preview = propagationPreview;
    setPropagationError(null);
    setIsApplyingPropagation(true);
    try {
      const operation = await window.budgetApi.review.propagation.apply({
        sourceTransactionId: preview.sourceTransactionId,
        merchantAlias: preview.merchantAlias,
        categoryId: preview.categoryId,
        transactionIds: selectedPropagationTransactionIds,
        confirmed: true,
      });
      const changedTransactionIds = new Set(operation.changes.map((change) => change.transactionId));
      setTransactions((current) => current.filter((transaction) => !changedTransactionIds.has(transaction.id)));
      setReviewedCount((current) => current + operation.changes.length);
      setUndoPropagationOperation(operation);
      setPropagationResult(
        `Applied ${getCategoryLabel(operation.categoryId)} to ${operation.changes.length} transaction${
          operation.changes.length === 1 ? "" : "s"
        }.`
      );
      setPropagationDialogMode(null);
      setSelectedPropagationTransactionIds([]);
      onCategorySaved();
      try {
        setPropagationPreview(await window.budgetApi.review.propagation.preview({
          sourceTransactionId: preview.sourceTransactionId,
        }));
      } catch (previewError: unknown) {
        setPropagationPreview(null);
        setPropagationError(
          previewError instanceof Error ? previewError.message : "Unable to refresh same-merchant transactions."
        );
      }
    } catch (applyError: unknown) {
      setPropagationError(applyError instanceof Error ? applyError.message : "Unable to apply category propagation.");
    } finally {
      setIsApplyingPropagation(false);
    }
  }

  async function undoPropagation(): Promise<void> {
    if (undoPropagationOperation === null) return;

    const operation = undoPropagationOperation;
    setPropagationError(null);
    setIsUndoingPropagation(true);
    try {
      const wasUndone = await window.budgetApi.review.propagation.undo(operation.id);
      if (!wasUndone) {
        setUndoPropagationOperation(null);
        throw new Error("This propagation is no longer available to undo.");
      }

      setUndoPropagationOperation(null);
      setReviewedCount((current) => Math.max(0, current - operation.changes.length));
      setPropagationResult(
        `Undo restored ${operation.changes.length} transaction${
          operation.changes.length === 1 ? "" : "s"
        }. The original correction and future merchant rule remain unchanged.`
      );
      onCategorySaved();
      try {
        setPropagationPreview(await window.budgetApi.review.propagation.preview({
          sourceTransactionId: operation.sourceTransactionId,
        }));
      } catch (previewError: unknown) {
        setPropagationPreview(null);
        setPropagationError(
          previewError instanceof Error ? previewError.message : "Unable to refresh same-merchant transactions."
        );
      }
    } catch (undoError: unknown) {
      setPropagationError(undoError instanceof Error ? undoError.message : "Unable to undo category propagation.");
    } finally {
      setIsUndoingPropagation(false);
    }
  }

  return (
    <section aria-label="Categorization Review" aria-busy={isLoading}>
      <h2 ref={queueHeadingRef} tabIndex={-1}>Categorization Review</h2>
      <p className="section-intro">These transactions are uncategorized or need a low-confidence category decision reviewed.</p>
      {isLoading && (
        <p role="status">
          {hasLoaded ? "Updating categorization queue..." : "Loading categorization queue..."}
        </p>
      )}
      {loadError !== null && (
        <div role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => setRetryKey((current) => current + 1)}>
            Retry categorization queue
          </button>
        </div>
      )}
      {saveError !== null && <p role="alert">{saveError}</p>}
      {saveStatus !== null && <p role="status" aria-label="Category correction result">{saveStatus}</p>}
      {propagationError !== null && propagationDialogMode !== "confirmation" && (
        <p role="alert">{propagationError}</p>
      )}
      {propagationResult !== null && <p role="status" aria-label="Propagation result">{propagationResult}</p>}
      {propagationPreview !== null && propagationPreview.candidates.length > 0 && (
        <div className="review-propagation-action">
          <p>
            {propagationPreview.candidates.length} uncategorized transactions match {propagationPreview.merchantAlias}.
          </p>
          <button type="button" onClick={openPropagationPreview}>
            Preview {propagationPreview.candidates.length} matching transactions
          </button>
        </div>
      )}
      {undoPropagationOperation !== null && (
        <button
          className="review-propagation-undo"
          type="button"
          disabled={isUndoingPropagation}
          onClick={() => void undoPropagation()}
        >
          {isUndoingPropagation ? "Undoing propagation..." : "Undo propagation"}
        </button>
      )}
      {hasLoaded && !isLoading && loadError === null && (
        <p role="status" aria-label="Review queue progress">
          {reviewedCount} reviewed this session; {transactions.length} remaining to review
        </p>
      )}
      {hasLoaded && !isLoading && loadError === null && transactions.length === 0 ? (
        <div className="empty-state">
          <strong>Nothing needs your attention.</strong>
          <p>Uncategorized transactions and low-confidence categorizations from CSV/PDF imports or manual entry will appear here.</p>
        </div>
      ) : transactions.length > 0 ? (
        <ul className="review-queue-list">
          {transactions.map((transaction) => (
            <li className="review-queue-item" key={transaction.id} aria-label={`Review ${transaction.merchantRaw}`}>
              <div className="review-queue-details">
                <strong>{transaction.merchantRaw}</strong>
                <span>{transaction.bookedAtIso.slice(0, 10)} · {formatAmount(transaction.amountMinor)}</span>
                {transaction.categorization !== undefined && (
                  <span>
                    Confidence: {Math.round(transaction.categorization.confidence * 100)}% ·{" "}
                    {getCategorizationReviewReason(transaction)}
                  </span>
                )}
                {transaction.categorization?.categoryId !== undefined && (
                  <span>Proposed category: {getCategoryLabel(transaction.categorization.categoryId)}</span>
                )}
                {(transaction.categorization?.matchingRules.length ?? 0) > 0 && (
                  <span>
                    Matching rules: {transaction.categorization!.matchingRules
                      .map((rule) => `${rule.ruleId} (${getCategoryLabel(rule.categoryId)})`)
                      .join(", ")}
                  </span>
                )}
              </div>
              <div className="review-queue-action">
                <label htmlFor={`category-for-${transaction.id}`}>
                  <span>Choose a category</span>
                  <select
                    id={`category-for-${transaction.id}`}
                    aria-label={`Category for ${transaction.merchantRaw}`}
                    value={selectedCategories[transaction.id] ?? ""}
                    onChange={(event) =>
                      setSelectedCategories((current) => ({
                        ...current,
                        [transaction.id]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose category</option>
                    {CATEGORY_OPTIONS.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={
                    savingTransactionId === transaction.id ||
                    (selectedCategories[transaction.id]?.trim().length ?? 0) === 0
                  }
                  onClick={() => void saveCategory(transaction)}
                >
                  {savingTransactionId === transaction.id ? "Saving category..." : "Save category"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <dialog
        ref={propagationDialogRef}
        className="review-propagation-dialog"
        role={propagationDialogMode === "confirmation" ? "alertdialog" : undefined}
        aria-label={propagationDialogMode === "confirmation"
          ? "Confirm same-merchant propagation"
          : "Same-merchant transaction preview"}
        onCancel={(event) => {
          event.preventDefault();
          if (propagationDialogMode === "confirmation") setPropagationDialogMode("preview");
          else cancelPropagationPreview();
        }}
      >
        {propagationDialogMode === "preview" && propagationPreview !== null && (
          <>
            <h3>Same-merchant transaction preview</h3>
            <p>
              Select uncategorized transactions to categorize as {getCategoryLabel(propagationPreview.categoryId)}.
            </p>
            <ul className="review-propagation-candidates">
              {propagationPreview.candidates.map((candidate) => (
                <li className="review-propagation-candidate" key={candidate.transactionId}>
                  <label htmlFor={`propagation-candidate-${candidate.transactionId}`}>
                    <input
                      id={`propagation-candidate-${candidate.transactionId}`}
                      type="checkbox"
                      aria-label={`Select transaction: ${candidate.merchantRaw}, ${candidate.bookedAtIso.slice(0, 10)}`}
                      checked={selectedPropagationTransactionIds.includes(candidate.transactionId)}
                      onChange={() => togglePropagationCandidate(candidate.transactionId)}
                    />
                    <span>Select transaction</span>
                  </label>
                  <div className="review-propagation-candidate-details">
                    <strong>{candidate.merchantRaw}</strong>
                    <span>
                      {candidate.bookedAtIso.slice(0, 10)} · {candidate.accountName} · {formatAmount(candidate.amountMinor, candidate.currencyCode)}
                    </span>
                    <span>Proposed category: {getCategoryLabel(candidate.proposedCategoryId)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="review-propagation-dialog-actions">
              <button
                type="button"
                disabled={selectedPropagationTransactionIds.length === 0}
                onClick={() => setPropagationDialogMode("confirmation")}
              >
                Continue to confirmation
              </button>
              <button type="button" onClick={cancelPropagationPreview}>Cancel</button>
            </div>
          </>
        )}
        {propagationDialogMode === "confirmation" && propagationPreview !== null && (
          <>
            <h3>Confirm same-merchant propagation</h3>
            {propagationError !== null && <p role="alert">{propagationError}</p>}
            <p>
              Apply {getCategoryLabel(propagationPreview.categoryId)} to {selectedPropagationTransactionIds.length} selected
              {selectedPropagationTransactionIds.length === 1 ? " transaction?" : " transactions?"}
            </p>
            <ul className="review-propagation-confirmation-list">
              {propagationPreview.candidates
                .filter((candidate) => selectedPropagationTransactionIds.includes(candidate.transactionId))
                .map((candidate) => (
                  <li key={candidate.transactionId}>
                    <strong>{candidate.merchantRaw}</strong>
                    <span>
                      {candidate.bookedAtIso.slice(0, 10)} · {candidate.accountName} · {formatAmount(candidate.amountMinor, candidate.currencyCode)}
                    </span>
                  </li>
                ))}
            </ul>
            <div className="review-propagation-dialog-actions">
              <button
                type="button"
                disabled={isApplyingPropagation}
                onClick={() => void applyPropagation()}
              >
                Apply category to {selectedPropagationTransactionIds.length} transaction
                {selectedPropagationTransactionIds.length === 1 ? "" : "s"}
              </button>
              <button
                type="button"
                disabled={isApplyingPropagation}
                onClick={() => setPropagationDialogMode("preview")}
              >
                Back to preview
              </button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
