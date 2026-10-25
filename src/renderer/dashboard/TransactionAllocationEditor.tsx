import React from "react";
import type { Transaction } from "../../domain/types.js";
import { CATEGORY_OPTIONS } from "../import/categoryOptions.js";

export interface AllocationDraft {
  categoryId: string;
  amountText: string;
}

interface TransactionAllocationEditorProps {
  transaction: Transaction;
  allocations: readonly AllocationDraft[];
  totalMinor: number | null;
  currencyFormatter: Intl.NumberFormat;
  error: string | null;
  firstCategoryRef: React.RefObject<HTMLSelectElement>;
  onUpdate: (index: number, update: Partial<AllocationDraft>) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function TransactionAllocationEditor({
  transaction,
  allocations,
  totalMinor,
  currencyFormatter,
  error,
  firstCategoryRef,
  onUpdate,
  onMove,
  onRemove,
  onAdd,
  onSave,
  onCancel,
}: TransactionAllocationEditorProps): React.JSX.Element {
  return (
    <section
      className="transaction-allocation-editor"
      aria-label={`Transaction category allocations for ${transaction.merchantRaw}`}
      aria-describedby={error === null ? undefined : "transaction-allocation-error"}
    >
      <h3>Split {transaction.merchantRaw} across categories</h3>
      <div className="transaction-allocation-summary">
        <p>
          Source transaction:
          <strong>{currencyFormatter.format(transaction.amountMinor / 100)}</strong>
        </p>
        <p>
          Allocation total:
          <strong>
            {totalMinor === null
              ? "Incomplete"
              : currencyFormatter.format(totalMinor / 100)}
          </strong>
        </p>
        <p>
          Remaining to allocate:
          <strong>
            {totalMinor === null
              ? "Incomplete"
              : currencyFormatter.format((transaction.amountMinor - totalMinor) / 100)}
          </strong>
        </p>
      </div>
      <div className="transaction-allocation-rows">
        {allocations.map((allocation, index) => (
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
                value={allocation.categoryId}
                onChange={(event) => onUpdate(index, { categoryId: event.target.value })}
              >
                {CATEGORY_OPTIONS.map((category) => (
                  <option key={category.id} value={category.id}>{category.label}</option>
                ))}
              </select>
            </label>
            <label>
              Allocation amount {index + 1}
              <input
                aria-label={`Allocation amount ${index + 1}`}
                inputMode="decimal"
                value={allocation.amountText}
                onChange={(event) => onUpdate(index, { amountText: event.target.value })}
              />
            </label>
            <div className="transaction-allocation-row-actions">
              <button
                type="button"
                className="action-secondary"
                aria-label={`Move allocation ${index + 1} up`}
                disabled={index === 0}
                onClick={() => onMove(index, -1)}
              >
                Move up
              </button>
              <button
                type="button"
                className="action-secondary"
                aria-label={`Move allocation ${index + 1} down`}
                disabled={index === allocations.length - 1}
                onClick={() => onMove(index, 1)}
              >
                Move down
              </button>
              {allocations.length > 2 && (
                <button
                  type="button"
                  className="action-secondary"
                  aria-label={`Remove allocation ${index + 1}`}
                  onClick={() => onRemove(index)}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="transaction-allocation-actions">
        <button className="action-secondary" type="button" onClick={onAdd}>Add allocation</button>
        {error !== null && <p id="transaction-allocation-error" role="alert">{error}</p>}
        <button type="button" onClick={onSave}>
          Save allocations for {transaction.merchantRaw}
        </button>
        <button className="action-secondary" type="button" onClick={onCancel}>
          Cancel allocation editing
        </button>
      </div>
    </section>
  );
}
