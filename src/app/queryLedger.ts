import { DEFAULT_TRANSACTION_PAGE_SIZE, type TransactionQuery } from "../domain/ledger/filterTransactions.js";
import { buildLedgerSummary, filterLedgerByNokAmount, type LedgerQueryResult } from "../shared/ledgerSummary.js";
import type { LocalLedgerDatabase } from "./backup/localLedgerContracts.js";

export function queryLedger(
  database: Pick<LocalLedgerDatabase, "getFilteredTransactions" | "getAccountsForHousehold" | "listExchangeRates">,
  householdId: string,
  query: TransactionQuery,
): LedgerQueryResult {
  // Repository amount predicates use native units; ledger amount limits are dated NOK.
  const candidateQuery = { ...query };
  delete candidateQuery.amountMinor;
  delete candidateQuery.amountFromMinor;
  delete candidateQuery.amountToMinor;
  delete candidateQuery.largeTransactionsOnly;
  const candidates = database.getFilteredTransactions(householdId, candidateQuery);
  const accounts = database.getAccountsForHousehold(householdId);
  const rates = database.listExchangeRates();
  const { transactions: allTransactions, amountFilterExclusions } = filterLedgerByNokAmount(candidates, accounts, rates, query);
  const summary = buildLedgerSummary(allTransactions, accounts, rates);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_TRANSACTION_PAGE_SIZE;
  return {
    transactions: allTransactions.slice((page - 1) * pageSize, page * pageSize),
    totalCount: allTransactions.length,
    page,
    pageSize,
    accounts,
    summary,
    amountFilterExclusions,
  };
}
