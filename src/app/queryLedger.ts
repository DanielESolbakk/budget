import { DEFAULT_TRANSACTION_PAGE_SIZE, type TransactionQuery } from "../domain/ledger/filterTransactions.js";
import { buildLedgerSummary, type LedgerQueryResult } from "../shared/ledgerSummary.js";
import type { LocalLedgerDatabase } from "./backup/localLedgerContracts.js";

export function queryLedger(
  database: Pick<LocalLedgerDatabase, "getFilteredTransactions" | "getAccountsForHousehold" | "listExchangeRates">,
  householdId: string,
  query: TransactionQuery,
): LedgerQueryResult {
  const allTransactions = database.getFilteredTransactions(householdId, query);
  const accounts = database.getAccountsForHousehold(householdId);
  const summary = buildLedgerSummary(allTransactions, accounts, database.listExchangeRates());
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_TRANSACTION_PAGE_SIZE;
  return {
    transactions: allTransactions.slice((page - 1) * pageSize, page * pageSize),
    totalCount: allTransactions.length,
    page,
    pageSize,
    accounts,
    summary,
  };
}
