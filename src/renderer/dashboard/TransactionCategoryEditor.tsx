import React from "react";
import type {
  TransactionCategoryEditContext,
  TransactionCategoryEditInput,
  TransactionCategoryEditResult,
} from "../../shared/transactionCategoryEdit.js";
import { formatMinorUnits, minorUnitsToDecimal } from "../../domain/money/minorUnits.js";
import { TransactionAllocationEditor, type AllocationDraft, type AllocationEditorError } from "./TransactionAllocationEditor.js";
import { getAllocationRoomGuidance, parseAllocationDraft } from "./transactionAllocationDraft.js";
import { parseSignedAmountMinor } from "../amountInputs.js";
import { CategoryManagementButton } from "../categories/CategoryManagementButton.js";
import { useCategoryCatalog } from "../categories/CategoryCatalogContext.js";
import { getCurrencyFormatter } from "../formatCurrencyAmount.js";

const bookedDateFormatter = new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeZone: "UTC" });

interface TransactionCategoryEditorProps {
  context: TransactionCategoryEditContext;
  navigationPrompt: {
    message: string;
    saveLabel: string;
    discardLabel: string;
  } | null;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (input: TransactionCategoryEditInput) => Promise<TransactionCategoryEditResult>;
  onSaved: (result: Extract<TransactionCategoryEditResult, { ok: true }>) => void;
  onCancel: () => void;
  onKeepEditing: () => void;
  onDiscardAndSwitch: () => void;
}

function createAllocationDraft(context: TransactionCategoryEditContext): AllocationDraft[] {
  const { transaction } = context;
  return transaction.categoryAllocations?.length
    ? transaction.categoryAllocations.map((allocation) => ({
        categoryId: allocation.categoryId,
        amountText: minorUnitsToDecimal(allocation.amountMinor),
      }))
    : [
        {
          categoryId: transaction.categoryId ?? "",
          amountText: minorUnitsToDecimal(transaction.amountMinor),
        },
        { categoryId: "", amountText: "" },
      ];
}

function sameAllocationDraft(left: readonly AllocationDraft[], right: readonly AllocationDraft[]): boolean {
  return left.length === right.length && left.every((allocation, index) =>
    allocation.categoryId === right[index]?.categoryId &&
    allocation.amountText === right[index]?.amountText
  );
}

