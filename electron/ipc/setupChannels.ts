import { normalizeHouseholdSetupInput } from "../../src/app/onboarding/householdSetup.js";
import type { Account, HouseholdAccountContext } from "../../src/domain/types.js";
import {
  normalizeAccountInput,
  selectActiveAccounts,
  type AccountUpdateInput,
} from "../../src/shared/accountLifecycle.js";
import type { LedgerChannelContext } from "./context.js";
import { parseNonEmptyString } from "./validation.js";
export function registerSetupChannels({
  ipcMain,
  assertTrustedRenderer,
  localLedgerDatabase,
  accountLifecycleService,
  sampleHousehold,
  runtimeState,
  ledgerOperationCoordinator,
  applyRuntimeLedgerSnapshot
}: Pick<LedgerChannelContext,
  | "ipcMain"
  | "assertTrustedRenderer"
  | "localLedgerDatabase"
  | "accountLifecycleService"
  | "sampleHousehold"
  | "runtimeState"
  | "ledgerOperationCoordinator"
  | "applyRuntimeLedgerSnapshot"
>): void {

  ipcMain.handle("account:list", (event, householdId: unknown): Account[] => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.getAccountsForHousehold(parseNonEmptyString(householdId, "householdId"));
  });

  ipcMain.handle("account:getCurrent", (event): HouseholdAccountContext | null => {
    assertTrustedRenderer(event);
    if (!localLedgerDatabase.hasHousehold()) return null;
    return {
      householdId: sampleHousehold.id,
      householdName: sampleHousehold.name,
      accounts: selectActiveAccounts(
        localLedgerDatabase.getAccountsForHousehold(sampleHousehold.id)
      ),
    };
  });

  ipcMain.handle("account:create", (event, input: unknown): Promise<Account> => {
    assertTrustedRenderer(event);
    const accountInput = normalizeAccountInput(input);
    return ledgerOperationCoordinator.runExclusive(() => {
      if (!localLedgerDatabase.hasHousehold()) {
        throw new Error("Create the household before adding an account.");
      }
      const account = localLedgerDatabase.createAccount({
        householdId: sampleHousehold.id,
        ...accountInput,
      });
      const runtimeMetadata = localLedgerDatabase.loadRuntimeMetadata();
      if (runtimeMetadata !== null) applyRuntimeLedgerSnapshot(runtimeMetadata);
      runtimeState.ledgerGeneration += 1;
      return account;
    });
  });

  ipcMain.handle("account:getHistorySummary", (event, accountId: unknown) => {
    assertTrustedRenderer(event);
    return accountLifecycleService.getHistorySummary(
      parseNonEmptyString(accountId, "accountId")
    );
  });

  ipcMain.handle("account:update", (event, input: unknown): Promise<Account> => {
    assertTrustedRenderer(event);
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new Error("Account details must be an object.");
    }
    const record = input as Record<string, unknown>;
    const validated: AccountUpdateInput = {
      accountId: parseNonEmptyString(record.accountId, "accountId"),
      ...normalizeAccountInput(record),
    };
    return ledgerOperationCoordinator.runExclusive(() => {
      const account = accountLifecycleService.updateAccount(validated);
      const runtimeMetadata = localLedgerDatabase.loadRuntimeMetadata();
      if (runtimeMetadata !== null) applyRuntimeLedgerSnapshot(runtimeMetadata);
      runtimeState.ledgerGeneration += 1;
      return account;
    });
  });

  ipcMain.handle("account:archive", (event, accountId: unknown): Promise<Account> => {
    assertTrustedRenderer(event);
    const validatedAccountId = parseNonEmptyString(accountId, "accountId");
    return ledgerOperationCoordinator.runExclusive(() => {
      const account = accountLifecycleService.archiveAccount(
        validatedAccountId,
        new Date().toISOString()
      );
      const runtimeMetadata = localLedgerDatabase.loadRuntimeMetadata();
      if (runtimeMetadata !== null) applyRuntimeLedgerSnapshot(runtimeMetadata);
      runtimeState.ledgerGeneration += 1;
      return account;
    });
  });

  ipcMain.handle("account:restore", (event, accountId: unknown): Promise<Account> => {
    assertTrustedRenderer(event);
    const validatedAccountId = parseNonEmptyString(accountId, "accountId");
    return ledgerOperationCoordinator.runExclusive(() => {
      const account = accountLifecycleService.restoreAccount(validatedAccountId);
      const runtimeMetadata = localLedgerDatabase.loadRuntimeMetadata();
      if (runtimeMetadata !== null) applyRuntimeLedgerSnapshot(runtimeMetadata);
      runtimeState.ledgerGeneration += 1;
      return account;
    });
  });

  ipcMain.handle("setup:isRequired", (event): boolean => {
    assertTrustedRenderer(event);
    return !localLedgerDatabase.hasHousehold();
  });

  ipcMain.handle("setup:create", (event, input: unknown): void => {
    assertTrustedRenderer(event);
    const setupInput = normalizeHouseholdSetupInput(input);
    localLedgerDatabase.createInitialHouseholdAndAccount(setupInput);
    const runtimeMetadata = localLedgerDatabase.loadRuntimeMetadata();
    if (runtimeMetadata !== null) applyRuntimeLedgerSnapshot(runtimeMetadata);
    runtimeState.ledgerGeneration += 1;
  });
}
