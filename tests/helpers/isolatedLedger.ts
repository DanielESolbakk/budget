import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalLedgerDatabase, type LocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";

type SeedData = NonNullable<Parameters<typeof createLocalLedgerDatabase>[0]["seedData"]>;
interface IsolatedLedgerContext {
  ledger: LocalLedgerDatabase;
  directory: string;
  dbPath: string;
}

export async function withIsolatedLedger<T>(
  options: { seed?: SeedData },
  run: (context: IsolatedLedgerContext) => T | Promise<T>
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "budget-isolated-ledger-"));
  const dbPath = join(directory, "ledger.sqlite");
  let ledger: LocalLedgerDatabase | undefined;
  try {
    ledger = createLocalLedgerDatabase({
      dbPath,
      seedData: options.seed ?? {
        household: { id: "hh-isolated", name: "Synthetic household", createdAtIso: "2026-01-01T00:00:00Z" },
        accounts: [{ id: "acc-isolated", householdId: "hh-isolated", name: "Current", currencyCode: "NOK" }],
        transactions: [], importJobs: [], monthlyCategoryTargets: [],
      },
    });
    return await run({ ledger, directory, dbPath });
  } finally {
    try {
      ledger?.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
