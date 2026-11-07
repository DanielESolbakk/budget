import React from "react";
import type { MonthlyCategoryTarget } from "../../domain/types.js";
import { CATEGORY_OPTIONS } from "../../domain/categorization/categoryOptions.js";
import { categoryDisplayName } from "./categoryDisplayName.js";
import { parseNokAmountMinor } from "../parseNokAmountMinor.js";
import { formatNokAmountMinor } from "../formatNokAmountMinor.js";

export interface CategoryTargetEntrySectionProps {
  selectedYearMonth: string;
  selectedMonthLabel: string;
  onTargetSaved: () => void;
  onFormOpenChange: (isOpen: boolean) => void;
}

type FormState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "validation"; field: "category" | "amount"; message: string }
  | { status: "error"; message: string };

export function CategoryTargetEntrySection({
  selectedYearMonth,
  selectedMonthLabel,
  onTargetSaved,
  onFormOpenChange,
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
  const categoryInputRef = React.useRef<HTMLSelectElement>(null);
  const amountInputRef = React.useRef<HTMLInputElement>(null);
  const formOpenerRef = React.useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = React.useRef(false);
  const saveRequestRef = React.useRef(0);
  const editingCategoryLabel = editingCategoryId === null ? null : categoryDisplayName(editingCategoryId);
  const hasEditingCategoryOption =
    editingCategoryId !== null && CATEGORY_OPTIONS.some((category) => category.id === editingCategoryId);

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
    saveRequestRef.current += 1;
    restoreFocusRef.current = false;
    setIsFormOpen(false);
    setEditingCategoryId(null);
    setCategoryId("");
    setTargetNok("");
    setFormState({ status: "idle" });
  }, [selectedYearMonth]);

  React.useEffect(() => {
    onFormOpenChange(isFormOpen);
  }, [isFormOpen, onFormOpenChange]);

  React.useEffect(() => {
    if (isFormOpen) {
      if (editingCategoryId !== null) amountInputRef.current?.focus();
      else categoryInputRef.current?.focus();
    }
  }, [isFormOpen, editingCategoryId]);

  React.useEffect(() => {
    if (!isFormOpen && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      formOpenerRef.current?.focus();
    }
  }, [isFormOpen]);

  function openAddTarget(opener: HTMLButtonElement): void {
    formOpenerRef.current = opener;
    setEditingCategoryId(null);
    setCategoryId("");
    setTargetNok("");
    setFormState({ status: "idle" });
    setIsFormOpen(true);
  }

  function openEditTarget(target: MonthlyCategoryTarget, opener: HTMLButtonElement): void {
    formOpenerRef.current = opener;
    setEditingCategoryId(target.categoryId);
    setCategoryId(target.categoryId);
    const minor = BigInt(target.targetMinor);
    setTargetNok(`${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`);
    setFormState({ status: "idle" });
    setIsFormOpen(true);
  }

  function closeForm(): void {
    restoreFocusRef.current = true;
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
      setFormState({ status: "validation", field: "category", message: "Choose a category." });
      categoryInputRef.current?.focus();
      return;
    }

    const targetMinor = parseNokAmountMinor(targetNok);
    if (targetMinor === null || targetMinor < 0) {
      setFormState({
        status: "validation",
        field: "amount",
        message: "Enter a non-negative NOK amount with up to two decimals, no more than 90071992547409.91.",
      });
      amountInputRef.current?.focus();
      return;
    }

    const requestId = ++saveRequestRef.current;
    setFormState({ status: "saving" });

    window.budgetApi.categoryTargets
      .upsert({ yearMonth: selectedYearMonth, categoryId: trimmedCategoryId, targetMinor })
      .then(() => {
        onTargetSaved();
        if (requestId !== saveRequestRef.current) return;
        restoreFocusRef.current = true;
        setFormState({ status: "saved" });
        setRefreshCounter((c) => c + 1);
        setCategoryId("");
        setTargetNok("");
        setEditingCategoryId(null);
        setIsFormOpen(false);
      })
      .catch((error: unknown) => {
        if (requestId !== saveRequestRef.current) return;
        const message =
          error instanceof Error ? error.message : "Failed to save target.";
        setFormState({ status: "error", message });
      });
  }

  return (
    <section aria-label="Category Target Entry" aria-busy={isLoadingTargets || formState.status === "saving"}>
      <h2>Set Category Budget Target</h2>
      <p className="category-target-month">Targets for {selectedMonthLabel}</p>
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
            {targets.map((t) => {
              const label = categoryDisplayName(t.categoryId);
              return (
                <li key={t.categoryId}>
                  <span>{label}: {formatNokAmountMinor(t.targetMinor)}</span>
                  <button
                    type="button"
                    className="target-edit-button"
                    aria-label={`Edit target ${label}`}
                    disabled={isFormOpen}
                    onClick={(event) => openEditTarget(t, event.currentTarget)}
                  >
                    Edit
                  </button>
                </li>
              );
            })}
          </ul>
        )
      )}
      <button id="category-target-add" type="button" onClick={(event) => openAddTarget(event.currentTarget)} disabled={isFormOpen}>
        Add target
      </button>
      {isFormOpen && (
        <form aria-label="Category target entry form" onSubmit={handleSubmit} noValidate>
          <h3>{editingCategoryLabel === null ? "Add target" : `Edit target: ${editingCategoryLabel}`}</h3>
          <p id="target-draft-help" className="field-help">
            Save or cancel this target before changing the review month or opening another target.
            Your entries stay here while you work.
          </p>
          <label htmlFor="target-category-id">Category</label>
          <select
            id="target-category-id"
            ref={categoryInputRef}
            value={categoryId}
            required
            disabled={editingCategoryId !== null || formState.status === "saving"}
            aria-invalid={formState.status === "validation" && formState.field === "category" ? true : undefined}
            aria-describedby={formState.status === "validation" && formState.field === "category" ? "target-category-error" : undefined}
            onChange={(e) => {
              setCategoryId(e.target.value);
              if (formState.status === "validation" && formState.field === "category") setFormState({ status: "idle" });
            }}
          >
            <option value="" disabled>Choose a category</option>
            {!hasEditingCategoryOption && editingCategoryId !== null && (
              <option value={editingCategoryId}>{editingCategoryLabel} (existing category)</option>
            )}
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category.id} value={category.id}>{category.label}</option>
            ))}
          </select>
          {formState.status === "validation" && formState.field === "category" && (
            <p id="target-category-error" role="alert">{formState.message}</p>
          )}
          <label htmlFor="target-amount">Target Amount (NOK)</label>
          <input
            id="target-amount"
            ref={amountInputRef}
            type="text"
            inputMode="decimal"
            aria-label="Target amount"
            value={targetNok}
            required
            disabled={formState.status === "saving"}
            aria-invalid={formState.status === "validation" && formState.field === "amount" ? true : undefined}
            aria-describedby={formState.status === "validation" && formState.field === "amount" ? "target-amount-help target-amount-error" : "target-amount-help"}
            onChange={(e) => {
              setTargetNok(e.target.value);
              if (formState.status === "validation" && formState.field === "amount") setFormState({ status: "idle" });
            }}
          />
          <p id="target-amount-help" className="field-help">
            Enter zero or a positive NOK amount with up to two decimals, using a comma or period (for example 125,50).
          </p>
          {formState.status === "validation" && formState.field === "amount" && (
            <p id="target-amount-error" role="alert">{formState.message}</p>
          )}
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
        <div role="alert">
          <p>Saving this target could not be confirmed. Your entries are kept here.</p>
          <p>Check the saved targets before trying again. Saving the same category and month updates its target.</p>
          <button
            type="button"
            disabled={isLoadingTargets}
            onClick={() => setRetryCounter((current) => current + 1)}
          >
            Refresh saved targets
          </button>
          <details>
            <summary>Error details</summary>
            <p>{formState.message}</p>
          </details>
        </div>
      )}
      {formState.status === "saved" && (
        <p role="status">
          Target saved.
        </p>
      )}
    </section>
  );
}
