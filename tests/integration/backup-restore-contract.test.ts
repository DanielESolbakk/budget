import { mkdtempSync, rmSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBackupSnapshot, createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { SNAPSHOT_VERSION } from "../../src/domain/backup/snapshotContract.js";
import type { Account, Household, ImportJob, MonthlyCategoryTarget, Transaction } from "../../src/domain/types.js";

const SAMPLE_HOUSEHOLD: Household = {
  id: "hh-test",
  name: "Test Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const SAMPLE_ACCOUNTS: Account[] = [
  { id: "acc-a", householdId: "hh-test", name: "Brukskonto", currencyCode: "NOK" },
  { id: "acc-b", householdId: "hh-test", name: "Sparekonto", currencyCode: "NOK" },
];

const SAMPLE_TRANSACTIONS: Transaction[] = [
  {
    id: "tx-2",
    householdId: "hh-test",
    accountId: "acc-a",
    bookedAtIso: "2026-05-10T00:00:00Z",
    amountMinor: -2500,
    merchantRaw: "Kiwi Majorstuen",
    categoryId: "groceries",
    importJobId: "job-01",
  },
  {
    id: "tx-1",
    householdId: "hh-test",
    accountId: "acc-a",
    bookedAtIso: "2026-05-01T00:00:00Z",
    amountMinor: 50000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
];

const SAMPLE_IMPORT_JOBS: ImportJob[] = [
  {
    id: "job-01",
    householdId: "hh-test",
    sourceType: "csv",
    sourceName: "may-2026.csv",
    startedAtIso: "2026-05-01T08:00:00Z",
    finishedAtIso: "2026-05-01T08:01:00Z",
  },
];

const SAMPLE_TARGETS: MonthlyCategoryTarget[] = [
  { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 9000 },
];

describe("backup/restore contract", () => {
  describe("AC-1: snapshot creation produces deterministic artifact with expected schema and metadata", () => {
    it("buildBackupSnapshot sets correct metadata version and transaction/account counts", () => {
      const snapshot = buildBackupSnapshot({
        household: SAMPLE_HOUSEHOLD,
        accounts: SAMPLE_ACCOUNTS,
        transactions: SAMPLE_TRANSACTIONS,
        importJobs: SAMPLE_IMPORT_JOBS,
        monthlyCategoryTargets: SAMPLE_TARGETS,
        createdAtIso: "2026-06-01T12:00:00Z",
      });

      expect(snapshot.metadata.version).toBe(SNAPSHOT_VERSION);
      expect(snapshot.metadata.transactionCount).toBe(2);
      expect(snapshot.metadata.accountCount).toBe(2);
      expect(snapshot.metadata.createdAtIso).toBe("2026-06-01T12:00:00Z");
    });

    it("buildBackupSnapshot sorts transactions by id ascending", () => {
      const snapshot = buildBackupSnapshot({
        household: SAMPLE_HOUSEHOLD,
        accounts: SAMPLE_ACCOUNTS,
        transactions: SAMPLE_TRANSACTIONS,
        importJobs: SAMPLE_IMPORT_JOBS,
        monthlyCategoryTargets: SAMPLE_TARGETS,
        createdAtIso: "2026-06-01T12:00:00Z",
      });

      expect(snapshot.transactions[0]!.id).toBe("tx-1");
      expect(snapshot.transactions[1]!.id).toBe("tx-2");
    });

    it("buildBackupSnapshot sorts accounts by id ascending", () => {
      const snapshot = buildBackupSnapshot({
        household: SAMPLE_HOUSEHOLD,
        accounts: [SAMPLE_ACCOUNTS[1]!, SAMPLE_ACCOUNTS[0]!],
        transactions: SAMPLE_TRANSACTIONS,
        importJobs: SAMPLE_IMPORT_JOBS,
        monthlyCategoryTargets: SAMPLE_TARGETS,
        createdAtIso: "2026-06-01T12:00:00Z",
      });

      expect(snapshot.accounts[0]!.id).toBe("acc-a");
      expect(snapshot.accounts[1]!.id).toBe("acc-b");
    });

    it("buildBackupSnapshot produces identical output on repeated calls with same input (determinism)", () => {
      const input = {
        household: SAMPLE_HOUSEHOLD,
        accounts: SAMPLE_ACCOUNTS,
        transactions: SAMPLE_TRANSACTIONS,
        importJobs: SAMPLE_IMPORT_JOBS,
        monthlyCategoryTargets: SAMPLE_TARGETS,
        createdAtIso: "2026-06-01T12:00:00Z",
      };

      const first = buildBackupSnapshot(input);
      const second = buildBackupSnapshot(input);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it("createBackupSnapshot writes a readable JSON file at the specified path", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-backup-"));
      const outputPath = join(tempDir, "snapshot.json");

      try {
        const result = createBackupSnapshot({
          household: SAMPLE_HOUSEHOLD,
          accounts: SAMPLE_ACCOUNTS,
          transactions: SAMPLE_TRANSACTIONS,
          importJobs: SAMPLE_IMPORT_JOBS,
          monthlyCategoryTargets: SAMPLE_TARGETS,
          createdAtIso: "2026-06-01T12:00:00Z",
          outputPath,
        });

        expect(result.outputPath).toBe(outputPath);
        expect(result.transactionCount).toBe(2);
        expect(result.createdAtIso).toBe("2026-06-01T12:00:00Z");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("AC-2: restore reproduces equivalent ledger state", () => {
    it("round-trip: restore after create returns equivalent ledger state", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-restore-"));
      const outputPath = join(tempDir, "snapshot.json");

      try {
        createBackupSnapshot({
          household: SAMPLE_HOUSEHOLD,
          accounts: SAMPLE_ACCOUNTS,
          transactions: SAMPLE_TRANSACTIONS,
          importJobs: SAMPLE_IMPORT_JOBS,
          monthlyCategoryTargets: SAMPLE_TARGETS,
          createdAtIso: "2026-06-01T12:00:00Z",
          outputPath,
        });

        const restored = restoreBackupSnapshot({ snapshotPath: outputPath });

        expect(restored.household).toEqual(SAMPLE_HOUSEHOLD);
        expect(restored.accounts).toEqual(
          [...SAMPLE_ACCOUNTS].sort((a, b) => a.id.localeCompare(b.id))
        );
        expect(restored.transactions).toEqual(
          [...SAMPLE_TRANSACTIONS].sort((a, b) => a.id.localeCompare(b.id))
        );
        expect(restored.importJobs).toEqual(SAMPLE_IMPORT_JOBS);
        expect(restored.monthlyCategoryTargets).toEqual(SAMPLE_TARGETS);
        expect(restored.transactionCount).toBe(2);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("round-trip is idempotent: two snapshots from the same input produce identical files", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-idempotent-"));
      const path1 = join(tempDir, "snap1.json");
      const path2 = join(tempDir, "snap2.json");

      try {
        const input = {
          household: SAMPLE_HOUSEHOLD,
          accounts: SAMPLE_ACCOUNTS,
          transactions: SAMPLE_TRANSACTIONS,
          importJobs: SAMPLE_IMPORT_JOBS,
          monthlyCategoryTargets: SAMPLE_TARGETS,
          createdAtIso: "2026-06-01T12:00:00Z",
        };

        createBackupSnapshot({ ...input, outputPath: path1 });
        createBackupSnapshot({ ...input, outputPath: path2 });

        const r1 = restoreBackupSnapshot({ snapshotPath: path1 });
        const r2 = restoreBackupSnapshot({ snapshotPath: path2 });

        expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("restoreBackupSnapshot throws on an invalid snapshot version", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-bad-version-"));
      const outputPath = join(tempDir, "bad.json");

      try {
        const badSnapshot = {
          metadata: { version: "0", createdAtIso: "2026-01-01T00:00:00Z", transactionCount: 0, accountCount: 0 },
          household: SAMPLE_HOUSEHOLD,
          accounts: [],
          transactions: [],
          importJobs: [],
          monthlyCategoryTargets: [],
        };
        fsWriteFileSync(outputPath, JSON.stringify(badSnapshot), "utf8");

        expect(() => restoreBackupSnapshot({ snapshotPath: outputPath })).toThrow(
          /Unsupported snapshot version/
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("restoreBackupSnapshot throws on malformed JSON", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-bad-json-"));
      const outputPath = join(tempDir, "corrupt.json");

      try {
        fsWriteFileSync(outputPath, "{ not valid json", "utf8");

        expect(() => restoreBackupSnapshot({ snapshotPath: outputPath })).toThrow(
          /Failed to parse snapshot file/
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("AC-1: empty ledger produces valid snapshot", () => {
    it("buildBackupSnapshot handles empty collections", () => {
      const snapshot = buildBackupSnapshot({
        household: SAMPLE_HOUSEHOLD,
        accounts: [],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
        createdAtIso: "2026-06-01T12:00:00Z",
      });

      expect(snapshot.metadata.transactionCount).toBe(0);
      expect(snapshot.metadata.accountCount).toBe(0);
      expect(snapshot.transactions).toEqual([]);
      expect(snapshot.accounts).toEqual([]);
    });
  });
});
