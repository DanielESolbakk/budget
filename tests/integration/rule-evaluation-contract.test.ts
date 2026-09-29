import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { categorizeTransactions } from "../../src/domain/categorization/categorizeTransaction.js";
import { mapCsvRows } from "../../src/domain/import/csvRowMapper.js";
import { parseCsvText } from "../../src/domain/import/parseCsvText.js";
import type { LedgerSnapshotData } from "../../src/domain/backup/snapshotContract.js";

const HOUSEHOLD = {
  id: "hh-rule-contract",
  name: "Rule Contract Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};
const ACCOUNT = {
  id: "acc-rule-contract",
  householdId: HOUSEHOLD.id,
  name: "Brukskonto",
  currencyCode: "NOK",
};

function createSeedData(): LedgerSnapshotData {
  return {
    household: HOUSEHOLD,
    accounts: [ACCOUNT],
    transactions: [],
    importJobs: [],
    monthlyCategoryTargets: [],
    merchantCategoryRules: [],
  };
}

describe("rule evaluation import contract", () => {
  it("persists the local category decision, confidence, and rule provenance for imported transactions", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-rule-contract-"));
    const dbPath = join(tempDir, "ledger.sqlite");
    const csvPath = join(tempDir, "transactions.csv");
    const csvText =
      "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta\n" +
      "28.05.2026;;REMA 1000 AS;;-12.50;NOK\n" +
      "28.05.2026;;UNKNOWN LOCAL MERCHANT;;-5.00;NOK\n";

    try {
      const mapped = mapCsvRows(parseCsvText(csvText), {
        householdId: HOUSEHOLD.id,
        accountId: ACCOUNT.id,
        importJobId: "import-rule-contract",
      });
      expect(mapped.skipped).toEqual([]);
      const categorized = categorizeTransactions(mapped.transactions);
      const database = createLocalLedgerDatabase({ dbPath, seedData: createSeedData() });

      try {
        database.appendImportJobAndTransactions(
          {
            id: "import-rule-contract",
            householdId: HOUSEHOLD.id,
            sourceType: "csv",
            sourceName: csvPath,
            startedAtIso: "2026-05-28T00:00:00Z",
          },
          categorized
        );

        const storedTransactions = database.loadLedgerSnapshotData().transactions;
        expect(storedTransactions.map((transaction) => transaction.categorization)).toEqual([
          {
            status: "categorized",
            categoryId: "groceries",
            confidence: 0.95,
            confidenceLevel: "high",
            requiresReview: false,
            selectedRule: {
              ruleId: "builtin-groceries-rema-1000",
              merchantAlias: "REMA 1000",
              categoryId: "groceries",
              priority: 0,
            },
            matchingRules: [
              {
                ruleId: "builtin-groceries-rema-1000",
                merchantAlias: "REMA 1000",
                categoryId: "groceries",
                priority: 0,
              },
            ],
          },
          {
            status: "unmatched",
            confidence: 0,
            confidenceLevel: "low",
            requiresReview: true,
            matchingRules: [],
          },
        ]);
      } finally {
        database.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
