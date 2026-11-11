import React from "react";
import { haveSameTransactionFilters, type LedgerQueryResult, type LedgerSummary } from "../../shared/ledgerSummary.js";
import {
  DEFAULT_TRANSACTION_PAGE_SIZE,
  LARGE_TRANSACTION_THRESHOLD_MINOR,
  parseNokAmountToMinor,
  type SavedLedgerView,
  type TransactionFilters,
  type TransactionQuery,
  type TransactionSortField,
  type TransactionTypeFilter,
} from "../../domain/ledger/filterTransactions.js";
import type {
  Account,
  Transaction,
  TransactionCategoryAllocation,
} from "../../domain/types.js";
import { CATEGORY_OPTIONS } from "../import/categoryOptions.js";
import { formatCurrencyAmount, getCurrencyFormatter } from "../formatCurrencyAmount.js";
import { formatMinorUnits, minorUnitsToDecimal } from "../../domain/money/minorUnits.js";
import { parseSignedAmountMinor as allocationAmountToMinor } from "../amountInputs.js";
import {
  TransactionAllocationEditor,
  type AllocationEditorError,
  type AllocationDraft,
} from "./TransactionAllocationEditor.js";

const nokCurrencyFormatter = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
});

const bookedDateFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "medium",
  timeZone: "UTC",
});

type LedgerFilterField = keyof TransactionFilters;

interface ActiveFilter {
  field: LedgerFilterField;
  label: string;
  value: string;
}

function amountToInput(minorUnits: number | undefined): string {
  return minorUnits === undefined ? "" : minorUnitsToDecimal(minorUnits);
}

function categoryLabel(categoryId: string): string {
  return CATEGORY_OPTIONS.find((category) => category.id === categoryId)?.label ?? categoryId;
}

function getActiveFilters(filters: TransactionFilters, accounts: Account[]): ActiveFilter[] {
  const activeFilters: ActiveFilter[] = [];
  if (filters.accountId !== undefined) {
    activeFilters.push({
      field: "accountId",
      label: "Account",
      value: accounts.find((account) => account.id === filters.accountId)?.name ?? filters.accountId,
    });
  }
  if (filters.merchant !== undefined) activeFilters.push({ field: "merchant", label: "Merchant", value: filters.merchant });
  if (filters.bookedFromIso !== undefined) activeFilters.push({ field: "bookedFromIso", label: "From", value: filters.bookedFromIso.slice(0, 10) });
  if (filters.bookedToIso !== undefined) activeFilters.push({ field: "bookedToIso", label: "To", value: filters.bookedToIso.slice(0, 10) });
  if (filters.dateBasis === "booking-date") activeFilters.push({ field: "dateBasis", label: "Date basis", value: "Recorded booking dates" });
  if (filters.amountMinor !== undefined) activeFilters.push({ field: "amountMinor", label: "Amount", value: formatMinorUnits(filters.amountMinor, nokCurrencyFormatter) });
  if (filters.amountFromMinor !== undefined) activeFilters.push({ field: "amountFromMinor", label: "Minimum", value: formatMinorUnits(filters.amountFromMinor, nokCurrencyFormatter) });
  if (filters.amountToMinor !== undefined) activeFilters.push({ field: "amountToMinor", label: "Maximum", value: formatMinorUnits(filters.amountToMinor, nokCurrencyFormatter) });
  if (filters.categoryId !== undefined) {
    activeFilters.push({
      field: "categoryId",
      label: "Category",
      value: CATEGORY_OPTIONS.find((category) => category.id === filters.categoryId)?.label ?? filters.categoryId,
    });
  }
  if (filters.uncategorizedOnly) activeFilters.push({ field: "uncategorizedOnly", label: "Category", value: "Uncategorized" });
  if (filters.transactionType !== undefined) activeFilters.push({ field: "transactionType", label: "Type", value: filters.transactionType === "income" ? "Income" : "Expenses" });
  if (filters.datePreset === "thisMonth") activeFilters.push({ field: "datePreset", label: "Date", value: "This month" });
  if (filters.largeTransactionsOnly) activeFilters.push({
    field: "largeTransactionsOnly",
    label: "Size",
    value: `Large transactions (at least ${formatMinorUnits(LARGE_TRANSACTION_THRESHOLD_MINOR, nokCurrencyFormatter)})`,
  });
  return activeFilters;
}

interface LedgerSectionProps {
  refreshKey: number;
  filterRequest?: LedgerFilterRequest | null;
  isReportCurrent: boolean;
  isReportSelected: boolean;
}

export interface LedgerFilterRequest {
  id: number;
  filters: TransactionFilters;
  description: string;
}

