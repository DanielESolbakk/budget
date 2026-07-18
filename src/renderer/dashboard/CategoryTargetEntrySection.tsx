import React from "react";
import type { MonthlyCategoryTarget } from "../../domain/types.js";

const MINOR_UNITS_PER_NOK = 100;

const nokCurrencyFormatter = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMinor(minor: number): string {
  return nokCurrencyFormatter.format(minor / MINOR_UNITS_PER_NOK);
}

export interface CategoryTargetEntrySectionProps {
  selectedYearMonth: string;
}

type FormState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

export function CategoryTargetEntrySection({
  selectedYearMonth,
}: CategoryTargetEntrySectionProps): React.JSX.Element {
  const [targets, setTargets] = React.useState<MonthlyCategoryTarget[]>([]);
  const [categoryId, setCategoryId] = React.useState("");
  const [targetNok, setTargetNok] = React.useState("");
  const [formState, setFormState] = React.useState<FormState>({ status: "idle" });

  React.useEffect(() => {
    let isActive = true;
    window.budgetApi.categoryTargets
      .listByMonth(selectedYearMonth)
      .then((loaded) => {
        if (isActive) setTargets(loaded);
      })
      .catch(() => {
        // Keep empty list on error.
      });
    return () => {
      isActive = false;
    };
  }, [selectedYearMonth]);

  function refreshTargets(): void {
    window.budgetApi.categoryTargets
      .listByMonth(selectedYearMonth)
      .then((loaded) => setTargets(loaded))
      .catch(() => {});
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();

    const trimmedCategoryId = categoryId.trim();
    if (!trimmedCategoryId) {
      setFormState({ status: "error", message: "Category ID is required." });
      return;
    }

    const parsed = parseFloat(targetNok);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setFormState({
        status: "error",
        message: "Target amount must be a non-negative number.",
      });
      return;
    }

    const targetMinor = Math.round(parsed * MINOR_UNITS_PER_NOK);

    setFormState({ status: "saving" });

    window.budgetApi.categoryTargets
      .upsert({ yearMonth: selectedYearMonth, categoryId: trimmedCategoryId, targetMinor })
      .then(() => {
        setFormState({ status: "saved" });
        refreshTargets();
        setCategoryId("");
        setTargetNok("");
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Failed to save target.";
        setFormState({ status: "error", message });
      });
  }

  return (
    <section aria-label="Category Target Entry">
      <h2>Set Category Budget Target</h2>
      {targets.length === 0 ? (
        <p>No targets set for {selectedYearMonth}.</p>
      ) : (
        <ul aria-label="Saved category targets">
          {targets.map((t) => (
            <li key={t.categoryId}>
              {t.categoryId}: {formatMinor(t.targetMinor)}
            </li>
          ))}
        </ul>
      )}
      <form aria-label="Category target entry form" onSubmit={handleSubmit}>
        <label htmlFor="target-category-id">Category</label>
        <input
          id="target-category-id"
          type="text"
          aria-label="Category ID"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        />
        <label htmlFor="target-amount">Target Amount (NOK)</label>
        <input
          id="target-amount"
          type="number"
          aria-label="Target amount"
          value={targetNok}
          min="0"
          step="0.01"
          onChange={(e) => setTargetNok(e.target.value)}
        />
        <button type="submit" aria-label="Save target">
          Save Target
        </button>
      </form>
      {formState.status === "error" && (
        <p role="alert" aria-label="Target validation error">
          {formState.message}
        </p>
      )}
      {formState.status === "saved" && (
        <p role="status" aria-label="Target saved confirmation">
          Target saved.
        </p>
      )}
    </section>
  );
}
