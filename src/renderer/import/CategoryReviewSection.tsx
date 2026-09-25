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
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setError(null);

    window.budgetApi.review
      .list()
      .then((reviewTransactions) => {
        if (active) setTransactions(reviewTransactions);
      })
      .catch((reviewError: unknown) => {
        if (!active) return;
        setError(reviewError instanceof Error ? reviewError.message : "Unable to load review queue.");
      });

    return () => {
      active = false;
    };
  }, [refreshKey]);

  async function saveCategory(transaction: Transaction): Promise<void> {
    const categoryId = selectedCategories[transaction.id]?.trim() ?? "";
    if (!categoryId) return;

    try {
      await window.budgetApi.review.updateCategory({
        transactionId: transaction.id,
        categoryId,
      });
      setTransactions((current) => current.filter((item) => item.id !== transaction.id));
      onCategorySaved();
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save category.");
    }
  }

  return (
    <section aria-label="Categorization Review">
      <h2>Categorization Review</h2>
      <p className="section-intro">These transactions are in your ledger, but they do not have a category yet.</p>
      {error !== null && <p role="alert">{error}</p>}
      {transactions.length === 0 ? (
        <div className="empty-state">
          <strong>Nothing needs your attention.</strong>
          <p>Uncategorized transactions from CSV/PDF imports or manual entry will appear here.</p>
        </div>
      ) : (
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
      )}
    </section>
  );
}
