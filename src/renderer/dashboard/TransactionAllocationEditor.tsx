import React from "react";
import type { Transaction } from "../../domain/types.js";
import { useCategoryCatalog } from "../categories/CategoryCatalogContext.js";
import { CategoryManagementButton } from "../categories/CategoryManagementButton.js";
import { formatMinorUnits } from "../../domain/money/minorUnits.js";
import { getAllocationRoomGuidance, parseAllocationDraft, type AllocationDraft, type AllocationEditorError } from "./transactionAllocationDraft.js";
export type { AllocationDraft, AllocationEditorError } from "./transactionAllocationDraft.js";

interface TransactionAllocationEditorProps {
  transaction: Transaction;
  allocations: readonly AllocationDraft[];
  canReorder: boolean;
  totalMinor: bigint;
  incompleteAllocationCount: number;
  invalidAmountIndex: number;
  currencyFormatter: Intl.NumberFormat;
  error: AllocationEditorError | null;
  isSaving: boolean;
  isRefreshing: boolean;
  saveBlocked: boolean;
  firstCategoryRef: React.RefObject<HTMLSelectElement>;
  onBalanceBlur: () => void;
  onUpdate: (index: number, update: Partial<AllocationDraft>) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onSave: () => void;
  onCancel: () => void;
  cancelLabel?: string;
}

