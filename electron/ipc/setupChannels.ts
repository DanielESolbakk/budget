import { normalizeHouseholdSetupInput } from "../../src/app/onboarding/householdSetup.js";
import type { Account, HouseholdAccountContext } from "../../src/domain/types.js";
import type { LedgerChannelContext } from "./context.js";
import { parseNonEmptyString } from "./validation.js";
export function registerSetupChannels({
  ipcMain,
  assertTrustedRenderer,
  localLedgerDatabase,
  sampleHousehold,
  runtimeState,
  applyRuntimeLedgerSnapshot
}: Pick<LedgerChannelContext,
  | "ipcMain"
  | "assertTrustedRenderer"
  | "localLedgerDatabase"
  | "sampleHousehold"
  | "runtimeState"
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
      accounts: localLedgerDatabase.getAccountsForHousehold(sampleHousehold.id),
    };
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
