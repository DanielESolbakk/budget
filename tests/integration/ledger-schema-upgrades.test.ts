import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";

describe("ledger schema extraction compatibility", () => {
  it("upgrades pre-history registry/import columns without losing data and remains stable on reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-schema-upgrade-"));
    const dbPath = join(directory, "ledger.sqlite");
    let ledger: ReturnType<typeof createLocalLedgerDatabase> | undefined;
    let raw: DatabaseSync | undefined;
    try {
      ledger = createLocalLedgerDatabase({ dbPath, seedData: {
        household: { id: "hh", name: "Synthetic", createdAtIso: "2026-01-01T00:00:00Z" },
        accounts: [{ id: "acc", householdId: "hh", name: "Current", currencyCode: "NOK" }],
        transactions: [{ id: "tx", householdId: "hh", accountId: "acc", amountMinor: -2500,
          bookedAtIso: "2026-05-01", merchantRaw: "Kiwi" }],
        importJobs: [{ id: "job", householdId: "hh", sourceName: "synthetic.csv",
          sourceType: "csv", startedAtIso: "2026-05-01T00:00:00Z" }],
        monthlyCategoryTargets: [],
        holdings: [{ id: "holding", householdId: "hh", label: "Fund", quantity: 1,
          costBasisMinor: 10000, currencyCode: "NOK", createdAtIso: "2026-01-01T00:00:00Z" }],
      } });
      ledger.close();
      ledger = undefined;
      raw = new DatabaseSync(dbPath);
      raw.exec(`
        ALTER TABLE investment_holdings DROP COLUMN revisions_json;
        ALTER TABLE holding_valuation_snapshots DROP COLUMN correction_json;
        ALTER TABLE property_valuation_snapshots DROP COLUMN correction_json;
        ALTER TABLE import_review_items DROP COLUMN source_evidence_json;
        ALTER TABLE import_jobs DROP COLUMN adapter_id;
        ALTER TABLE import_jobs DROP COLUMN candidate_count;
        ALTER TABLE import_jobs DROP COLUMN validation_failure_count;
        ALTER TABLE import_jobs DROP COLUMN provenance_json;
      `);
      raw.close();
      raw = undefined;
      ledger = createLocalLedgerDatabase({ dbPath });
      expect(ledger.loadLedgerSnapshotData()).toMatchObject({
        transactions: [{ id: "tx", bookedAtIso: "2026-05-01", amountMinor: -2500 }],
        importJobs: [{ id: "job", sourceName: "synthetic.csv", sourceType: "csv" }],
        holdings: [{ id: "holding", label: "Fund", quantity: 1, costBasisMinor: 10000 }],
      });
      expect(ledger.listHoldingRecords("hh")[0]).not.toHaveProperty("revisions");
      raw = new DatabaseSync(dbPath);
      const columns = (table: string) => raw!.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
      expect(columns("investment_holdings")).toContain("revisions_json");
      expect(columns("holding_valuation_snapshots")).toContain("correction_json");
      expect(columns("property_valuation_snapshots")).toContain("correction_json");
      expect(columns("import_review_items")).toContain("source_evidence_json");
      expect(columns("import_jobs")).toEqual(["id", "household_id", "source_type", "source_name",
        "started_at_iso", "finished_at_iso", "adapter_id", "candidate_count", "validation_failure_count", "provenance_json"]);
      const schema = raw.prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name").all();
      raw.close();
      raw = undefined;
      ledger.close();
      ledger = createLocalLedgerDatabase({ dbPath });
      raw = new DatabaseSync(dbPath);
      expect(raw.prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name").all()).toEqual(schema);
      expect(raw.prepare("SELECT booked_at_iso, booked_at_millis, amount_minor FROM transactions WHERE id = 'tx'").get())
        .toMatchObject({ booked_at_iso: "2026-05-01", booked_at_millis: 1777593600000, amount_minor: -2500 });
      expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(raw.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
    } finally {
      raw?.close();
      ledger?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