export function TransactionCategoryEditor({
  context,
  navigationPrompt,
  onDirtyChange,
  onSave,
  onSaved,
  onCancel,
  onKeepEditing,
  onDiscardAndSwitch,
}: TransactionCategoryEditorProps): React.JSX.Element {
  const { transaction, merchantAlias, merchantCategoryRule } = context;
  const { categories, loading, error: catalogError } = useCategoryCatalog();
  const hasMerchantAlias = merchantAlias.length > 0;
  const initialMode = transaction.categoryAllocations?.length ? "split" : "single";
  const initialCategoryId = transaction.categoryId ?? transaction.categoryAllocations?.[0]?.categoryId ?? "";
  const initialAllocations = React.useMemo(() => createAllocationDraft(context), [context]);
  const initialRemember = hasMerchantAlias;
  const [mode, setMode] = React.useState<"single" | "split">(initialMode);
  const [categoryId, setCategoryId] = React.useState(initialCategoryId);
  const [rememberForMerchant, setRememberForMerchant] = React.useState(initialRemember);
  const [allocations, setAllocations] = React.useState<AllocationDraft[]>(initialAllocations);
  const [allocationError, setAllocationError] = React.useState<AllocationEditorError | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [allocationStatusMessage, setAllocationStatusMessage] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const categoryRef = React.useRef<HTMLSelectElement>(null);
  const splitCategoryRef = React.useRef<HTMLSelectElement>(null);
  const lastEditingControlRef = React.useRef<HTMLElement | null>(null);
  const hadNavigationPromptRef = React.useRef(false);
  const learningDetailsId = React.useId();
  const currencyCode = transaction.currencyCode ?? "NOK";
  const currencyFormatter = getCurrencyFormatter(currencyCode);
  const categoryLabel = (id: string): string => categories.find((category) => category.id === id)?.label ?? id;
  const isDirty = mode !== initialMode ||
    categoryId !== initialCategoryId ||
    rememberForMerchant !== initialRemember ||
    !sameAllocationDraft(allocations, initialAllocations);
  const allocationAmounts = allocations.map((allocation) => parseSignedAmountMinor(allocation.amountText));
  const invalidAmountIndex = allocations.findIndex((allocation, index) =>
    allocation.amountText.trim() !== "" && allocationAmounts[index] === null
  );
  const allocationTotalMinor = allocationAmounts.reduce<bigint>(
    (total, amount) => total + BigInt(amount ?? 0),
    0n
  );
  const incompleteAllocationCount = allocations.filter((allocation, index) =>
    allocation.categoryId === "" || allocationAmounts[index] === null
  ).length;
  const splitDraft = parseAllocationDraft(
    transaction.amountMinor,
    allocations,
    categories.map((category) => category.id)
  );
  const canReorderAllocations = allocations.every((allocation, index) =>
    allocation.categoryId !== "" && allocationAmounts[index] !== null
  );

  React.useLayoutEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);
  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (mode === "single") categoryRef.current?.focus();
      else splitCategoryRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);
  React.useLayoutEffect(() => {
    if (hadNavigationPromptRef.current && navigationPrompt === null) {
      if (lastEditingControlRef.current?.isConnected) lastEditingControlRef.current.focus();
      else if (mode === "split") splitCategoryRef.current?.focus();
      else categoryRef.current?.focus();
    }
    hadNavigationPromptRef.current = navigationPrompt !== null;
  }, [navigationPrompt, mode]);

  async function save(): Promise<void> {
    setError(null);
    let request: TransactionCategoryEditInput;
    if (mode === "single") {
      if (categoryId === "") {
        setError("Choose a category before saving.");
        categoryRef.current?.focus();
        return;
      }
      request = {
        transactionId: transaction.id,
        expectedState: context.expectedState,
        mode: "single",
        categoryId,
        rememberForMerchant: rememberForMerchant && hasMerchantAlias,
      };
    } else {
      const draft = parseAllocationDraft(
        transaction.amountMinor,
        allocations,
        categories.map((category) => category.id)
      );
      if (!draft.ok) {
        setAllocationError(draft.error);
        return;
      }
      request = {
        transactionId: transaction.id,
        expectedState: context.expectedState,
        mode: "split",
        allocations: draft.allocations,
        rememberForMerchant: false,
      };
    }

    setIsSaving(true);
    try {
      const result = await onSave(request);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onSaved(result);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save this category change.");
    } finally {
      setIsSaving(false);
    }
  }

  function updateAllocation(index: number, update: Partial<AllocationDraft>): void {
    setAllocationError(null);
    setAllocationStatusMessage("");
    setError(null);
    setAllocations((current) => current.map((allocation, currentIndex) =>
      currentIndex === index ? { ...allocation, ...update } : allocation
    ));
  }

  function moveAllocation(index: number, direction: -1 | 1): void {
    setAllocations((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function removeAllocation(index: number): void {
    setAllocations((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function announceAllocationBalance(): void {
    setAllocationError(null);
    if (invalidAmountIndex >= 0) {
      setAllocationStatusMessage(`Enter a valid amount for row ${invalidAmountIndex + 1} before calculating the balance.`);
      return;
    }
    const remainingMinor = BigInt(transaction.amountMinor) - allocationTotalMinor;
    const isOverAllocated = remainingMinor !== 0n &&
      transaction.amountMinor !== 0 &&
      (remainingMinor < 0n) !== (transaction.amountMinor < 0);
    const totalLabel = incompleteAllocationCount === 0
      ? "Allocation total"
      : "Current allocation total";
    const balanceLabel = isOverAllocated
      ? "Over-allocated by"
      : incompleteAllocationCount === 0
        ? "Remaining to allocate"
        : "Balance after entered amounts";
    const incompleteMessage = incompleteAllocationCount === 1
      ? "1 allocation is incomplete"
      : `${incompleteAllocationCount} allocations are incomplete`;
    const balanceAmount = isOverAllocated && remainingMinor < 0n ? -remainingMinor : remainingMinor;
    const message = [
      loading ? "Loading categories" :
        catalogError !== null ? "Retry loading categories before saving" :
          splitDraft.ok ? "Ready to save" :
            getAllocationRoomGuidance(transaction.amountMinor, allocationTotalMinor, allocations) ??
              splitDraft.error.message.replace(/\.$/, ""),
      `${totalLabel}: ${formatMinorUnits(allocationTotalMinor, currencyFormatter)}`,
      ...(incompleteAllocationCount === 0 ? [] : [incompleteMessage]),
      `${balanceLabel}: ${formatMinorUnits(balanceAmount, currencyFormatter)}`,
    ];
    setAllocationStatusMessage(`${message.join(". ")}.`);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape" && !isSaving) {
      event.preventDefault();
      onCancel();
    }
  }

  function rememberEditingControl(event: React.FocusEvent<HTMLElement>): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(".transaction-category-navigation") !== null) return;
    if (target.matches("button, input, select, textarea, [tabindex]")) {
      lastEditingControlRef.current = target;
    }
  }

  const rememberedLabel = merchantCategoryRule === null
    ? "No category is currently remembered for this merchant."
    : `Currently remembered category: ${categoryLabel(merchantCategoryRule.categoryId)}.`;

  return (
    <section
      id="transaction-category-editor"
      className="transaction-category-editor"
      aria-label={`Edit category for ${transaction.merchantRaw}`}
      aria-busy={isSaving}
      onKeyDown={handleKeyDown}
      onFocusCapture={rememberEditingControl}
    >
      <header className="transaction-category-heading">
        <div>
          <h3>{transaction.merchantRaw}</h3>
          <p>
            <time dateTime={transaction.bookedAtIso}>
              {bookedDateFormatter.format(new Date(transaction.bookedAtIso))}
            </time>
          </p>
        </div>
        <strong>{formatMinorUnits(transaction.amountMinor, currencyFormatter)}</strong>
      </header>

      {mode === "split" && (
        <div className="transaction-category-mode-actions" role="group" aria-label="Category edit mode">
          <button type="button" className="action-secondary" disabled={isSaving}
            onClick={() => { setError(null); setMode("single"); }}>
            Use one category
          </button>
        </div>
      )}

      {mode === "single" ? (
        <div className="transaction-category-single">
          {(transaction.categoryAllocations?.length ?? 0) > 0 && (
            <p className="transaction-category-replacement">
              This replaces the entire saved split with the selected category for this whole transaction.
            </p>
          )}
          <label>
            Category
            <select ref={categoryRef} value={categoryId} aria-label={`Category for ${transaction.merchantRaw}`}
              disabled={isSaving || loading || catalogError !== null}
              onChange={(event) => { setCategoryId(event.target.value); setError(null); }}>
              <option value="">Choose a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.label}</option>
              ))}
            </select>
          </label>
          {merchantAlias === "" ? (
            <div className="transaction-category-learning-details">
              <p>Matching merchant: <strong>No matching alias</strong></p>
              <p>Remembering is unavailable because this description has no matching merchant alias. This change will apply only to this transaction.</p>
            </div>
          ) : (
            <div className="transaction-category-learning">
              <label className="transaction-category-remember">
                <input type="checkbox" checked={rememberForMerchant} disabled={isSaving} aria-describedby={learningDetailsId}
                  onChange={(event) => setRememberForMerchant(event.target.checked)} />
                Remember for this merchant
              </label>
              <div id={learningDetailsId} className="transaction-category-learning-details">
                <p>Matching merchant: <strong>{merchantAlias}</strong></p>
                <p>{rememberedLabel}</p>
                <p>
                  {rememberForMerchant
                    ? `For future matching transactions, use ${categoryId === "" ? "the selected category" : categoryLabel(categoryId)}. Existing history will not change.`
                    : `This is a transaction-only correction.${merchantCategoryRule === null
                      ? ""
                      : ` The remembered ${categoryLabel(merchantCategoryRule.categoryId)} category will remain unchanged.`} Existing history will not change.`}
                </p>
              </div>
            </div>
          )}
          <div className="transaction-category-mode-actions" role="group" aria-label="More category options">
            <CategoryManagementButton
              label="Manage categories for this transaction"
              returnFocusRef={categoryRef}
              disabled={isSaving}
            />
            <button type="button" className="action-secondary" disabled={isSaving}
              onClick={() => { setError(null); setMode("split"); }}>
              Split across categories
            </button>
          </div>
        </div>
      ) : (
        <div className="transaction-category-split">
          <p
            className="visually-hidden"
            role="status"
            aria-label="Allocation status"
            aria-live="polite"
            aria-atomic="true"
          >
            {allocationStatusMessage}
          </p>
          <TransactionAllocationEditor
            transaction={transaction}
            allocations={allocations}
            canReorder={canReorderAllocations}
            totalMinor={allocationTotalMinor}
            incompleteAllocationCount={incompleteAllocationCount}
            invalidAmountIndex={invalidAmountIndex}
            currencyFormatter={currencyFormatter}
            error={allocationError}
            isSaving={isSaving}
            firstCategoryRef={splitCategoryRef}
            onBalanceBlur={announceAllocationBalance}
            onUpdate={updateAllocation}
            onMove={moveAllocation}
            onRemove={removeAllocation}
            onAdd={() => setAllocations((current) => [...current, { categoryId: "", amountText: "" }])}
            onSave={() => void save()}
            onCancel={onCancel}
            cancelLabel={`Cancel category editing for ${transaction.merchantRaw}`}
          />
        </div>
      )}

      {error !== null && <p className="transaction-category-error" role="alert">{error}</p>}
      {catalogError !== null && <p className="transaction-category-error" role="alert">{catalogError}</p>}
      {navigationPrompt !== null && (
        <div className="transaction-category-navigation" role="alert">
          <p>{navigationPrompt.message}</p>
          <button type="button" disabled={isSaving} onClick={() => void save()}>{navigationPrompt.saveLabel}</button>
          <button type="button" className="action-secondary" disabled={isSaving} onClick={onDiscardAndSwitch}>
            {navigationPrompt.discardLabel}
          </button>
          <button type="button" className="action-secondary" disabled={isSaving} onClick={onKeepEditing}>
            Keep editing
          </button>
        </div>
      )}
      {mode === "single" && (
        <div className="transaction-category-actions">
          <button type="button" disabled={isSaving || loading || catalogError !== null || categoryId === ""}
            aria-label={`Save category for ${transaction.merchantRaw}`}
            onClick={() => void save()}>
            {isSaving ? "Saving category..." : "Save category"}
          </button>
          <button type="button" className="action-secondary" disabled={isSaving}
            aria-label={`Cancel category editing for ${transaction.merchantRaw}`} onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
