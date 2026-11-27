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
const sourceOnlyLoans = ["sourceOnlyLoanRecords"];
const mortgageEvidence = ["mortgageEvidenceVersions"];
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
  { version: "11", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans, ...holdings, ...recurring] },
  { version: "12", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans, ...holdings, ...recurring] },
  { version: "13", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans, ...holdings, ...recurring,
    "categories", "recoveryHistory"] },
  { version: "14", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans, ...holdings, ...recurring,
    "categories", "recoveryHistory"] },
  { version: "15", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans, ...holdings,
    ...recurring, ...sourceOnlyLoans, "categories", "recoveryHistory"] },
  { version: "16", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans, ...holdings,
    ...recurring, ...sourceOnlyLoans, ...mortgageEvidence, "categories", "recoveryHistory"] },
  { version: "17", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans, ...holdings,
    ...recurring, ...sourceOnlyLoans, ...mortgageEvidence, "categories", "recoveryHistory"] },
  { version: "18", required: ["merchantCategoryRules", ...coverage, ...properties, ...loans, ...holdings,
    ...recurring, ...sourceOnlyLoans, ...mortgageEvidence, "categories", "recoveryHistory"] },
];

function snapshot(version: string, required: string[]): Record<string, unknown> {
  return {
    metadata: { version, createdAtIso: "2026-05-01T00:00:00Z", accountCount: 1, transactionCount: 0 },
    household: { id: "hh", name: "Synthetic", createdAtIso: "2026-01-01T00:00:00Z" },
    accounts: [{ id: "acc", householdId: "hh", name: "Current", currencyCode: "NOK" }],
    transactions: [], importJobs: [], monthlyCategoryTargets: [],
    ...(version === "11" || version === "12" || version === "13" || version === "14" ||
      version === "16" || version === "17" || version === "18"
      ? { reportingPeriodRule: { type: "calendar-month" } }
      : {}),
    ...Object.fromEntries(required.map(name => [name, []])),
    ...(version === "13" || version === "14" || version === "15" || version === "16" ||
      version === "17" || version === "18" ? { recoveryHistory: {
      merchantCorrections: [], sameMerchantPropagations: [], importOperations: [],
      ...(version === "14" || version === "15" || version === "16" ||
        version === "17" || version === "18" ? { transactionCategoryEdits: [] } : {}),
    } } : {}),
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
        ...(version === "13" || version === "14" || version === "15" || version === "16" ||
          version === "17" || version === "18"
          ? { categories: [], recoveryHistory: {
          merchantCorrections: [], sameMerchantPropagations: [], importOperations: [],
          transactionCategoryEdits: [],
        } }
          : {}),
        accounts: [{ id: "acc", householdId: "hh", name: "Current", currencyCode: "NOK" }],
        transactions: [], importJobs: [], monthlyCategoryTargets: [], merchantCategoryRules: [],
        accountStatementCoveragePeriods: [], accountBalanceCheckpoints: [], exchangeRates: [],
        properties: [], propertyValuations: [], loanRecords: [], sourceOnlyLoanRecords: [],
        loanBalanceSnapshots: [], mortgageEvidenceVersions: [],
        holdings: [], holdingValuations: [], recurringCommitments: [],
        recurringCommitmentPaymentLinks: [], recurringCommitmentDecisions: [],
        reportingPeriodRule: { type: "calendar-month" }, transactionCount: 0,
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

  it.each(["1", "2", "3", "4", "5", "6", "7", "8"])("defaults pre-share property records for version %s", version => {
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

  it.each(["9", "10", "11"])("rejects missing ownership share in version %s", version => {
    const requirements = versions.find(row => row.version === version)!.required;
    const value = snapshot(version, requirements);
    value.properties = [{ id: "property", householdId: "hh", label: "Home",
      createdAtIso: "2026-01-01T00:00:00Z" }];
    withSnapshot(value, snapshotPath => {
      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(/Invalid snapshot properties/);
    });
  });

  it.each(["1", "2", "3", "4", "5", "6", "7", "8"])("defaults supplied pre-share loan records for version %s", version => {
    const requirements = versions.find(row => row.version === version)!.required;
    const value = snapshot(version, requirements);
    value.loanRecords = [{
      id: "loan", householdId: "hh", label: "Mortgage", principalMinor: 100000,
      annualInterestRateBasisPoints: 500, termMonths: 12, paymentAmountMinor: 9000,
      paymentFrequency: "monthly", currencyCode: "NOK", createdAtIso: "2026-01-01T00:00:00Z",
    }];
    withSnapshot(value, snapshotPath => {
      expect(restoreBackupSnapshot({ snapshotPath }).loanRecords).toEqual([{
        id: "loan", householdId: "hh", label: "Mortgage", principalMinor: 100000,
        annualInterestRateBasisPoints: 500, termMonths: 12, paymentAmountMinor: 9000,
        paymentFrequency: "monthly", currencyCode: "NOK", createdAtIso: "2026-01-01T00:00:00Z",
        responsibilityShareBasisPoints: 10000,
      }]);
    });
  });

  it.each(["9", "10"])("rejects missing responsibility share in version %s", version => {
    const requirements = versions.find(row => row.version === version)!.required;
    const value = snapshot(version, requirements);
    value.loanRecords = [{
      id: "loan", householdId: "hh", label: "Mortgage", principalMinor: 100000,
      annualInterestRateBasisPoints: 500, termMonths: 12, paymentAmountMinor: 9000,
      paymentFrequency: "monthly", currencyCode: "NOK", createdAtIso: "2026-01-01T00:00:00Z",
    }];
    withSnapshot(value, snapshotPath => {
      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(/Invalid snapshot loan records/);
    });
  });

  it.each(["0", "19", "01", 10, null])("rejects unsupported version %j", version => {
    const value = snapshot("10", versions[9]!.required);
    value.metadata = { version, createdAtIso: "2026-05-01T00:00:00Z", accountCount: 1, transactionCount: 0 };
    withSnapshot(value, snapshotPath => {
      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(/Unsupported snapshot version/);
    });
  });
});
