import React from "react";
import type { TransactionQuery } from "../../domain/ledger/filterTransactions.js";
import type { Transaction } from "../../domain/types.js";

interface LedgerSectionProps {
  refreshKey: number;
}

export function LedgerSection({ refreshKey }: LedgerSectionProps): React.JSX.Element {
  const [accountId, setAccountId] = React.useState("");
  const [merchant, setMerchant] = React.useState("");
  const [bookedFrom, setBookedFrom] = React.useState("");
  const [bookedTo, setBookedTo] = React.useState("");
  const [amountMinor, setAmountMinor] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [query, setQuery] = React.useState<TransactionQuery>({});
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setError(null);

    window.budgetApi.ledger
      .list(query)
      .then((result) => {
        if (active) setTransactions(result);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load ledger.");
      });

    return () => {
      active = false;
    };
  }, [query, refreshKey]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsedAmount = amountMinor.trim() === "" ? undefined : Number(amountMinor);
    setQuery({
      ...(accountId.trim() ? { accountId: accountId.trim() } : {}),
      ...(merchant.trim() ? { merchant: merchant.trim() } : {}),
      ...(bookedFrom ? { bookedFromIso: `${bookedFrom}T00:00:00Z` } : {}),
      ...(bookedTo ? { bookedToIso: `${bookedTo}T23:59:59Z` } : {}),
      ...(parsedAmount === undefined || !Number.isSafeInteger(parsedAmount)
        ? {}
        : { amountMinor: parsedAmount }),
      ...(categoryId.trim() ? { categoryId: categoryId.trim() } : {}),
    });
  }

  function clearFilters(): void {
    setAccountId("");
    setMerchant("");
    setBookedFrom("");
    setBookedTo("");
    setAmountMinor("");
    setCategoryId("");
    setQuery({});
  }

  return (
    <section aria-label="Ledger">
      <h2>Ledger</h2>
      <form aria-label="Ledger filters" onSubmit={applyFilters}>
        <label>
          Account
          <input aria-label="Filter account" value={accountId} onChange={(event) => setAccountId(event.target.value)} />
        </label>
        <label>
          Merchant
          <input aria-label="Filter merchant" value={merchant} onChange={(event) => setMerchant(event.target.value)} />
        </label>
        <label>
          From date
          <input aria-label="Filter from date" type="date" value={bookedFrom} onChange={(event) => setBookedFrom(event.target.value)} />
        </label>
        <label>
          To date
          <input aria-label="Filter to date" type="date" value={bookedTo} onChange={(event) => setBookedTo(event.target.value)} />
        </label>
        <label>
          Amount in minor units
          <input aria-label="Filter amount" type="number" value={amountMinor} onChange={(event) => setAmountMinor(event.target.value)} />
        </label>
        <label>
          Category
          <input aria-label="Filter category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} />
        </label>
        <button type="submit">Apply ledger filters</button>
        <button type="button" onClick={clearFilters}>Clear ledger filters</button>
      </form>
      {error !== null && <p role="alert">{error}</p>}
      <p role="status">{transactions.length} ledger transactions</p>
      <ul>
        {transactions.map((transaction) => (
          <li key={transaction.id} aria-label={`Ledger transaction ${transaction.merchantRaw}`}>
            {transaction.bookedAtIso.slice(0, 10)} {transaction.merchantRaw} {transaction.amountMinor} minor units {transaction.categoryId ?? "Uncategorized"} {transaction.accountId}
          </li>
        ))}
      </ul>
    </section>
  );
}
