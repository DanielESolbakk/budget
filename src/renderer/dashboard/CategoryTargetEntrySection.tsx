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
  const [loadedMonth, setLoadedMonth] = React.useState<string | null>(null);
  const [isLoadingTargets, setIsLoadingTargets] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = React.useState(0);
  const [retryCounter, setRetryCounter] = React.useState(0);
  const [categoryId, setCategoryId] = React.useState("");
  const [targetNok, setTargetNok] = React.useState("");
  const [formState, setFormState] = React.useState<FormState>({ status: "idle" });
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [editingCategoryId, setEditingCategoryId] = React.useState<string | null>(null);
  const categoryInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let isActive = true;
    setIsLoadingTargets(true);
    setLoadError(null);
    window.budgetApi.categoryTargets
      .listByMonth(selectedYearMonth)
      .then((loaded) => {
        if (!isActive) return;
        setTargets(loaded);
        setLoadedMonth(selectedYearMonth);
      })
      .catch(() => {
        if (isActive) setLoadError("Unable to load saved targets.");
      })
      .finally(() => {
        if (isActive) setIsLoadingTargets(false);
      });
    return () => {
      isActive = false;
    };
  }, [selectedYearMonth, refreshCounter, retryCounter]);

  React.useEffect(() => {
    setIsFormOpen(false);
    setEditingCategoryId(null);
    setCategoryId("");
    setTargetNok("");
    setFormState({ status: "idle" });
  }, [selectedYearMonth]);

  React.useEffect(() => {
    if (isFormOpen) categoryInputRef.current?.focus();
  }, [isFormOpen, editingCategoryId]);

  function openAddTarget(): void {
    setEditingCategoryId(null);
    setCategoryId("");
    setTargetNok("");
    setFormState({ status: "idle" });
    setIsFormOpen(true);
  }

  function openEditTarget(target: MonthlyCategoryTarget): void {
    setEditingCategoryId(target.categoryId);
    setCategoryId(target.categoryId);
    setTargetNok((target.targetMinor / MINOR_UNITS_PER_NOK).toFixed(2));
    setFormState({ status: "idle" });
    setIsFormOpen(true);
  }

  function closeForm(): void {
    setIsFormOpen(false);
    setEditingCategoryId(null);
    setCategoryId("");
    setTargetNok("");
    setFormState({ status: "idle" });
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
        setRefreshCounter((c) => c + 1);
        setCategoryId("");
        setTargetNok("");
        setEditingCategoryId(null);
        setIsFormOpen(false);
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Failed to save target.";
        setFormState({ status: "error", message });
      });
  }

  return (
    <section aria-label="Category Target Entry" aria-busy={isLoadingTargets || formState.status === "saving"}>
      <h2>Set Category Budget Target</h2>
      {isLoadingTargets && (
        <p role="status">
          {loadedMonth === selectedYearMonth ? "Updating saved targets..." : "Loading saved targets..."}
        </p>
      )}
      {loadError !== null && (
        <div role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => setRetryCounter((current) => current + 1)}>
            Retry targets
          </button>
        </div>
      )}
      {loadedMonth === selectedYearMonth && (
        targets.length === 0 ? (
          <p>No targets set for {selectedYearMonth}.</p>
        ) : (
          <ul aria-label="Saved category targets">
            {targets.map((t) => (
              <li key={t.categoryId}>
                <span>{t.categoryId}: {formatMinor(t.targetMinor)}</span>
                <button
                  type="button"
                  className="target-edit-button"
                  aria-label={`Edit target ${t.categoryId}`}
                  disabled={formState.status === "saving"}
                  onClick={() => openEditTarget(t)}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      <button type="button" onClick={openAddTarget} disabled={formState.status === "saving"}>
        Add target
      </button>
      {isFormOpen && (
        <form aria-label="Category target entry form" onSubmit={handleSubmit}>
          <h3>{editingCategoryId === null ? "Add target" : `Edit target: ${editingCategoryId}`}</h3>
          <label htmlFor="target-category-id">Category</label>
          <input
            id="target-category-id"
            type="text"
            aria-label="Category ID"
            ref={categoryInputRef}
            value={categoryId}
            readOnly={editingCategoryId !== null}
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
          <div className="target-form-actions">
            <button type="submit" aria-label="Save target" disabled={formState.status === "saving"}>
              Save target
            </button>
            <button type="button" className="target-cancel-button" onClick={closeForm} disabled={formState.status === "saving"}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {formState.status === "error" && (
        <p role="alert">
          {formState.message}
        </p>
      )}
      {formState.status === "saved" && (
        <p role="status">
          Target saved.
        </p>
      )}
    </section>
  );
}
