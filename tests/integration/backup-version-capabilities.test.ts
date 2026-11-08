import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";

const coverage = ["accountStatementCoveragePeriods", "accountBalanceCheckpoints", "exchangeRates"];
const properties = ["properties", "propertyValuations"];
const loans = ["loanRecords", "loanBalanceSnapshots"];
const holdings = ["holdings", "holdingValuations"];
const recurring = ["recurringCommitments", "recurringCommitmentPaymentLinks", "recurringCommitmentDecisions"];
const versions = [
  { version: "1", required: [] },
  { version: "2", required: ["merchantCategoryRules"] },
  { version: "3", required: ["merchantCategoryRules", ...coverage] },
  { version: "4", required: ["merchantCategoryRules", ...coverage, ...properties] },
  { version: "5", required: ["merchantCategoryRules", ...coverage, ...properties] },
  { version: "6", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans] },
  { version: "7", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans, ...holdings] },
  { version: "8", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans, ...holdings] },
  { version: "9", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans, ...holdings] },
  { version: "10", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans, ...holdings, ...recurring] },
];

function snapshot(version: string, required: string[]): Record<string, unknown> {
  return {
    metadata: { version, createdAtIso: "2026-05-01T00:00:00Z", accountCount: 1, transactionCount: 0 },
    household: { id: "hh", name: "Synthetic", createdAtIso: "2026-01-01T00:00:00Z" },
    accounts: [{ id: "acc", householdId: "hh", name: "Current", currencyCode: "NOK" }],
    transactions: [], importJobs: [], monthlyCategoryTargets: [],
    ...Object.fromEntries(required.map(name => [name, []])),
  };
}

function withSnapshot(value: unknown, run: (snapshotPath: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "budget-version-capabilities-"));
  const snapshotPath = join(directory, "snapshot.json");
  try {
    writeFileSync(snapshotPath, JSON.stringify(value), "utf8");
    run(snapshotPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("backup historical version capabilities", () => {
  it.each(versions)("normalizes absent historical collections for version $version", ({ version, required }) => {
    withSnapshot(snapshot(version, required), snapshotPath => {
      expect(restoreBackupSnapshot({ snapshotPath })).toEqual({
        household: { id: "hh", name: "Synthetic", createdAtIso: "2026-01-01T00:00:00Z" },
        accounts: [{ id: "acc", householdId: "hh", name: "Current", currencyCode: "NOK" }],
        transactions: [], importJobs: [], monthlyCategoryTargets: [], merchantCategoryRules: [],
        accountStatementCoveragePeriods: [], accountBalanceCheckpoints: [], exchangeRates: [],
        properties: [], propertyValuations: [], loanRecords: [], loanBalanceSnapshots: [],
        holdings: [], holdingValuations: [], recurringCommitments: [],
        recurringCommitmentPaymentLinks: [], recurringCommitmentDecisions: [], transactionCount: 0,
      });
    });
  });

  it.each(versions.flatMap(({ version, required }) =>
    [...required, "accounts", "transactions", "importJobs", "monthlyCategoryTargets"].map(collection =>
      ({ version, required, collection }))))(
    "rejects missing $collection for version $version",
    ({ version, required, collection }) => {
      const value = snapshot(version, required);
      delete value[collection];
      withSnapshot(value, snapshotPath => {
        expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(/Invalid snapshot/);
      });
    }
  );

  it.each(["4", "5", "6", "7", "8"])("defaults pre-share property records for version %s", version => {
    const requirements = versions.find(row => row.version === version)!.required;
    const value = snapshot(version, requirements);
    value.properties = [{ id: "property", householdId: "hh", label: "Home",
      createdAtIso: "2026-01-01T00:00:00Z" }];
    withSnapshot(value, snapshotPath => {
      expect(restoreBackupSnapshot({ snapshotPath }).properties).toEqual([
        { id: "property", householdId: "hh", label: "Home", createdAtIso: "2026-01-01T00:00:00Z",
          ownershipShareBasisPoints: 10000 },
      ]);
    });
  });

  it.each(["9", "10"])("rejects missing ownership share in version %s", version => {
    const requirements = versions.find(row => row.version === version)!.required;
    const value = snapshot(version, requirements);
    value.properties = [{ id: "property", householdId: "hh", label: "Home",
      createdAtIso: "2026-01-01T00:00:00Z" }];
    withSnapshot(value, snapshotPath => {
      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(/Invalid snapshot properties/);
    });
  });

  it.each(["0", "11", "01", 10, null])("rejects unsupported version %j", version => {
    const value = snapshot("10", versions[9]!.required);
    value.metadata = { version, createdAtIso: "2026-05-01T00:00:00Z", accountCount: 1, transactionCount: 0 };
    withSnapshot(value, snapshotPath => {
      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(/Unsupported snapshot version/);
    });
  });
});
