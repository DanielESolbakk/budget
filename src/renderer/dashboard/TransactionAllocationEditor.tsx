import React from "react";
import type { Transaction } from "../../domain/types.js";
import { useCategoryCatalog } from "../categories/CategoryCatalogContext.js";
import { CategoryManagementButton } from "../categories/CategoryManagementButton.js";
import { formatMinorUnits } from "../../domain/money/minorUnits.js";
import { parseAllocationDraft, type AllocationDraft, type AllocationEditorError } from "./transactionAllocationDraft.js";
export type { AllocationDraft, AllocationEditorError } from "./transactionAllocationDraft.js";

const bookedDateFormatter = new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeZone: "UTC" });

interface TransactionAllocationEditorProps {
  transaction: Transaction;
  allocations: readonly AllocationDraft[];
  canReorder: boolean;
  totalMinor: bigint;
  incompleteAllocationCount: number;
  currencyFormatter: Intl.NumberFormat;
  error: AllocationEditorError | null;
  isSaving: boolean;
  firstCategoryRef: React.RefObject<HTMLSelectElement>;
  onBalanceBlur: () => void;
  onUpdate: (index: number, update: Partial<AllocationDraft>) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onSave: () => void;
  onClear: () => void;
  onCancel: () => void;
}

export function TransactionAllocationEditor({
  transaction,
  allocations,
  canReorder,
  totalMinor,
  incompleteAllocationCount,
  currencyFormatter,
  error,
  isSaving,
  firstCategoryRef,
  onBalanceBlur,
  onUpdate,
  onMove,
  onRemove,
  onAdd,
  onSave,
  onClear,
  onCancel,
}: TransactionAllocationEditorProps): React.JSX.Element {
  const { categories, loading, error: catalogError } = useCategoryCatalog();
  const editorRef = React.useRef<HTMLElement>(null);
  const addButtonRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (error?.field === undefined || isSaving) return;
    editorRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [error, isSaving]);

  const remainingMinor = BigInt(transaction.amountMinor) - totalMinor;
  const overAllocatedMinor = remainingMinor !== 0n &&
      transaction.amountMinor !== 0 &&
      (remainingMinor < 0n) !== (transaction.amountMinor < 0)
    ? (remainingMinor < 0n ? -remainingMinor : remainingMinor)
    : null;
  const draft = parseAllocationDraft(transaction.amountMinor, allocations, categories.map((category) => category.id));
  const incompleteRow = allocations.findIndex((row) => row.categoryId === "" && row.amountText.trim() === "");
  let draftStatus: string;
  if (isSaving) draftStatus = "Saving split...";
  else if (loading) draftStatus = "Loading categories...";
  else if (catalogError !== null) draftStatus = "Retry loading categories before saving.";
  else if (draft.ok) draftStatus = "Ready to save";
  else if (incompleteRow >= 0) draftStatus = `Finish category and amount for row ${incompleteRow + 1}`;
  else if (draft.error.field !== undefined || remainingMinor === 0n) draftStatus = draft.error.message;
  else {
    const balance = overAllocatedMinor ?? (remainingMinor < 0n ? -remainingMinor : remainingMinor);
    draftStatus = `${formatMinorUnits(balance, currencyFormatter)} ${
      overAllocatedMinor === null ? "remaining" : "over-allocated"}`;
  }

  return (
    <section
      ref={editorRef}
      className="transaction-allocation-editor"
      id="transaction-allocation-editor"
      aria-label={`Transaction category allocations for ${transaction.merchantRaw}`}
      aria-busy={isSaving}
      aria-describedby={error === null ? undefined : "transaction-allocation-error"}
    >
      <header className="transaction-allocation-heading">
        <div>
          <h3>Split transaction</h3>
          <p className="transaction-allocation-context">
            <strong>{transaction.merchantAlias ?? transaction.merchantRaw}</strong>
            <time dateTime={transaction.bookedAtIso}>{bookedDateFormatter.format(new Date(transaction.bookedAtIso))}</time>
          </p>
        </div>
        <strong className="transaction-allocation-source">
          {formatMinorUnits(transaction.amountMinor, currencyFormatter)}
        </strong>
      </header>
      <p className="transaction-allocation-guidance">Changes apply only when you save.</p>
      <p className="transaction-allocation-summary" role="status" aria-label="Split draft status" aria-live="off">
        {draftStatus}
      </p>
      <details className="transaction-allocation-totals">
        <summary>Split details</summary>
        <div className="transaction-allocation-metrics">
          <p>
            Source transaction:
            <strong>{formatMinorUnits(transaction.amountMinor, currencyFormatter)}</strong>
          </p>
          <p>
            {incompleteAllocationCount === 0 ? "Allocation total:" : "Allocated so far:"}
            <strong>{formatMinorUnits(totalMinor, currencyFormatter)}</strong>
          </p>
          <p>
            {overAllocatedMinor === null
              ? incompleteAllocationCount === 0
                ? "Remaining to allocate:"
                : "Balance after entered amounts:"
              : "Over-allocated by:"}
            <strong>{formatMinorUnits(overAllocatedMinor ?? remainingMinor, currencyFormatter)}</strong>
          </p>
          {incompleteAllocationCount > 0 && (
            <p className="transaction-allocation-incomplete">
              {incompleteAllocationCount} {incompleteAllocationCount === 1 ? "allocation is" : "allocations are"} incomplete.
            </p>
          )}
        </div>
        <p className="transaction-allocation-description">Original description: {transaction.merchantRaw}</p>
      </details>
      <div className="transaction-allocation-rows">
        {allocations.map((allocation, index) => {
          const errorForIndex = error?.field?.index === index ? error : null;
          const categoryHasError = errorForIndex?.field?.name === "category";
          const amountHasError = errorForIndex?.field?.name === "amount";

          return (
            <div
              className="transaction-allocation-row"
              key={`${transaction.id}-${index}`}
              role="group"
              aria-label={`Allocation ${index + 1}`}
            >
              <label>
                Category {index + 1}
                <select
                  ref={index === 0 ? firstCategoryRef : undefined}
                  aria-label={`Allocation category ${index + 1}`}
                  aria-invalid={categoryHasError || undefined}
                  aria-describedby={categoryHasError ? "transaction-allocation-error" : undefined}
                  disabled={isSaving || loading || catalogError !== null}
                  value={allocation.categoryId}
                  onChange={(event) => onUpdate(index, { categoryId: event.target.value })}
                  onBlur={onBalanceBlur}
                >
                  <option value="">Choose a category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.label}</option>
                  ))}
                </select>
                {categoryHasError && <span className="transaction-allocation-field-error"
                  id="transaction-allocation-error" role="alert">{errorForIndex.message}</span>}
              </label>
              <label>
                Amount {index + 1}
                <input
                  aria-label={`Allocation amount ${index + 1}`}
                  aria-invalid={amountHasError || undefined}
                  aria-describedby={amountHasError ? "transaction-allocation-error" : undefined}
                  disabled={isSaving}
                  inputMode="decimal"
                  value={allocation.amountText}
                  onChange={(event) => onUpdate(index, { amountText: event.target.value })}
                  onBlur={onBalanceBlur}
                />
                {amountHasError && <span className="transaction-allocation-field-error"
                  id="transaction-allocation-error" role="alert">{errorForIndex.message}</span>}
              </label>
              <details className="transaction-allocation-row-actions">
                <summary aria-label={`Row actions for allocation ${index + 1}`}>Row actions</summary>
                <div>
                  {!canReorder && <p>Finish all rows before reordering.</p>}
                  <button
                    type="button"
                    className="action-secondary"
                    aria-label={`Move allocation ${index + 1} up`}
                    disabled={isSaving || !canReorder || index === 0}
                    onClick={() => onMove(index, -1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="action-secondary"
                    aria-label={`Move allocation ${index + 1} down`}
                    disabled={isSaving || !canReorder || index === allocations.length - 1}
                    onClick={() => onMove(index, 1)}
                  >
                    Move down
                  </button>
                  {allocations.length > 2 && (
                    <button
                      type="button"
                      className="action-secondary"
                      aria-label={`Remove allocation ${index + 1}`}
                      disabled={isSaving}
                      onClick={() => {
                        onRemove(index);
                        addButtonRef.current?.focus();
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </details>
            </div>
          );
        })}
      </div>
      <div className="transaction-allocation-tools">
        <button ref={addButtonRef} className="action-secondary" type="button" disabled={isSaving} onClick={onAdd}>
          Add allocation
        </button>
        <CategoryManagementButton label="Manage categories for this split" disabled={isSaving} />
      </div>
      {error !== null && error.field === undefined && (
        <p className="transaction-allocation-field-error" id="transaction-allocation-error" role="alert">{error.message}</p>
      )}
      <div className="transaction-allocation-actions">
        {isSaving && <p className="transaction-allocation-saving">Saving allocation changes.</p>}
        <button type="button" disabled={isSaving || loading || catalogError !== null} onClick={onSave}
          aria-label={isSaving ? "Saving split..." : `Save split for ${transaction.merchantRaw}`}>
          {isSaving ? "Saving split..." : "Save split"}
        </button>
        <button className="action-secondary" type="button" disabled={isSaving} onClick={onCancel}
          aria-label="Cancel allocation editing">
          Cancel
        </button>
        {transaction.categoryAllocations?.length ? (
          <button className="action-secondary transaction-allocation-clear" type="button" disabled={isSaving} onClick={onClear}
            aria-label={`Remove saved split for ${transaction.merchantRaw}`}>
            Remove saved split
          </button>
        ) : null}
      </div>
    </section>
  );
}
