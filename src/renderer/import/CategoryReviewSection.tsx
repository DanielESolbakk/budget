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
}

export function CategoryReviewSection({
  refreshKey,
  onCategorySaved,
}: CategoryReviewSectionProps): React.JSX.Element {
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [selectedCategories, setSelectedCategories] = React.useState<Record<string, string>>({});
  const [hasLoaded, setHasLoaded] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [retryKey, setRetryKey] = React.useState(0);

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

  async function saveCategory(transaction: Transaction): Promise<void> {
    const categoryId = selectedCategories[transaction.id]?.trim() ?? "";
    if (!categoryId) return;

    setSaveError(null);
    try {
      await window.budgetApi.review.updateCategory({
        transactionId: transaction.id,
        categoryId,
      });
      setTransactions((current) => current.filter((item) => item.id !== transaction.id));
      onCategorySaved();
    } catch (saveError: unknown) {
      setSaveError(saveError instanceof Error ? saveError.message : "Unable to save category.");
    }
  }

  return (
    <section aria-label="Categorization Review" aria-busy={isLoading}>
      <h2>Categorization Review</h2>
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
                <button type="button" onClick={() => void saveCategory(transaction)}>
                  Save category
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
