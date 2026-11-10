import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import type { Household } from "../../src/domain/types.js";

const household: Household = {
  id: "reporting-household",
  name: "Synthetic household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

describe("reporting period preference persistence", () => {
  it("defaults to calendar months and reloads a saved payday rule after restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-reporting-preference-"));
    const dbPath = join(directory, "ledger.sqlite");
    let ledger = createLocalLedgerDatabase({ dbPath });

    try {
      const { household: createdHousehold } = ledger.createInitialHouseholdAndAccount({
        householdName: household.name,
        accountName: "Everyday",
        currencyCode: "NOK",
      });

      expect(ledger.getReportingPeriodRule(createdHousehold.id))
        .toEqual({ type: "calendar-month" });

      ledger.saveReportingPeriodRule(createdHousehold.id, { type: "last-weekday", weekday: 4 });

      ledger.close();
      ledger = createLocalLedgerDatabase({ dbPath });
      expect(ledger.getReportingPeriodRule(createdHousehold.id))
        .toEqual({ type: "last-weekday", weekday: 4 });
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores a saved preference while legacy snapshots default to calendar months", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-reporting-backup-"));
    const dbPath = join(directory, "ledger.sqlite");
    const snapshotPath = join(directory, "snapshot.json");
    const legacySnapshotPath = join(directory, "legacy-snapshot.json");
    const ledger = createLocalLedgerDatabase({ dbPath });

    try {
      const { household: createdHousehold } = ledger.createInitialHouseholdAndAccount({
        householdName: household.name,
        accountName: "Everyday",
        currencyCode: "NOK",
      });

      ledger.saveReportingPeriodRule(createdHousehold.id, { type: "fixed-day", dayOfMonth: 25 });

      createBackupSnapshot({
        ...ledger.loadLedgerSnapshotData(),
        createdAtIso: "2026-06-01T12:00:00Z",
        outputPath: snapshotPath,
      });
      const restored = restoreBackupSnapshot({ snapshotPath });
      expect(restored.reportingPeriodRule).toEqual({
        type: "fixed-day",
        dayOfMonth: 25,
      });

      const legacy = JSON.parse(readFileSync(snapshotPath, "utf8")) as
        Record<string, unknown> & { metadata: Record<string, unknown> };
      legacy.metadata.version = "10";
      delete legacy.reportingPeriodRule;
      writeFileSync(legacySnapshotPath, JSON.stringify(legacy), "utf8");
      expect(restoreBackupSnapshot({ snapshotPath: legacySnapshotPath }).reportingPeriodRule)
        .toEqual({ type: "calendar-month" });
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
