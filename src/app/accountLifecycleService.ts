import type { LocalLedgerDatabase } from "./backup/localLedgerContracts.js";
import type { Account } from "../domain/types.js";
import {
  normalizeAccountUpdateInput,
  type AccountHistorySummary,
  type AccountUpdateInput,
} from "../shared/accountLifecycle.js";

export interface AccountLifecycleService {
  getHistorySummary: (accountId: string) => AccountHistorySummary;
  updateAccount: (input: AccountUpdateInput) => Account;
}

export function createAccountLifecycleService(
  database: Pick<
    LocalLedgerDatabase,
    "loadRuntimeMetadata" | "getAccountHistorySummary" | "updateAccount"
  >
): AccountLifecycleService {
  function currentAccount(accountId: string): Account {
    const metadata = database.loadRuntimeMetadata();
    if (metadata === null) {
      throw new Error("Local household is not available for account management.");
    }
    const account = metadata.accounts.find((candidate) => candidate.id === accountId);
    if (account === undefined) {
      throw new Error(`Account not found: ${accountId}`);
    }
    return account;
  }

  function getHistorySummary(accountId: string): AccountHistorySummary {
    currentAccount(accountId);
    return database.getAccountHistorySummary(accountId);
  }

  function updateAccount(input: AccountUpdateInput): Account {
    const account = currentAccount(input.accountId);
    const normalized = normalizeAccountUpdateInput(
      input,
      account.currencyCode,
      database.getAccountHistorySummary(account.id)
    );
    return database.updateAccount({ accountId: account.id, ...normalized });
  }

  return { getHistorySummary, updateAccount };
}