export function TransactionAllocationEditor({
  transaction,
  allocations,
  canReorder,
  totalMinor,
  incompleteAllocationCount,
  invalidAmountIndex,
  currencyFormatter,
  error,
  isSaving,
  isRefreshing,
  saveBlocked,
  firstCategoryRef,
  onBalanceBlur,
  onUpdate,
  onMove,
  onRemove,
  onAdd,
  onSave,
  onCancel,
  cancelLabel = "Cancel allocation editing",
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
  const roomGuidance = getAllocationRoomGuidance(transaction.amountMinor, totalMinor, allocations);
  let draftStatus: string;
  if (isSaving) draftStatus = "Saving split...";
  else if (isRefreshing) draftStatus = "Refreshing transaction state...";
  else if (loading) draftStatus = "Loading categories...";
  else if (catalogError !== null) draftStatus = "Retry loading categories before saving.";
  else if (invalidAmountIndex >= 0) draftStatus = `Enter a valid amount for row ${invalidAmountIndex + 1}`;
  else if (draft.ok) draftStatus = "Ready to save";
  else if (roomGuidance !== null) draftStatus = roomGuidance;
  else if (incompleteRow >= 0) draftStatus = `Finish category and amount for row ${incompleteRow + 1}`;
  else if (draft.error.field !== undefined || remainingMinor === 0n) draftStatus = draft.error.message;
  else draftStatus = "Adjust amounts to match the transaction.";

  return (
    <section
      ref={editorRef}
      className="transaction-allocation-editor"
      id="transaction-allocation-editor"
      aria-label={`Transaction category allocations for ${transaction.merchantRaw}`}
      aria-busy={isSaving || isRefreshing}
      aria-describedby={error === null ? undefined : "transaction-allocation-error"}
    >
      <h3>Split transaction</h3>
      <p className="transaction-allocation-guidance">
        Split amounts must add up to the transaction total. Changes apply only when you save.{" "}
        <span id="transaction-allocation-amount-guidance">
          {transaction.amountMinor < 0
            ? "Use negative amounts. "
            : transaction.amountMinor > 0
              ? "Use positive amounts. "
              : ""}
          Use a comma or period for decimals.
        </span>
      </p>
      <p className="transaction-allocation-summary" role="status" aria-label="Split draft status" aria-live="off">
        <span>{draftStatus}</span>
        <span>
          {invalidAmountIndex >= 0
            ? "Remaining: unavailable"
            : `${overAllocatedMinor === null ? "Remaining:" : "Over-allocated:"} ${formatMinorUnits(overAllocatedMinor ?? remainingMinor, currencyFormatter)}`}
        </span>
      </p>
      <details className="transaction-allocation-totals">
        <summary>Split details</summary>
        <div className="transaction-allocation-metrics">
          <p>
            Source transaction:
            <strong>{formatMinorUnits(transaction.amountMinor, currencyFormatter)}</strong>
          </p>
          <p>
            {invalidAmountIndex >= 0 ? "Valid amounts so far:" : incompleteAllocationCount === 0 ? "Allocation total:" : "Allocated so far:"}
            <strong>{formatMinorUnits(totalMinor, currencyFormatter)}</strong>
          </p>
          <p>
            {overAllocatedMinor === null
              ? incompleteAllocationCount === 0
                ? "Remaining to allocate:"
                : "Balance after entered amounts:"
              : "Over-allocated by:"}
            <strong>{invalidAmountIndex >= 0 ? "Unavailable" : formatMinorUnits(overAllocatedMinor ?? remainingMinor, currencyFormatter)}</strong>
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
                  disabled={isSaving || isRefreshing || loading || catalogError !== null}
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
                  aria-describedby={amountHasError
                    ? "transaction-allocation-amount-guidance transaction-allocation-error"
                    : "transaction-allocation-amount-guidance"}
                  disabled={isSaving || isRefreshing}
                  inputMode="decimal"
                  value={allocation.amountText}
                  onChange={(event) => onUpdate(index, { amountText: event.target.value })}
                  onBlur={onBalanceBlur}
                />
                {amountHasError && <span className="transaction-allocation-field-error"
                  id="transaction-allocation-error" role="alert">{errorForIndex.message}</span>}
              </label>
              {(canReorder || allocations.length > 2) && <details className="transaction-allocation-row-actions">
                <summary aria-label={`Row actions for allocation ${index + 1}`}>Row actions</summary>
                <div>
                  {!canReorder && <p>Finish all rows before reordering.</p>}
                  <button
                    type="button"
                    className="action-secondary"
                    aria-label={`Move allocation ${index + 1} up`}
                    disabled={isSaving || isRefreshing || !canReorder || index === 0}
                    onClick={() => onMove(index, -1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="action-secondary"
                    aria-label={`Move allocation ${index + 1} down`}
                    disabled={isSaving || isRefreshing || !canReorder || index === allocations.length - 1}
                    onClick={() => onMove(index, 1)}
                  >
                    Move down
                  </button>
                  {allocations.length > 2 && (
                    <button
                      type="button"
                      className="action-secondary"
                      aria-label={`Remove allocation ${index + 1}`}
                      disabled={isSaving || isRefreshing}
                      onClick={() => {
                        onRemove(index);
                        addButtonRef.current?.focus();
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </details>}
            </div>
          );
        })}
      </div>
      <div className="transaction-allocation-tools">
        <button ref={addButtonRef} className="action-secondary" type="button"
          disabled={isSaving || isRefreshing} onClick={onAdd}>
          Add allocation
        </button>
        <CategoryManagementButton label="Manage categories for this split" disabled={isSaving || isRefreshing} />
      </div>
      {error !== null && error.field === undefined && (
        <p className="transaction-allocation-field-error" id="transaction-allocation-error" role="alert">{error.message}</p>
      )}
      <div className="transaction-allocation-actions">
        <p className="transaction-allocation-consequence" id="transaction-allocation-consequence">
          Splitting does not change remembered categories for this merchant.
        </p>
        {isRefreshing && <p className="transaction-allocation-saving">Refreshing the latest transaction state.</p>}
        {isSaving && <p className="transaction-allocation-saving">Saving allocation changes.</p>}
        <button type="button"
          disabled={isSaving || isRefreshing || saveBlocked || loading || catalogError !== null}
          onClick={onSave}
          aria-describedby="transaction-allocation-consequence"
          aria-label={isSaving ? "Saving split..." : `Save split for ${transaction.merchantRaw}`}>
          {isSaving ? "Saving split..." : "Save split"}
        </button>
        <button className="action-secondary" type="button" disabled={isSaving || isRefreshing} onClick={onCancel}
          aria-label={cancelLabel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
