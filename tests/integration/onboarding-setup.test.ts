import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";

const temporaryDirectories: string[] = [];
const closeLedgers: Array<() => void> = [];

afterEach(() => {
  for (const closeLedger of closeLedgers.splice(0)) closeLedger();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createEmptyLedger() {
  const directory = mkdtempSync(join(tmpdir(), "budget-onboarding-"));
  temporaryDirectories.push(directory);
  const dbPath = join(directory, "ledger.sqlite");
  const ledger = createLocalLedgerDatabase({ dbPath });
  closeLedgers.push(ledger.close);
  return { dbPath, ledger };
}

describe("first-run household setup persistence", () => {
  it("reports first-run setup only for an empty database", () => {
    const { ledger } = createEmptyLedger();

    expect(ledger.hasHousehold()).toBe(false);
    expect(ledger.loadRuntimeMetadata()).toBeNull();
  });

  it("persists one linked household and account and skips setup after reopening", () => {
    const { dbPath, ledger } = createEmptyLedger();

    const created = ledger.createInitialHouseholdAndAccount({
      householdName: "  Test Household  ",
      accountName: "  Checking  ",
      currencyCode: "nok",
    });

    expect(created.household.name).toBe("Test Household");
    expect(created.account).toMatchObject({
      householdId: created.household.id,
      name: "Checking",
      currencyCode: "NOK",
    });
    expect(ledger.loadRuntimeMetadata()).toMatchObject({
      household: created.household,
      accounts: [created.account],
    });

    const reopenedLedger = createLocalLedgerDatabase({ dbPath });
    closeLedgers.push(reopenedLedger.close);
    expect(reopenedLedger.hasHousehold()).toBe(true);
    expect(reopenedLedger.loadRuntimeMetadata()?.accounts).toEqual([created.account]);
  });

  it("rejects invalid setup values without creating a household or account", () => {
    const { ledger } = createEmptyLedger();

    expect(() =>
      ledger.createInitialHouseholdAndAccount({
        householdName: "   ",
        accountName: "Checking",
        currencyCode: "NOK",
      })
    ).toThrow();
    expect(ledger.hasHousehold()).toBe(false);
    expect(ledger.loadRuntimeMetadata()).toBeNull();
  });

  it("rolls back household creation when inserting the first account fails", () => {
    const { dbPath, ledger } = createEmptyLedger();
    const schemaConnection = new DatabaseSync(dbPath);
    schemaConnection.exec(`
      CREATE TRIGGER reject_initial_account
      BEFORE INSERT ON accounts
      BEGIN
        SELECT RAISE(ABORT, 'account rejected');
      END;
    `);
    schemaConnection.close();

    expect(() =>
      ledger.createInitialHouseholdAndAccount({
        householdName: "Test Household",
        accountName: "Checking",
        currencyCode: "NOK",
      })
    ).toThrow("account rejected");
    expect(ledger.hasHousehold()).toBe(false);
    expect(ledger.loadRuntimeMetadata()).toBeNull();
  });

  it("propagates a household read error instead of treating it as first run", () => {
    const { dbPath, ledger } = createEmptyLedger();
    const schemaConnection = new DatabaseSync(dbPath);
    schemaConnection.exec(`
      DROP TABLE households;
      CREATE VIEW households AS SELECT id FROM missing_households;
    `);
    schemaConnection.close();

    expect(() => ledger.hasHousehold()).toThrow();
  });
});
