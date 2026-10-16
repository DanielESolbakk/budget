import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { expect, test } from "./fixtures/electron.js";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-upload-shape.csv.gz.base64");

function loadPersistedTransactions(databasePath: string) {
  const ledger = createLocalLedgerDatabase({
    dbPath: databasePath,
    seedData: {
      household: {
        id: "sample-hh",
        name: "Sample Household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [{
        id: "sample-acc",
        householdId: "sample-hh",
        name: "Brukskonto",
        currencyCode: "NOK" as const,
      }],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });

  try {
    return ledger.loadLedgerSnapshotData().transactions;
  } finally {
    ledger.close();
  }
}

test("imports every eligible row from a sanitized Windows-1252 upload-shape CSV", async ({ csvImport, databasePath }) => {
  const directory = mkdtempSync(join(tmpdir(), "budget-upload-shape-csv-"));
  const csvPath = join(directory, `statement-${randomUUID()}.csv`);

  try {
    const compressedFixture = Buffer.from(readFileSync(FIXTURE_PATH, "utf8").replace(/\\s+/g, ""), "base64");
    const fixtureText = gunzipSync(compressedFixture).toString("utf8");
    writeFileSync(csvPath, Buffer.from(fixtureText, "latin1"));

    await csvImport.submitImport(csvPath);
    await expect(csvImport.successStatus).toContainText("Added 776 transactions to your ledger.", {
      timeout: 20_000,
    });

    const transactions = loadPersistedTransactions(databasePath).filter(
      (transaction) => transaction.sourceType === "csv"
    );
    expect(transactions).toHaveLength(776);
    expect(transactions.every((transaction) =>
      Number.isInteger(transaction.amountMinor) &&
      transaction.currencyCode?.length === 3 &&
      /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/.test(transaction.bookedAtIso)
    )).toBe(true);
    expect(transactions.some((transaction) => transaction.amountMinor > 0)).toBe(true);
    expect(transactions.some((transaction) => transaction.amountMinor < 0)).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
