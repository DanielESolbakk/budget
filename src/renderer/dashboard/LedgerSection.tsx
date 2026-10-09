import React from "react";
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
import type { Account, Transaction } from "../../domain/types.js";
import { CATEGORY_OPTIONS } from "../import/categoryOptions.js";

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
  return minorUnits === undefined ? "" : (minorUnits / 100).toFixed(2);
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
  if (filters.amountMinor !== undefined) activeFilters.push({ field: "amountMinor", label: "Amount", value: nokCurrencyFormatter.format(filters.amountMinor / 100) });
  if (filters.amountFromMinor !== undefined) activeFilters.push({ field: "amountFromMinor", label: "Minimum", value: nokCurrencyFormatter.format(filters.amountFromMinor / 100) });
  if (filters.amountToMinor !== undefined) activeFilters.push({ field: "amountToMinor", label: "Maximum", value: nokCurrencyFormatter.format(filters.amountToMinor / 100) });
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
    value: `Large transactions (at least ${nokCurrencyFormatter.format(LARGE_TRANSACTION_THRESHOLD_MINOR / 100)})`,
  });
  return activeFilters;
}

interface LedgerSectionProps {
  refreshKey: number;
  uncategorizedCount: number;
  isUncategorizedQueueReady: boolean;
  onReviewUncategorized: () => void;
}

export function LedgerSection({
  refreshKey,
  uncategorizedCount,
  isUncategorizedQueueReady,
  onReviewUncategorized,
}: LedgerSectionProps): React.JSX.Element {
  const [amountFrom, setAmountFrom] = React.useState("");
  const [amountTo, setAmountTo] = React.useState("");
  const [filters, setFilterState] = React.useState<TransactionFilters>({});
  const latestFilterRevision = React.useRef(0);
  const appliedFilterRevision = React.useRef(0);
  const [query, setQuery] = React.useState<TransactionQuery>({
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
  const [hasLoaded, setHasLoaded] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isFilterPending, setIsFilterPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [retryKey, setRetryKey] = React.useState(0);
  const hasMountedFilterEffect = React.useRef(false);

  function updateFilters(action: React.SetStateAction<TransactionFilters>): void {
    latestFilterRevision.current += 1;
    setFilterState(action);
  }

  const minimumAmount = amountFrom.trim() === "" ? undefined : parseNokAmountToMinor(amountFrom);
  const maximumAmount = amountTo.trim() === "" ? undefined : parseNokAmountToMinor(amountTo);
  const amountRangeError =
    (amountFrom.trim() !== "" && minimumAmount === null) ||
    (amountTo.trim() !== "" && maximumAmount === null)
      ? "Enter valid NOK amounts with no more than two decimal places."
      : minimumAmount !== undefined && minimumAmount !== null && maximumAmount !== undefined && maximumAmount !== null && minimumAmount > maximumAmount
        ? "Minimum amount must not exceed maximum amount."
        : null;

  React.useEffect(() => {
    let active = true;
    const requestFilterRevision = appliedFilterRevision.current;
    setIsLoading(true);
    setError(null);

    window.budgetApi.ledger
      .list(query)
      .then((result) => {
        if (!active) return;
        setTransactions(result.transactions);
        setAccounts(result.accounts);
        setTotalCount(result.totalCount);
        setHasLoaded(true);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load ledger.");
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
          if (requestFilterRevision === latestFilterRevision.current) {
            setIsFilterPending(false);
          }
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
    if (amountRangeError !== null) {
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
  }, [filters, amountRangeError]);

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

  const currentPage = query.page ?? 1;
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

  return (
    <section aria-label="Ledger" aria-busy={isLoading || isFilterPending}>
      <h2>Ledger</h2>
      {isUncategorizedQueueReady && uncategorizedCount > 0 && (
        <div className="ledger-review-action">
          <button
            className="ledger-review-uncategorized"
            type="button"
            aria-describedby="ledger-review-uncategorized-scope"
            onClick={onReviewUncategorized}
          >
            Review uncategorized ({uncategorizedCount})
          </button>
          <small id="ledger-review-uncategorized-scope">
            Includes all transactions, regardless of ledger filters.
          </small>
        </div>
      )}
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
            <input aria-label="Filter merchant" value={filters.merchant ?? ""} onChange={(event) => setFilter("merchant", event.target.value || undefined)} />
          </label>
          <label>
            From date
            <input aria-label="Filter from date" type="date" value={filters.bookedFromIso?.slice(0, 10) ?? ""} onChange={(event) => setFilter("bookedFromIso", event.target.value || undefined)} />
          </label>
          <label>
            To date
            <input aria-label="Filter to date" type="date" value={filters.bookedToIso?.slice(0, 10) ?? ""} onChange={(event) => setFilter("bookedToIso", event.target.value || undefined)} />
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
              <p className="ledger-amount-format-hint">Enter kroner, for example 100,50.</p>
            </div>
          </div>
        </div>
        {amountRangeError !== null && (
          <p id="ledger-amount-range-error" role="alert" aria-label="Amount range error">{amountRangeError} Results remain unchanged until the range is valid.</p>
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
            <button type="submit" disabled={savedViewName.trim() === "" || Object.keys(filters).length === 0 || isFilterPending || isLoading || amountRangeError !== null}>Save current filters</button>
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
      {hasLoaded && !isLoading && !isFilterPending && error === null && (
        <p className="ledger-result-summary" role="status">{totalCount} ledger transactions</p>
      )}
      {hasLoaded && !isLoading && !isFilterPending && error === null && totalCount === 0 && (
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
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => {
                const accountName = accounts.find((account) => account.id === transaction.accountId)?.name ?? transaction.accountId;
                const categoryName = transaction.categoryId === undefined
                  ? "Uncategorized"
                  : CATEGORY_OPTIONS.find((category) => category.id === transaction.categoryId)?.label ?? transaction.categoryId;
                const bookedDate = new Date(`${transaction.bookedAtIso.slice(0, 10)}T00:00:00Z`);

                return (
                  <tr key={transaction.id} aria-label={`Ledger transaction ${transaction.merchantRaw}`}>
                    <td>{bookedDateFormatter.format(bookedDate)}</td>
                    <td>{transaction.merchantRaw}</td>
                    <td className="ledger-amount">{nokCurrencyFormatter.format(transaction.amountMinor / 100)}</td>
                    <td>{categoryName}</td>
                    <td>{accountName}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
