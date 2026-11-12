import type { Account } from "../domain/types.js";
import { isCurrencyCode } from "../domain/types.js";

export interface AccountInput {
  accountName: string;
  currencyCode: string;
}

export interface AccountUpdateInput extends AccountInput {
  accountId: string;
}

export interface AccountHistorySummary {
  transactionCount: number;
  coveragePeriodCount: number;
  checkpointCount: number;
}

export function archiveAccount(
  account: Account,
  activeAccountCount: number,
  archivedAtIso: string
): Account {
  if (account.archivedAtIso !== undefined) {
    throw new Error("This account is already archived.");
  }
  if (!Number.isInteger(activeAccountCount) || activeAccountCount < 1) {
    throw new Error("Active account count must be a positive integer.");
  }
  if (activeAccountCount <= 1) {
    throw new Error("Keep at least one active account. Add another account before archiving this one.");
  }
  if (Number.isNaN(Date.parse(archivedAtIso))) {
    throw new Error("Archive timestamp must be a valid date.");
  }
  return { ...account, archivedAtIso };
}

export function selectActiveAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((account) => account.archivedAtIso === undefined);
}

export class AccountInputValidationError extends Error {
  constructor(readonly field: keyof AccountInput, message: string) {
    super(message);
    this.name = "AccountInputValidationError";
  }
}

export function normalizeAccountInput(input: unknown): AccountInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Account details must be an object.");
  }

  const record = input as Record<string, unknown>;
  if (typeof record.accountName !== "string" || record.accountName.trim().length === 0) {
    throw new AccountInputValidationError("accountName", "Enter an account name.");
  }
  const accountName = record.accountName.trim();
  if (accountName.length > 100) {
    throw new AccountInputValidationError(
      "accountName",
      "Use 100 characters or fewer for the account name."
    );
  }

  const currencyCode =
    typeof record.currencyCode === "string" ? record.currencyCode.trim().toUpperCase() : "";
  if (!isCurrencyCode(currencyCode)) {
    throw new AccountInputValidationError(
      "currencyCode",
      "Enter a three-letter currency code, such as NOK."
    );
  }

  return { accountName, currencyCode };
}

export function normalizeAccountUpdateInput(
  input: unknown,
  currentCurrencyCode: string,
  history: AccountHistorySummary
): AccountInput {
  const accountInput = normalizeAccountInput(input);
  const hasHistory =
    history.transactionCount > 0 ||
    history.coveragePeriodCount > 0 ||
    history.checkpointCount > 0;
  if (accountInput.currencyCode !== currentCurrencyCode && hasHistory) {
    throw new AccountInputValidationError(
      "currencyCode",
      "Currency cannot be changed while account history exists. Create another account instead."
    );
  }
  return accountInput;
}
