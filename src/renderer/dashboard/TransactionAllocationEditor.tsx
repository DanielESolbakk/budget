import React from "react";
import type { Transaction } from "../../domain/types.js";
import { CATEGORY_OPTIONS } from "../import/categoryOptions.js";
import { formatMinorUnits } from "../../domain/money/minorUnits.js";

export interface AllocationDraft {
  categoryId: string;
  amountText: string;
}

export interface AllocationEditorError {
  message: string;
  field?: {
    index: number;
    name: "category" | "amount";
  };
}

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
  const remainingMinor = BigInt(transaction.amountMinor) - totalMinor;
  const overAllocatedMinor = remainingMinor !== 0n &&
      transaction.amountMinor !== 0 &&
      (remainingMinor < 0n) !== (transaction.amountMinor < 0)
    ? (remainingMinor < 0n ? -remainingMinor : remainingMinor)
    : null;

  return (
    <section
      className="transaction-allocation-editor"
      id="transaction-allocation-editor"
      aria-label={`Transaction category allocations for ${transaction.merchantRaw}`}
      aria-busy={isSaving}
      aria-describedby={error === null ? undefined : "transaction-allocation-error"}
    >
      <h3>Split {transaction.merchantRaw} across categories</h3>
      <p className="transaction-allocation-guidance">
        {transaction.categoryAllocations?.length
          ? "Your saved split stays unchanged until you save a complete replacement."
          : "Your saved transaction stays unchanged. Adjust the first amount, then choose a second category and amount."}
      </p>
      <div className="transaction-allocation-summary">
        <p>
          Source transaction:
          <strong>{formatMinorUnits(transaction.amountMinor, currencyFormatter)}</strong>
        </p>
        <p>
          {incompleteAllocationCount === 0 ? "Allocation total:" : "Allocated so far:"}
          <strong>
            {formatMinorUnits(totalMinor, currencyFormatter)}
          </strong>
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
                Allocation category {index + 1}
                <select
                  ref={index === 0 ? firstCategoryRef : undefined}
                  aria-label={`Allocation category ${index + 1}`}
                  aria-invalid={categoryHasError || undefined}
                  aria-describedby={categoryHasError ? "transaction-allocation-error" : undefined}
                  disabled={isSaving}
                  value={allocation.categoryId}
                  onChange={(event) => onUpdate(index, { categoryId: event.target.value })}
                  onBlur={onBalanceBlur}
                >
                  <option value="">Choose a category</option>
                  {CATEGORY_OPTIONS.map((category) => (
                    <option key={category.id} value={category.id}>{category.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Allocation amount {index + 1}
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
              </label>
              <div className="transaction-allocation-row-actions">
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
                    onClick={() => onRemove(index)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="transaction-allocation-actions">
        {isSaving && <p className="transaction-allocation-saving">Saving allocation changes.</p>}
        <button className="action-secondary" type="button" disabled={isSaving} onClick={onAdd}>
          Add allocation
        </button>
        {transaction.categoryAllocations?.length ? (
          <button className="action-secondary" type="button" disabled={isSaving} onClick={onClear}>
            Remove split for {transaction.merchantRaw}
          </button>
        ) : null}
        {error !== null && <p id="transaction-allocation-error" role="alert">{error.message}</p>}
        <button type="button" disabled={isSaving} onClick={onSave}>
          {isSaving ? "Saving allocations" : `Save allocations for ${transaction.merchantRaw}`}
        </button>
        <button className="action-secondary" type="button" disabled={isSaving} onClick={onCancel}>
          Cancel allocation editing
        </button>
      </div>
    </section>
  );
}
