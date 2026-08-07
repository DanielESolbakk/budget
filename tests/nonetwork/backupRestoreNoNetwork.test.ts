import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBackupSnapshot, createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import type { Account, Household, ImportJob, MonthlyCategoryTarget, Transaction } from "../../src/domain/types.js";

const SAMPLE_HOUSEHOLD: Household = {
  id: "hh-no-network",
  name: "No-Network Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const SAMPLE_ACCOUNTS: Account[] = [
  { id: "acc-1", householdId: "hh-no-network", name: "Brukskonto", currencyCode: "NOK" },
];

const SAMPLE_TRANSACTIONS: Transaction[] = [
  {
    id: "tx-1",
    householdId: "hh-no-network",
    accountId: "acc-1",
    bookedAtIso: "2026-05-01T00:00:00Z",
    amountMinor: 50000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
];

const SAMPLE_IMPORT_JOBS: ImportJob[] = [];

const SAMPLE_TARGETS: MonthlyCategoryTarget[] = [];

const BASE_INPUT = {
  household: SAMPLE_HOUSEHOLD,
  accounts: SAMPLE_ACCOUNTS,
  transactions: SAMPLE_TRANSACTIONS,
  importJobs: SAMPLE_IMPORT_JOBS,
  monthlyCategoryTargets: SAMPLE_TARGETS,
  createdAtIso: "2026-06-01T12:00:00Z",
};

describe("backup/restore no-network verification", () => {
  const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;

  afterEach(() => {
    (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
  });

  it("buildBackupSnapshot does not invoke fetch", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const snapshot = buildBackupSnapshot(BASE_INPUT);

    expect(snapshot.metadata.transactionCount).toBe(1);
    expect(fetchCalled).toBe(false);
  });

  it("createBackupSnapshot does not invoke fetch", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-backup-nn-"));
    const outputPath = join(tempDir, "snapshot.json");

    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    try {
      const result = createBackupSnapshot({ ...BASE_INPUT, outputPath });
      expect(result.transactionCount).toBe(1);
      expect(fetchCalled).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("restoreBackupSnapshot does not invoke fetch", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-restore-nn-"));
    const outputPath = join(tempDir, "snapshot.json");

    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    try {
      createBackupSnapshot({ ...BASE_INPUT, outputPath });
      const restored = restoreBackupSnapshot({ snapshotPath: outputPath });
      expect(restored.transactionCount).toBe(1);
      expect(fetchCalled).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("backup/restore round-trip is deterministic and does not invoke fetch", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-det-nn-"));
    const path1 = join(tempDir, "snap1.json");
    const path2 = join(tempDir, "snap2.json");

    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    try {
      createBackupSnapshot({ ...BASE_INPUT, outputPath: path1 });
      createBackupSnapshot({ ...BASE_INPUT, outputPath: path2 });

      const r1 = restoreBackupSnapshot({ snapshotPath: path1 });
      const r2 = restoreBackupSnapshot({ snapshotPath: path2 });

      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
      expect(fetchCalled).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
