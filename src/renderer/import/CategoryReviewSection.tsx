import React from "react";
import type { Transaction } from "../../domain/types.js";
import { CATEGORY_OPTIONS } from "./categoryOptions.js";

const nokCurrencyFormatter = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatAmount(amountMinor: number): string {
  return nokCurrencyFormatter.format(amountMinor / 100);
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
  const [reviewedCount, setReviewedCount] = React.useState(0);
  const [savingTransactionId, setSavingTransactionId] = React.useState<string | null>(null);
  const [retryKey, setRetryKey] = React.useState(0);
  const queueHeadingRef = React.useRef<HTMLHeadingElement>(null);
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
    } catch (saveError: unknown) {
      setSaveError(saveError instanceof Error ? saveError.message : "Unable to save category.");
    } finally {
      setSavingTransactionId(null);
    }
  }

  return (
    <section aria-label="Categorization Review" aria-busy={isLoading}>
      <h2 ref={queueHeadingRef} tabIndex={-1}>Categorization Review</h2>
      <p className="section-intro">These transactions are in your ledger, but they do not have a category yet.</p>
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
      {hasLoaded && !isLoading && loadError === null && (
        <p role="status" aria-label="Review queue progress">
          {reviewedCount} reviewed this session; {transactions.length} remaining to review
        </p>
      )}
      {hasLoaded && !isLoading && loadError === null && transactions.length === 0 ? (
        <div className="empty-state">
          <strong>Nothing needs your attention.</strong>
          <p>Uncategorized transactions from CSV/PDF imports or manual entry will appear here.</p>
        </div>
      ) : transactions.length > 0 ? (
        <ul className="review-queue-list">
          {transactions.map((transaction) => (
            <li className="review-queue-item" key={transaction.id} aria-label={`Review ${transaction.merchantRaw}`}>
              <div className="review-queue-details">
                <strong>{transaction.merchantRaw}</strong>
                <span>{transaction.bookedAtIso.slice(0, 10)} · {formatAmount(transaction.amountMinor)}</span>
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
                  disabled={savingTransactionId === transaction.id}
                  onClick={() => void saveCategory(transaction)}
                >
                  {savingTransactionId === transaction.id ? "Saving category..." : "Save category"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