export function LedgerSection({ refreshKey, filterRequest, isReportCurrent, isReportSelected }: LedgerSectionProps): React.JSX.Element {
  const [amountFrom, setAmountFrom] = React.useState("");
  const [amountTo, setAmountTo] = React.useState("");
  const [filters, setFilterState] = React.useState<TransactionFilters>(filterRequest?.filters ?? {});
  const lastFilterRequestId = React.useRef(filterRequest?.id);
  const latestFilterRevision = React.useRef(0);
  const appliedFilterRevision = React.useRef(0);
  const [query, setQuery] = React.useState<TransactionQuery>({
    ...filterRequest?.filters,
    sortBy: "bookedAtIso",
    sortDirection: "desc",
    page: 1,
    pageSize: DEFAULT_TRANSACTION_PAGE_SIZE,
  });
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = React.useState(false);
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [savedViews, setSavedViews] = React.useState<SavedLedgerView[]>([]);
  const [isSavedViewsOpen, setIsSavedViewsOpen] = React.useState(false);
  const [savedViewName, setSavedViewName] = React.useState("");
  const [savedViewMessage, setSavedViewMessage] = React.useState<string | null>(null);
  const [totalCount, setTotalCount] = React.useState(0);
  const [summary, setSummary] = React.useState<LedgerSummary | null>(null);
  const [amountFilterExclusions, setAmountFilterExclusions] = React.useState<LedgerQueryResult["amountFilterExclusions"]>({
    transactionCount: 0, currencies: [],
  });
  const [loadedQuery, setLoadedQuery] = React.useState<TransactionQuery | null>(null);
  const [loadedRefreshKey, setLoadedRefreshKey] = React.useState<number | null>(null);
  const [loadedRetryKey, setLoadedRetryKey] = React.useState<number | null>(null);
  const [hasLoaded, setHasLoaded] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isFilterPending, setIsFilterPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editingAllocationTransactionId, setEditingAllocationTransactionId] = React.useState<string | null>(null);
  const [allocationDraft, setAllocationDraft] = React.useState<AllocationDraft[]>([]);
  const [allocationError, setAllocationError] = React.useState<AllocationEditorError | null>(null);
  const [isAllocationSaving, setIsAllocationSaving] = React.useState(false);
  const [allocationStatusMessage, setAllocationStatusMessage] = React.useState("");
  const [retryKey, setRetryKey] = React.useState(0);
  const hasMountedFilterEffect = React.useRef(false);
  const firstAllocationCategoryRef = React.useRef<HTMLSelectElement>(null);
  const allocationTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const merchantInputRef = React.useRef<HTMLInputElement>(null);

  function updateFilters(action: React.SetStateAction<TransactionFilters>): void {
    latestFilterRevision.current += 1;
    setIsFilterPending(true);
    setFilterState(action);
  }

  React.useEffect(() => {
    if (filterRequest === null || filterRequest === undefined || lastFilterRequestId.current === filterRequest.id) return;
    lastFilterRequestId.current = filterRequest.id;
    setAmountFrom(amountToInput(filterRequest.filters.amountFromMinor));
    setAmountTo(amountToInput(filterRequest.filters.amountToMinor));
    updateFilters(filterRequest.filters);
  }, [filterRequest]);

  const minimumAmount = amountFrom.trim() === "" ? undefined : parseNokAmountToMinor(amountFrom);
  const maximumAmount = amountTo.trim() === "" ? undefined : parseNokAmountToMinor(amountTo);
  const amountRangeError =
    (amountFrom.trim() !== "" && minimumAmount === null) ||
    (amountTo.trim() !== "" && maximumAmount === null)
      ? "Enter valid NOK amounts with no more than two decimal places."
      : minimumAmount !== undefined && minimumAmount !== null && maximumAmount !== undefined && maximumAmount !== null && minimumAmount > maximumAmount
        ? "Minimum amount must not exceed maximum amount."
        : null;
  const dateRangeError = filters.bookedFromIso !== undefined && filters.bookedToIso !== undefined &&
    filters.bookedFromIso.slice(0, 10) > filters.bookedToIso.slice(0, 10)
      ? "From date must not be after To date."
      : null;
  const hasInvalidFilters = amountRangeError !== null || dateRangeError !== null;

  React.useEffect(() => {
    let active = true;
    const requestFilterRevision = appliedFilterRevision.current;
    setIsLoading(true);
    setError(null);

    window.budgetApi.ledger
      .list(query)
      .then((result) => {
        if (!active || requestFilterRevision !== latestFilterRevision.current) return;
        if (result.page !== (query.page ?? 1)) {
          setQuery({ ...query, page: result.page });
          return;
        }
        setTransactions(result.transactions);
        setAccounts(result.accounts);
        setTotalCount(result.totalCount);
        setSummary(result.summary);
        setAmountFilterExclusions(result.amountFilterExclusions);
        setLoadedQuery(query);
        setLoadedRefreshKey(refreshKey);
        setLoadedRetryKey(retryKey);
        setHasLoaded(true);
      })
      .catch((loadError: unknown) => {
        if (!active || requestFilterRevision !== latestFilterRevision.current) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load ledger.");
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
          if (requestFilterRevision === latestFilterRevision.current) setIsFilterPending(false);
        }
      });

    return () => {
      active = false;
    };
  }, [query, refreshKey, retryKey]);

  React.useEffect(() => {
    let active = true;
    window.budgetApi.ledger.savedViews
      .list()
      .then((views) => {
        if (active) setSavedViews(views);
      })
      .catch(() => {
        if (active) setSavedViewMessage("Saved views could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (!hasMountedFilterEffect.current) {
      hasMountedFilterEffect.current = true;
      return;
    }
    const filterRevision = latestFilterRevision.current;
    if (hasInvalidFilters) {
      setIsFilterPending(false);
      return;
    }

    setError(null);
    setIsFilterPending(true);
    const timer = window.setTimeout(() => {
      appliedFilterRevision.current = filterRevision;
      setQuery((current) => ({
        ...filters,
        sortBy: current.sortBy ?? "bookedAtIso",
        sortDirection: current.sortDirection ?? "desc",
        page: 1,
        pageSize: current.pageSize ?? DEFAULT_TRANSACTION_PAGE_SIZE,
      }));
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [filters, hasInvalidFilters]);

  function setFilter(field: LedgerFilterField, value: TransactionFilters[LedgerFilterField]): void {
    updateFilters((current) => {
      const next: Record<string, unknown> = { ...current };
      if (value === undefined) delete next[field];
      else next[field] = value;
      return next as TransactionFilters;
    });
  }

  function clearFilters(): void {
    setAmountFrom("");
    setAmountTo("");
    updateFilters({});
  }

  function removeFilter(field: LedgerFilterField): void {
    const nextFilters = { ...filters };
    delete nextFilters[field];
    updateFilters(nextFilters);
    if (field === "amountMinor" || field === "amountFromMinor") setAmountFrom("");
    if (field === "amountToMinor") setAmountTo("");
  }

  function restoreFilterControls(savedFilters: TransactionFilters): void {
    setAmountFrom(amountToInput(savedFilters.amountFromMinor));
    setAmountTo(amountToInput(savedFilters.amountToMinor));
    updateFilters(savedFilters);
  }

  function toggleBooleanQuickFilter(field: "uncategorizedOnly" | "largeTransactionsOnly"): void {
    setFilter(field, filters[field] ? undefined : true);
  }

  function toggleTypeQuickFilter(type: TransactionTypeFilter): void {
    updateFilters((current) => {
      const next = { ...current };
      if (current.transactionType === type) delete next.transactionType;
      else next.transactionType = type;
      return next;
    });
  }

  function toggleThisMonthQuickFilter(): void {
    setFilter("datePreset", filters.datePreset === "thisMonth" ? undefined : "thisMonth");
  }

  function handleAmountChange(bound: "from" | "to", value: string): void {
    if (bound === "from") setAmountFrom(value);
    else setAmountTo(value);
    const parsed = value.trim() === "" ? undefined : parseNokAmountToMinor(value);
    if (parsed === null) return;
    setFilter(bound === "from" ? "amountFromMinor" : "amountToMinor", parsed);
  }

  async function saveCurrentView(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = savedViewName.trim();
    if (!name || name.length > 40) return;
    setSavedViewMessage(null);
    try {
      const savedView = await window.budgetApi.ledger.savedViews.save({ name, filters });
      setSavedViews((current) => [
        ...current.filter((view) => view.name.toLocaleLowerCase() !== savedView.name.toLocaleLowerCase()),
        savedView,
      ].sort((left, right) => left.name.localeCompare(right.name)));
      setSavedViewName("");
      setSavedViewMessage(`Saved view ${savedView.name}.`);
    } catch (saveError: unknown) {
      setSavedViewMessage(saveError instanceof Error ? saveError.message : "Unable to save this view.");
    }
  }

  async function deleteSavedView(savedView: SavedLedgerView): Promise<void> {
    try {
      await window.budgetApi.ledger.savedViews.delete(savedView.id);
      setSavedViews((current) => current.filter((view) => view.id !== savedView.id));
      setSavedViewMessage(`Deleted view ${savedView.name}.`);
    } catch (deleteError: unknown) {
      setSavedViewMessage(deleteError instanceof Error ? deleteError.message : "Unable to delete this view.");
    }
  }

  function applySavedView(savedView: SavedLedgerView): void {
    restoreFilterControls(savedView.filters);
  }

  function sortBy(field: TransactionSortField): void {
    setQuery((current) => ({
      ...current,
      sortBy: field,
      sortDirection: current.sortBy === field
        ? current.sortDirection === "asc" ? "desc" : "asc"
        : field === "bookedAtIso" ? "desc" : "asc",
      page: 1,
    }));
  }

  function sortDirectionFor(field: TransactionSortField): "ascending" | "descending" | "none" {
    if (query.sortBy !== field) return "none";
    return query.sortDirection === "asc" ? "ascending" : "descending";
  }

  function changePage(page: number): void {
    setQuery((current) => ({ ...current, page }));
  }

  function editAllocations(transaction: Transaction, trigger: HTMLButtonElement): void {
    const allocations = transaction.categoryAllocations?.length
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
    allocationTriggerRef.current = trigger;
    setAllocationDraft(allocations);
    setAllocationError(null);
    setAllocationStatusMessage("");
    setEditingAllocationTransactionId(transaction.id);
  }

  function closeAllocationEditor(): void {
    setEditingAllocationTransactionId(null);
    window.requestAnimationFrame(() => allocationTriggerRef.current?.focus());
  }

  React.useEffect(() => {
    if (editingAllocationTransactionId !== null) {
      firstAllocationCategoryRef.current?.focus();
    }
  }, [editingAllocationTransactionId]);

  async function saveAllocations(transaction: Transaction): Promise<void> {
    setAllocationStatusMessage("");
    const allocations: TransactionCategoryAllocation[] = [];
    for (const [index, allocation] of allocationDraft.entries()) {
      if (allocation.categoryId === "") {
        setAllocationError({
          message: `Choose a category for allocation ${index + 1}.`,
          field: { index, name: "category" },
        });
        return;
      }
      const amountMinor = allocationAmountToMinor(allocation.amountText);
      if (amountMinor === null) {
        setAllocationError({
          message: `Allocation ${index + 1} must be a valid amount with at most two decimal places.`,
          field: { index, name: "amount" },
        });
        return;
      }
      allocations.push({ categoryId: allocation.categoryId, amountMinor });
    }

    setAllocationError(null);
    setIsAllocationSaving(true);
    setAllocationStatusMessage(`Saving allocations for ${transaction.merchantRaw}.`);
    try {
      const result = await window.budgetApi.ledger.updateCategoryAllocations({
        transactionId: transaction.id,
        allocations,
      });
      if (!result.ok) {
        setAllocationError({ message: result.message });
        setAllocationStatusMessage("");
        return;
      }
      setTransactions((current) =>
        current.map((item) => item.id === result.transaction.id ? result.transaction : item)
      );
      setAllocationStatusMessage(`Allocations saved for ${transaction.merchantRaw}.`);
      setRetryKey((current) => current + 1);
      closeAllocationEditor();
    } catch (saveError: unknown) {
      setAllocationError(
        {
          message: saveError instanceof Error
            ? saveError.message
            : "Unable to save transaction category allocations.",
        }
      );
      setAllocationStatusMessage("");
    } finally {
      setIsAllocationSaving(false);
    }
  }

  async function clearAllocations(transaction: Transaction): Promise<void> {
    setAllocationError(null);
    setIsAllocationSaving(true);
    setAllocationStatusMessage(`Restoring one category for ${transaction.merchantRaw}.`);
    try {
      const result = await window.budgetApi.ledger.updateCategoryAllocations({
        transactionId: transaction.id,
        allocations: [],
      });
      if (!result.ok) {
        setAllocationError({ message: result.message });
        setAllocationStatusMessage("");
        return;
      }
      setTransactions((current) =>
        current.map((item) => item.id === result.transaction.id ? result.transaction : item)
      );
      setRetryKey((current) => current + 1);
      setAllocationStatusMessage(`Split removed for ${transaction.merchantRaw}.`);
      closeAllocationEditor();
    } catch (clearError: unknown) {
      setAllocationError(
        {
          message: clearError instanceof Error
            ? clearError.message
            : "Unable to remove the transaction split.",
        }
      );
      setAllocationStatusMessage("");
    } finally {
      setIsAllocationSaving(false);
    }
  }

  function updateAllocationDraft(index: number, update: Partial<AllocationDraft>): void {
    setAllocationError(null);
    setAllocationStatusMessage("");
    setAllocationDraft((current) =>
      current.map((allocation, currentIndex) =>
        currentIndex === index ? { ...allocation, ...update } : allocation
      )
    );
  }

  function addAllocationDraft(): void {
    setAllocationError(null);
    setAllocationStatusMessage("");
    setAllocationDraft((current) => [
      ...current,
      { categoryId: "", amountText: "" },
    ]);
  }

  function moveAllocationDraft(index: number, direction: -1 | 1): void {
    setAllocationError(null);
    setAllocationStatusMessage("");
    setAllocationDraft((current) => {
      const targetIndex = index + direction;
      const currentAllocation = current[index];
      const targetAllocation = current[targetIndex];
      if (currentAllocation === undefined || targetAllocation === undefined) return current;

      const next = [...current];
      next[index] = targetAllocation;
      next[targetIndex] = currentAllocation;
      return next;
    });
  }

  function removeAllocationDraft(index: number): void {
    setAllocationError(null);
    setAllocationStatusMessage("");
    setAllocationDraft((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  const currentPage = query.page ?? 1;
  const reportFiltersChanged = filterRequest !== null && filterRequest !== undefined &&
    (hasInvalidFilters || !haveSameTransactionFilters(filters, filterRequest.filters));
  const resultsAreCurrent = loadedQuery === query && loadedRefreshKey === refreshKey &&
    loadedRetryKey === retryKey &&
    !isLoading && !isFilterPending && !hasInvalidFilters && error === null &&
    haveSameTransactionFilters(filters, query) &&
    (filterRequest === null || filterRequest === undefined || lastFilterRequestId.current === filterRequest.id);
  const pageSize = query.pageSize ?? DEFAULT_TRANSACTION_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const activeFilters = getActiveFilters(filters, accounts);
  const activeAdvancedFilterCount = [
    filters.accountId !== undefined,
    filters.categoryId !== undefined,
    filters.amountFromMinor !== undefined || filters.amountToMinor !== undefined,
  ].filter(Boolean).length;
  const activeAdvancedFilterLabels = [
    ...(filters.accountId === undefined ? [] : ["Account"]),
    ...(filters.categoryId === undefined ? [] : ["Category"]),
    ...(filters.amountFromMinor === undefined && filters.amountToMinor === undefined ? [] : ["Amount range"]),
  ];
  const hasFiltersToClear = activeFilters.length > 0 || amountFrom !== "" || amountTo !== "";
  const allocationSourceTransaction = transactions.find(
    (transaction) => transaction.id === editingAllocationTransactionId
  );
  const allocationAmounts = allocationDraft.map((allocation) =>
    allocationAmountToMinor(allocation.amountText)
  );
  const incompleteAllocationCount = allocationDraft.filter((allocation, index) =>
    allocation.categoryId === "" || allocationAmounts[index] === null
  ).length;
  const allocationTotalMinor = allocationAmounts.reduce<bigint>(
    (total, amount) => total + BigInt(amount ?? 0),
    0n
  );
  const canReorderAllocations = allocationDraft.every((allocation) =>
    allocation.categoryId !== "" && allocationAmountToMinor(allocation.amountText) !== null
  );
  const allocationCurrencyCode = allocationSourceTransaction === undefined
    ? "NOK"
    : allocationSourceTransaction.currencyCode ??
      accounts.find((account) => account.id === allocationSourceTransaction.accountId)?.currencyCode ??
      "NOK";
  const allocationCurrencyFormatter = getCurrencyFormatter(allocationCurrencyCode);

  function announceAllocationBalance(): void {
    if (allocationSourceTransaction === undefined) return;

    const remainingMinor = BigInt(allocationSourceTransaction.amountMinor) - allocationTotalMinor;
    const isOverAllocated = remainingMinor !== 0n &&
      allocationSourceTransaction.amountMinor !== 0 &&
      (remainingMinor < 0n) !== (allocationSourceTransaction.amountMinor < 0);
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
      `${totalLabel}: ${formatMinorUnits(allocationTotalMinor, allocationCurrencyFormatter)}`,
      ...(incompleteAllocationCount === 0 ? [] : [incompleteMessage]),
      `${balanceLabel}: ${formatMinorUnits(balanceAmount, allocationCurrencyFormatter)}`,
    ];

    setAllocationStatusMessage(`${message.join(". ")}.`);
  }

  return (
    <section aria-label="Ledger" aria-busy={isLoading || isFilterPending}>
      <h2>Ledger</h2>
      {filterRequest !== null && filterRequest !== undefined && (
        <div className="ledger-report-context">
          <div>
            <p role="status" aria-label="Report filter context">
              <strong>{reportFiltersChanged ? "Filters changed" : "Report dates applied"}</strong>
              {" · "}{filterRequest.description}
              {reportFiltersChanged && ". These results no longer represent the original report."}
              {!isReportSelected && `${reportFiltersChanged ? " " : ". "}Review period changed. Back to period review restores this report's dates and reporting basis.`}
            </p>
            {reportFiltersChanged && <small id="restore-report-filter-help">Restores the report's dates and clears other filters.</small>}
          </div>
          {reportFiltersChanged && (
            <button type="button" className="action-secondary" aria-describedby="restore-report-filter-help" onClick={() => {
              restoreFilterControls(filterRequest.filters);
              merchantInputRef.current?.focus();
            }}>
              Restore report dates
            </button>
          )}
        </div>
      )}
      <p
        id="transaction-allocation-status"
        className="visually-hidden"
        role="status"
        aria-label="Allocation status"
        aria-live="polite"
        aria-atomic="true"
      >
        {allocationStatusMessage}
      </p>
      <form className="ledger-filters" aria-label="Ledger filters" onSubmit={(event) => event.preventDefault()}>
        <div className="ledger-quick-filters">
          <button type="button" aria-label="Quick filter Uncategorized" aria-pressed={filters.uncategorizedOnly === true} onClick={() => toggleBooleanQuickFilter("uncategorizedOnly")}>Uncategorized</button>
          <div className="ledger-transaction-type-filters" role="group" aria-label="Transaction type">
            <button type="button" aria-label="Quick filter Income" aria-pressed={filters.transactionType === "income"} onClick={() => toggleTypeQuickFilter("income")}>Income</button>
            <button type="button" aria-label="Quick filter Expenses" aria-pressed={filters.transactionType === "expenses"} onClick={() => toggleTypeQuickFilter("expenses")}>Expenses</button>
          </div>
          <button type="button" aria-label="Quick filter This month" aria-pressed={filters.datePreset === "thisMonth"} onClick={toggleThisMonthQuickFilter}>This month</button>
          <button type="button" aria-label="Quick filter Large transactions, at least NOK 10,000" aria-pressed={filters.largeTransactionsOnly === true} onClick={() => toggleBooleanQuickFilter("largeTransactionsOnly")}>
            <span>Large transactions</span>
            <small>At least NOK 10,000</small>
          </button>
          <button
            type="button"
            className="ledger-more-filters-toggle"
            aria-controls="ledger-advanced-filters"
            aria-expanded={isAdvancedFiltersOpen}
            onClick={() => setIsAdvancedFiltersOpen((isOpen) => !isOpen)}
          >
            <span>More filters{activeAdvancedFilterCount > 0 ? ` (${activeAdvancedFilterCount} active)` : ""}</span>
            {activeAdvancedFilterLabels.length > 0 && (
              <small className="ledger-more-filter-identities">{activeAdvancedFilterLabels.join(", ")}</small>
            )}
          </button>
        </div>
        <div className="ledger-primary-filters">
          <label>
            Merchant
            <input ref={merchantInputRef} aria-label="Filter merchant" value={filters.merchant ?? ""} onChange={(event) => setFilter("merchant", event.target.value || undefined)} />
          </label>
          <label>
            From date
            <input aria-label="Filter from date" type="date" aria-invalid={dateRangeError !== null} aria-describedby={dateRangeError === null ? undefined : "ledger-date-range-error"} value={filters.bookedFromIso?.slice(0, 10) ?? ""} onChange={(event) => setFilter("bookedFromIso", event.target.value || undefined)} />
          </label>
          <label>
            To date
            <input aria-label="Filter to date" type="date" aria-invalid={dateRangeError !== null} aria-describedby={dateRangeError === null ? undefined : "ledger-date-range-error"} value={filters.bookedToIso?.slice(0, 10) ?? ""} onChange={(event) => setFilter("bookedToIso", event.target.value || undefined)} />
          </label>
        </div>
        <div id="ledger-advanced-filters" className="ledger-secondary-filters-panel" hidden={!isAdvancedFiltersOpen}>
          <div className="ledger-secondary-filters">
            <label>
              Account
              <select aria-label="Filter account" value={filters.accountId ?? ""} onChange={(event) => setFilter("accountId", event.target.value || undefined)}>
                <option value="">All accounts</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select aria-label="Filter category" value={filters.categoryId ?? ""} onChange={(event) => setFilter("categoryId", event.target.value || undefined)}>
                <option value="">All categories</option>
                {CATEGORY_OPTIONS.map((category) => (
                  <option key={category.id} value={category.id}>{category.label}</option>
                ))}
              </select>
            </label>
            <div className="ledger-amount-range">
              <label>
                Minimum amount (NOK)
                <input aria-label="Minimum amount (NOK)" type="text" inputMode="decimal" aria-invalid={amountRangeError !== null} aria-describedby={amountRangeError === null ? undefined : "ledger-amount-range-error"} value={amountFrom} onChange={(event) => handleAmountChange("from", event.target.value)} />
              </label>
              <label>
                Maximum amount (NOK)
                <input aria-label="Maximum amount (NOK)" type="text" inputMode="decimal" aria-invalid={amountRangeError !== null} aria-describedby={amountRangeError === null ? undefined : "ledger-amount-range-error"} value={amountTo} onChange={(event) => handleAmountChange("to", event.target.value)} />
              </label>
              <p className="ledger-amount-format-hint">Enter kroner, for example 100,50. Foreign amounts use dated NOK conversions.</p>
            </div>
          </div>
        </div>
        {amountRangeError !== null && (
          <p id="ledger-amount-range-error" role="alert" aria-label="Amount range error">{amountRangeError} Results remain unchanged until the range is valid.</p>
        )}
        {dateRangeError !== null && (
          <p id="ledger-date-range-error" role="alert" aria-label="Date range error">{dateRangeError} Results remain unchanged until the dates are valid.</p>
        )}
        {hasFiltersToClear && (
          <div className="ledger-filter-actions">
            <button className="ledger-clear-filters" type="button" onClick={clearFilters}>Clear all filters</button>
          </div>
        )}
      </form>
      <section className="ledger-saved-views" aria-label="Saved ledger views">
        <details
          className="ledger-saved-view-details"
          open={isSavedViewsOpen}
        >
          <summary onClick={(event) => {
            event.preventDefault();
            setIsSavedViewsOpen((isOpen) => !isOpen);
          }}>
            Saved views ({savedViews.length})
          </summary>
          <div className="ledger-saved-view-content">
          <form className="ledger-save-view-form" aria-label="Save ledger view" onSubmit={(event) => void saveCurrentView(event)}>
            <label>
              Save current filters as a view
              <input aria-label="Saved view name" maxLength={40} value={savedViewName} onChange={(event) => setSavedViewName(event.target.value)} />
            </label>
            <button type="submit" disabled={savedViewName.trim() === "" || Object.keys(filters).length === 0 || isFilterPending || isLoading || hasInvalidFilters}>Save current filters</button>
          </form>
          {savedViews.length > 0 ? (
            <ul className="ledger-saved-view-list">
              {savedViews.map((savedView) => (
                <li key={savedView.id}>
                  <span>{savedView.name}</span>
                  <button type="button" aria-label={`Apply saved view ${savedView.name}`} onClick={() => applySavedView(savedView)}>Use view</button>
                  <button type="button" aria-label={`Delete saved view ${savedView.name}`} onClick={() => void deleteSavedView(savedView)}>Delete</button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No saved views.</p>
          )}
          {savedViewMessage !== null && <p role="status">{savedViewMessage}</p>}
          </div>
        </details>
      </section>
      {activeFilters.length > 0 && (
        <div className="ledger-active-filters">
          <strong>Active filters</strong>
          <ul aria-label="Active ledger filters">
            {activeFilters.map((filter) => (
              <li key={filter.field}>
                <span>{filter.label}: {filter.value}</span>
                <button type="button" aria-label={`Remove ${filter.label} filter: ${filter.value}`} onClick={() => removeFilter(filter.field)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(isLoading || isFilterPending) && (
        <p role="status">{hasLoaded ? "Updating ledger for selected filters..." : "Loading ledger transactions..."}</p>
      )}
      {error !== null && (
        <div role="alert">
          <p>{error}</p>
          <p>The previous results remain visible. Retry to load the selected filters.</p>
          <button type="button" onClick={() => setRetryKey((current) => current + 1)}>
            Retry ledger
          </button>
        </div>
      )}
      {resultsAreCurrent && summary !== null && (
        <div role="region" aria-label="Filtered transaction totals" className="ledger-filtered-totals">
          <h3>Filtered transaction totals</h3>
          <p>{totalCount} matching transactions · All pages</p>
          {amountFilterExclusions.transactionCount > 0 && (
            <p role="status" aria-label="Amount filter exclusions" className="currency-warning">
              {amountFilterExclusions.transactionCount} {amountFilterExclusions.transactionCount === 1 ? "transaction excluded" : "transactions excluded"} from NOK amount filters because dated rates are missing: {amountFilterExclusions.currencies.join(", ")}.
              {" "}These transactions could not be checked against the amount limits. Record local rates in Household &gt; Settings &gt; Exchange rates.
            </p>
          )}
          {filterRequest !== null && filterRequest !== undefined && !reportFiltersChanged && isReportSelected && (
            isReportCurrent ? (
              <p>These transactions produce the selected report's {summary.incompleteCurrencies.length > 0 ? "partial NOK subtotals" : "totals"}.</p>
            ) : (
              <p role="status">Refresh the report to verify these totals against it.</p>
            )
          )}
          {summary.incompleteCurrencies.length > 0 && (
            <p className="currency-warning" role="status">
              <strong>Partial NOK totals.</strong> Missing dated rates: {summary.incompleteCurrencies.join(", ")}.
              {" "}These currencies are excluded from income, expenses and net. Record local rates in Household &gt; Settings &gt; Exchange rates.
            </p>
          )}
          <dl className="ledger-summary-amounts">
            <div><dt>Income</dt><dd aria-label="Filtered income">{formatCurrencyAmount(summary.incomeMinor, "NOK")}</dd></div>
            <div><dt>Expenses</dt><dd aria-label="Filtered expenses">{formatCurrencyAmount(summary.expenseMinor, "NOK")}</dd></div>
            <div><dt>Net</dt><dd aria-label="Filtered net">{formatCurrencyAmount(summary.netMinor, "NOK")}</dd></div>
          </dl>
          {totalCount === 0 && <p>No transactions recorded for these filters. Zero recorded totals do not establish that there was no spending.</p>}
          {summary.nativeSubtotals.some((entry) => entry.currencyCode !== "NOK") && (
            <details>
              <summary>Native net subtotals</summary>
              <p>Original amounts, kept separate by currency. Never added across currencies.</p>
              <ul className="financial-rows" aria-label="Filtered native currency subtotals">
                {summary.nativeSubtotals.map((entry) => (
                  <li key={entry.currencyCode}><span>{entry.currencyCode}</span><span className="financial-row-value">{formatCurrencyAmount(entry.totalMinor, entry.currencyCode)}</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {resultsAreCurrent && (
        <p className="ledger-result-summary" role="status">{totalCount} ledger transactions</p>
      )}
      {resultsAreCurrent && totalCount === 0 && (
        <div className="empty-state">
          <strong>No transactions match these filters.</strong>
        </div>
      )}
      {hasLoaded && transactions.length > 0 && (
        <div
          className="ledger-table-scroll"
          role="region"
          aria-label="Ledger transactions"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (direction === 0) return;
            event.preventDefault();
            event.currentTarget.scrollBy({
              left: direction * event.currentTarget.clientWidth * 0.6,
            });
          }}
        >
          <table className="ledger-table" aria-label="Ledger transactions">
            <thead>
              <tr>
                <th scope="col" aria-sort={sortDirectionFor("bookedAtIso")}>
                  <button type="button" aria-label="Sort by date" onClick={() => sortBy("bookedAtIso")}>
                    Date{query.sortBy === "bookedAtIso" && <span className="ledger-sort-direction" aria-hidden="true">{query.sortDirection === "asc" ? "ASC" : "DESC"}</span>}
                  </button>
                </th>
                <th scope="col" aria-sort={sortDirectionFor("merchantRaw")}>
                  <button type="button" aria-label="Sort by merchant" onClick={() => sortBy("merchantRaw")}>
                    Merchant{query.sortBy === "merchantRaw" && <span className="ledger-sort-direction" aria-hidden="true">{query.sortDirection === "asc" ? "ASC" : "DESC"}</span>}
                  </button>
                </th>
                <th scope="col" aria-sort={sortDirectionFor("amountMinor")}>
                  <button type="button" aria-label="Sort by amount" onClick={() => sortBy("amountMinor")}>
                    Amount{query.sortBy === "amountMinor" && <span className="ledger-sort-direction" aria-hidden="true">{query.sortDirection === "asc" ? "ASC" : "DESC"}</span>}
                  </button>
                </th>
                <th scope="col" aria-sort={sortDirectionFor("categoryId")}>
                  <button type="button" aria-label="Sort by category" onClick={() => sortBy("categoryId")}>
                    Category{query.sortBy === "categoryId" && <span className="ledger-sort-direction" aria-hidden="true">{query.sortDirection === "asc" ? "ASC" : "DESC"}</span>}
                  </button>
                </th>
                <th scope="col" aria-sort={sortDirectionFor("accountId")}>
                  <button type="button" aria-label="Sort by account" onClick={() => sortBy("accountId")}>
                    Account{query.sortBy === "accountId" && <span className="ledger-sort-direction" aria-hidden="true">{query.sortDirection === "asc" ? "ASC" : "DESC"}</span>}
                  </button>
                </th>
                <th scope="col" aria-label="Allocation actions">Allocations</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => {
                const account = accounts.find((account) => account.id === transaction.accountId);
                const accountName = account?.name ?? transaction.accountId;
                const currencyCode = transaction.currencyCode ?? account?.currencyCode ?? "NOK";
                const categoryName = transaction.categoryAllocations?.length
                  ? transaction.categoryAllocations.map((allocation) => categoryLabel(allocation.categoryId)).join(", ")
                  : transaction.categoryId === undefined ? "Uncategorized" : categoryLabel(transaction.categoryId);
                const bookedDate = new Date(`${transaction.bookedAtIso.slice(0, 10)}T00:00:00Z`);

                return (
                  <React.Fragment key={transaction.id}>
                    <tr aria-label={`Ledger transaction ${transaction.merchantRaw}`}>
                      <td>{bookedDateFormatter.format(bookedDate)}</td>
                      <td>
                        <div className="ledger-merchant-details">
                          <span>{transaction.merchantRaw}</span>
                          {transaction.merchantAlias !== transaction.merchantRaw && (
                            <span className="standardized-merchant">
                            Normalized from description: {transaction.merchantAlias || "No name remains after normalization."}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="ledger-amount">{formatCurrencyAmount(transaction.amountMinor, currencyCode)}</td>
                      <td>{categoryName}</td>
                      <td>{accountName}</td>
                      <td>
                        <button
                          className="action-secondary"
                          type="button"
                          aria-label={`Edit category allocations for ${transaction.merchantRaw}`}
                          aria-expanded={editingAllocationTransactionId === transaction.id}
                          aria-controls={editingAllocationTransactionId === transaction.id
                            ? "transaction-allocation-editor"
                            : undefined}
                          onClick={(event) => editAllocations(transaction, event.currentTarget)}
                        >
                          {transaction.categoryAllocations?.length ? "Edit allocations" : "Allocate categories"}
                        </button>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {allocationSourceTransaction !== undefined && (
        <div className="ledger-allocation-panel">
          <TransactionAllocationEditor
            transaction={allocationSourceTransaction}
            allocations={allocationDraft}
            canReorder={canReorderAllocations}
            totalMinor={allocationTotalMinor}
            incompleteAllocationCount={incompleteAllocationCount}
            currencyFormatter={allocationCurrencyFormatter}
            error={allocationError}
            isSaving={isAllocationSaving}
            firstCategoryRef={firstAllocationCategoryRef}
            onBalanceBlur={announceAllocationBalance}
            onUpdate={updateAllocationDraft}
            onMove={moveAllocationDraft}
            onRemove={removeAllocationDraft}
            onAdd={addAllocationDraft}
            onSave={() => void saveAllocations(allocationSourceTransaction)}
            onClear={() => void clearAllocations(allocationSourceTransaction)}
            onCancel={closeAllocationEditor}
          />
        </div>
      )}
      {hasLoaded && error === null && (
        <nav className="ledger-pagination" aria-label="Ledger pagination">
          <button type="button" onClick={() => changePage(currentPage - 1)} disabled={currentPage <= 1}>
            Previous page
          </button>
          <span>Page {currentPage} of {pageCount}</span>
          <button type="button" onClick={() => changePage(currentPage + 1)} disabled={currentPage >= pageCount}>
            Next page
          </button>
        </nav>
      )}
    </section>
  );
}
