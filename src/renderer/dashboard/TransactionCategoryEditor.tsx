import React from "react";
import type {
  TransactionCategoryEditContext,
  TransactionCategoryEditFailureCode,
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
  initialDraft?: TransactionCategoryEditDraft;
  recoveryNotice?: string;
  navigationPrompt: {
    message: string;
    saveLabel: string;
    discardLabel: string;
  } | null;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (input: TransactionCategoryEditInput) => Promise<TransactionCategoryEditResult>;
  onSaved: (result: Extract<TransactionCategoryEditResult, { ok: true }>) => void;
  onCancel: () => void;
  onRefreshLedger: (
    action: "retainDraft" | "discardDraft",
    draft?: TransactionCategoryEditDraft
  ) => Promise<void>;
  onKeepEditing: () => void;
  onDiscardAndSwitch: () => void;
}

export interface TransactionCategoryEditDraft {
  mode: "single" | "split";
  categoryId: string;
  rememberForMerchant: boolean;
  allocations: AllocationDraft[];
}

function formatSaveFailureMessage(
  failureCode: TransactionCategoryEditFailureCode | undefined,
  mode: "single" | "split"
): string {
  if (failureCode === "TRANSACTION_NOT_FOUND") {
    return "This transaction is no longer available. Refresh the ledger to remove it; the draft will be discarded.";
  }

  if (failureCode === "STALE_EDIT") {
    return "Your change could not be saved because the transaction, remembered category, or ledger changed while you were editing. Refresh the latest state to keep this draft. Review it and save again to apply your change.";
  }

  if (failureCode !== undefined) {
    const draftDescription = mode === "split" ? "split draft" : "draft";
    return `Your changes could not be saved. Your ${draftDescription} is still available. Review its details and try again.`;
  }

  if (mode === "split") {
    return "Your split draft could not be saved. Your values are still here. Use Save split to retry, or cancel and reopen this transaction later.";
  }

  return "Your category change could not be saved. Your draft is still here. Try Save again, or cancel and reopen this transaction later.";
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

function getTransactionCategoryLabel(
      transaction: TransactionCategoryEditContext["transaction"],
      categories: readonly { id: string; label: string }[]
): string {
      const label = (categoryId: string): string =>
        categories.find((category) => category.id === categoryId)?.label ?? categoryId;
      return transaction.categoryAllocations?.length
        ? transaction.categoryAllocations.map((allocation) => label(allocation.categoryId)).join(", ")
        : transaction.categoryId === undefined
          ? "Uncategorized"
          : label(transaction.categoryId);
}

function sameAllocationDraft(left: readonly AllocationDraft[], right: readonly AllocationDraft[]): boolean {
  return left.length === right.length && left.every((allocation, index) =>
    allocation.categoryId === right[index]?.categoryId &&
    allocation.amountText === right[index]?.amountText
  );
}

interface TransactionCategoryEditBaseline {
  mode: "single" | "split";
  categoryId: string;
  rememberForMerchant: boolean;
  allocations: AllocationDraft[];
}

export function TransactionCategoryEditor({
  context,
  initialDraft,
  recoveryNotice,
  navigationPrompt,
  onDirtyChange,
  onSave,
  onSaved,
  onCancel,
  onRefreshLedger,
  onKeepEditing,
  onDiscardAndSwitch,
}: TransactionCategoryEditorProps): React.JSX.Element {
  const { transaction, merchantAlias, merchantCategoryRule } = context;
  const { categories, loading, error: catalogError } = useCategoryCatalog();
  const hasMerchantAlias = merchantAlias.length > 0;
  const currencyCode = transaction.currencyCode ?? "NOK";
  const currencyFormatter = getCurrencyFormatter(currencyCode);
  const categoryLabel = (id: string): string => categories.find((category) => category.id === id)?.label ?? id;
  const contextMode = transaction.categoryAllocations?.length ? "split" : "single";
  const contextCategoryId = transaction.categoryId ?? transaction.categoryAllocations?.[0]?.categoryId ?? "";
  const contextAllocations = React.useMemo(() => createAllocationDraft(context), [context]);
  const contextRemember = hasMerchantAlias;
  const initialMode = initialDraft?.mode ?? contextMode;
  const initialCategoryId = initialDraft?.categoryId ?? contextCategoryId;
  const initialAllocations = React.useMemo(
    () => initialDraft === undefined
      ? contextAllocations
      : initialDraft.allocations.map((allocation) => ({ ...allocation })),
    [contextAllocations, initialDraft]
  );
  const initialRemember = initialDraft?.rememberForMerchant ?? contextRemember;
  const [mode, setMode] = React.useState<"single" | "split">(initialMode);
  const [categoryId, setCategoryId] = React.useState(initialCategoryId);
  const [rememberForMerchant, setRememberForMerchant] = React.useState(initialRemember);
  const [allocations, setAllocations] = React.useState<AllocationDraft[]>(initialAllocations);
  const [baseline, setBaseline] = React.useState<TransactionCategoryEditBaseline>({
    mode: contextMode,
    categoryId: contextCategoryId,
    rememberForMerchant: contextRemember,
    allocations: contextAllocations,
  });
  const [allocationError, setAllocationError] = React.useState<AllocationEditorError | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [errorDetails, setErrorDetails] = React.useState<string | null>(null);
  const [saveFailureCode, setSaveFailureCode] = React.useState<TransactionCategoryEditFailureCode | null>(null);
  const [allocationStatusMessage, setAllocationStatusMessage] = React.useState("");
  const [recoveryStatusMessage, setRecoveryStatusMessage] = React.useState(
    recoveryNotice ?? (initialDraft === undefined
      ? ""
      : `Your draft is restored. Current saved category: ${getTransactionCategoryLabel(transaction, categories)}. Review it and save again if you want to apply it.`)
  );
  const [recoveryDraftPending, setRecoveryDraftPending] = React.useState(initialDraft !== undefined);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const hasOpenedSplitRef = React.useRef(initialMode === "split");
  const previousContextRef = React.useRef(context);
  const categoryRef = React.useRef<HTMLSelectElement>(null);
  const splitCategoryRef = React.useRef<HTMLSelectElement>(null);
  const refreshLedgerRef = React.useRef<HTMLButtonElement>(null);
  const lastEditingControlRef = React.useRef<HTMLElement | null>(null);
  const hadNavigationPromptRef = React.useRef(false);
  const learningDetailsId = React.useId();
  const isDirty = recoveryDraftPending ||
    mode !== baseline.mode ||
    categoryId !== baseline.categoryId ||
    rememberForMerchant !== baseline.rememberForMerchant ||
    !sameAllocationDraft(allocations, baseline.allocations);
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
  React.useLayoutEffect(() => {
    if (previousContextRef.current === context) return;
    previousContextRef.current = context;
    setBaseline({
      mode: contextMode,
      categoryId: contextCategoryId,
      rememberForMerchant: contextRemember,
      allocations: contextAllocations,
    });
    setSaveFailureCode(null);
    setError(null);
    setErrorDetails(null);
    setRecoveryDraftPending(true);
    setRecoveryStatusMessage(
      `The latest transaction state is loaded. Current saved category: ${getTransactionCategoryLabel(transaction, categories)}. Your draft is still here. Review it and save again if you want to apply it.`
    );
    const frame = window.requestAnimationFrame(() => {
      if (mode === "single") categoryRef.current?.focus();
      else splitCategoryRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [context, transaction, categories, contextMode, contextCategoryId, contextRemember, contextAllocations, mode]);
  React.useLayoutEffect(() => {
    if (
      error === null ||
      (saveFailureCode !== "STALE_EDIT" && saveFailureCode !== "TRANSACTION_NOT_FOUND") ||
      isSaving ||
      isRefreshing
    ) return;
    const frame = window.requestAnimationFrame(() => refreshLedgerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [error, saveFailureCode, isSaving, isRefreshing]);

  function clearSaveError(): void {
    if (saveFailureCode === "STALE_EDIT" || saveFailureCode === "TRANSACTION_NOT_FOUND") return;
    setSaveFailureCode(null);
    setError(null);
    setErrorDetails(null);
  }

  async function save(): Promise<void> {
    setError(null);
    setErrorDetails(null);
    setRecoveryStatusMessage("");
    setSaveFailureCode(null);
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
        setSaveFailureCode(result.code);
        setError(formatSaveFailureMessage(result.code, mode));
        setErrorDetails(result.message);
        return;
      }
      onSaved(result);
    } catch (saveError: unknown) {
      const details = saveError instanceof Error
        ? saveError.message
        : "Unable to save this category change.";
      setSaveFailureCode(null);
      setError(formatSaveFailureMessage(undefined, mode));
      setErrorDetails(details);
    } finally {
      setIsSaving(false);
    }
  }

  async function refreshLedger(action: "retainDraft" | "discardDraft"): Promise<void> {
    setIsRefreshing(true);
    setError(null);
    setErrorDetails(null);
    setRecoveryStatusMessage("");
    try {
      const draft = action === "retainDraft"
        ? {
            mode,
            categoryId,
            rememberForMerchant,
            allocations: allocations.map((allocation) => ({ ...allocation })),
          }
        : undefined;
      await onRefreshLedger(action, draft);
    } catch (refreshError: unknown) {
      const details = refreshError instanceof Error
        ? refreshError.message
        : "Unable to refresh this transaction.";
      const transactionNotFound = details.startsWith("Transaction not found:");
      if (transactionNotFound) {
        setSaveFailureCode("TRANSACTION_NOT_FOUND");
        setError(formatSaveFailureMessage("TRANSACTION_NOT_FOUND", mode));
      } else {
        setSaveFailureCode("STALE_EDIT");
        setError("The latest transaction state could not be loaded. Your draft is still here. Try refreshing again.");
      }
      setErrorDetails(details);
    } finally {
      setIsRefreshing(false);
    }
  }

  function updateAllocation(index: number, update: Partial<AllocationDraft>): void {
    setAllocationError(null);
    setAllocationStatusMessage("");
    clearSaveError();
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
    if (event.key === "Escape" && !isSaving && !isRefreshing) {
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
      aria-busy={isSaving || isRefreshing}
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
          <button type="button" className="action-secondary" disabled={isSaving || isRefreshing}
            onClick={() => { clearSaveError(); setMode("single"); }}>
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
              disabled={isSaving || isRefreshing || loading || catalogError !== null}
              onChange={(event) => { setCategoryId(event.target.value); clearSaveError(); }}>
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
                <input type="checkbox" checked={rememberForMerchant} disabled={isSaving || isRefreshing} aria-describedby={learningDetailsId}
                  onChange={(event) => { setRememberForMerchant(event.target.checked); clearSaveError(); }} />
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
              disabled={isSaving || isRefreshing}
            />
            <button type="button" className="action-secondary" disabled={isSaving || isRefreshing}
              onClick={() => {
                if (!hasOpenedSplitRef.current) {
                  const seededAllocations = allocations.map((allocation, index) =>
                    index === 0 ? { ...allocation, categoryId } : allocation
                  );
                  setBaseline((current) => ({ ...current, allocations: seededAllocations }));
                  setAllocations(seededAllocations);
                  hasOpenedSplitRef.current = true;
                }
                clearSaveError();
                setMode("split");
              }}>
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
            isRefreshing={isRefreshing}
            saveBlocked={saveFailureCode === "STALE_EDIT" || saveFailureCode === "TRANSACTION_NOT_FOUND"}
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
      {recoveryStatusMessage !== "" && (
        <p className="transaction-category-recovery-status" role="status" aria-label="Category edit recovery status">
          {recoveryStatusMessage}
        </p>
      )}
      {isRefreshing && (
        <p className="transaction-category-recovery-status" role="status">
          Refreshing the latest transaction state...
        </p>
      )}
      {error !== null && <p className="transaction-category-error" role="alert">{error}</p>}
      {error !== null && errorDetails !== null && (
        <details className="transaction-category-error-details">
          <summary>Technical details</summary>
          <pre>{errorDetails}</pre>
        </details>
      )}
      {error !== null &&
        (saveFailureCode === "STALE_EDIT" || saveFailureCode === "TRANSACTION_NOT_FOUND") && (
          <button
            ref={refreshLedgerRef}
            type="button"
            className="action-secondary"
            disabled={isSaving || isRefreshing}
            onClick={() => void refreshLedger(
              saveFailureCode === "STALE_EDIT" ? "retainDraft" : "discardDraft"
            )}
          >
            {isRefreshing
              ? "Refreshing ledger..."
              : saveFailureCode === "STALE_EDIT"
                ? "Refresh ledger and keep draft"
                : "Refresh ledger and discard draft"}
          </button>
        )}
      {catalogError !== null && <p className="transaction-category-error" role="alert">{catalogError}</p>}
      {navigationPrompt !== null && (
        <div className="transaction-category-navigation" role="alert">
          <p>{navigationPrompt.message}</p>
          <button type="button" disabled={isSaving || isRefreshing} onClick={() => void save()}>{navigationPrompt.saveLabel}</button>
          <button type="button" className="action-secondary" disabled={isSaving || isRefreshing} onClick={onDiscardAndSwitch}>
            {navigationPrompt.discardLabel}
          </button>
          <button type="button" className="action-secondary" disabled={isSaving || isRefreshing} onClick={onKeepEditing}>
            Keep editing
          </button>
        </div>
      )}
      {mode === "single" && (
        <div className="transaction-category-actions">
          <button type="button" disabled={isSaving || isRefreshing ||
            saveFailureCode === "STALE_EDIT" || saveFailureCode === "TRANSACTION_NOT_FOUND" ||
            loading || catalogError !== null || categoryId === ""}
            aria-label={`Save category for ${transaction.merchantRaw}`}
            onClick={() => void save()}>
            {isSaving ? "Saving category..." : "Save category"}
          </button>
          <button type="button" className="action-secondary" disabled={isSaving || isRefreshing}
            aria-label={`Cancel category editing for ${transaction.merchantRaw}`} onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
