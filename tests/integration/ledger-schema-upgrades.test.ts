import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import type { CategorizationDecision } from "../../src/domain/types.js";

describe("ledger schema extraction compatibility", () => {
  it("adds archive lifecycle state to existing accounts without changing their identity", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-account-archive-schema-"));
    const dbPath = join(directory, "ledger.sqlite");
    let ledger: ReturnType<typeof createLocalLedgerDatabase> | undefined;
    let raw: DatabaseSync | undefined;
    try {
      ledger = createLocalLedgerDatabase({ dbPath, seedData: {
        household: { id: "hh", name: "Synthetic", createdAtIso: "2026-01-01T00:00:00Z" },
        accounts: [{ id: "acc", householdId: "hh", name: "Current", currencyCode: "NOK" }],
        transactions: [], importJobs: [], monthlyCategoryTargets: [],
      } });
      ledger.close();
      ledger = undefined;

      raw = new DatabaseSync(dbPath);
      const accountColumns = raw.prepare("PRAGMA table_info(accounts)")
        .all() as Array<{ name: string }>;
      if (accountColumns.some((column) => column.name === "archived_at_iso")) {
        raw.exec("ALTER TABLE accounts DROP COLUMN archived_at_iso");
      }
      raw.close();
      raw = undefined;

      ledger = createLocalLedgerDatabase({ dbPath });
      expect(ledger.loadLedgerSnapshotData().accounts).toEqual([
        { id: "acc", householdId: "hh", name: "Current", currencyCode: "NOK" },
      ]);
      raw = new DatabaseSync(dbPath);
      expect((raw.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>)
        .map((column) => column.name)).toContain("archived_at_iso");
      expect(raw.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
    } finally {
      raw?.close();
      ledger?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("upgrades populated reconciliation, correction, undo and backup history without losing recovery data", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recovery-schema-"));
    const dbPath = join(directory, "ledger.sqlite");
    let ledger: ReturnType<typeof createLocalLedgerDatabase> | undefined;
    let raw: DatabaseSync | undefined;
    try {
      ledger = createLocalLedgerDatabase({ dbPath, seedData: {
        household: { id: "hh", name: "Synthetic", createdAtIso: "2026-01-01T00:00:00Z" },
        accounts: [{ id: "acc", householdId: "hh", name: "Current", currencyCode: "NOK" }],
        transactions: [], importJobs: [], monthlyCategoryTargets: [],
      } });
      ledger.appendImportJobAndTransactions({
        id: "job", householdId: "hh", sourceType: "csv", sourceName: "synthetic.csv",
        startedAtIso: "2026-05-01T00:00:00Z",
      }, [{
        id: "tx", householdId: "hh", accountId: "acc", amountMinor: -2500,
        bookedAtIso: "2026-05-01", merchantRaw: "KIWI", categoryId: "groceries", importJobId: "job",
      }]);
      ledger.close();
      ledger = undefined;
      raw = new DatabaseSync(dbPath);
      raw.exec(`
        INSERT INTO pending_transaction_observations (
          id, household_id, account_id, transaction_date_iso, amount_minor, merchant_raw,
          source_row_index, source_type, status, source_status
        ) VALUES ('pending', 'hh', 'acc', '2026-05-02', -1800, 'Ruter', 2, 'csv', 'reserved', 'Reservert');
        INSERT INTO merchant_correction_provenance (
          id, source_transaction_id, merchant_alias, category_id, corrected_at_iso
        ) VALUES ('correction', 'tx', 'kiwi', 'groceries', '2026-05-01T12:00:00Z');
        INSERT INTO same_merchant_propagation_operations (
          id, source_transaction_id, merchant_alias, category_id, applied_at_iso
        ) VALUES ('propagation', 'tx', 'kiwi', 'groceries', '2026-05-01T12:00:00Z');
        INSERT INTO same_merchant_propagation_changes (
          operation_id, transaction_id, before_category_id, after_category_id
        ) VALUES ('propagation', 'tx', NULL, 'groceries');
        INSERT INTO backup_snapshots (
          snapshot_path, kind, version, household_name, created_at_iso, saved_at_iso,
          account_count, transaction_count, content_hash_sha256
        ) VALUES ('synthetic-backup.json', 'backup', '3', 'Synthetic', '2026-05-01T00:00:00Z',
          '2026-05-01T00:00:00Z', 1, 1, '0000000000000000000000000000000000000000000000000000000000000000');
      `);
      const categorization: CategorizationDecision = {
        status: "categorized", categoryId: "groceries", confidence: 0.95,
        confidenceLevel: "high", requiresReview: false, matchingRules: [],
      };
      raw.prepare("UPDATE transactions SET categorization_json = ? WHERE id = 'tx'")
        .run(JSON.stringify(categorization));
      raw.exec(`
        ALTER TABLE pending_transaction_observations DROP COLUMN reconciled_transaction_id;
        ALTER TABLE pending_transaction_observations DROP COLUMN reconciled_at_iso;
        ALTER TABLE merchant_correction_provenance DROP COLUMN actor;
        ALTER TABLE merchant_correction_provenance DROP COLUMN original_categorization_json;
        ALTER TABLE same_merchant_propagation_changes DROP COLUMN before_categorization_json;
        ALTER TABLE same_merchant_propagation_changes DROP COLUMN after_categorization_json;
        ALTER TABLE import_job_operations DROP COLUMN undo_available;
        ALTER TABLE backup_snapshots DROP COLUMN version;
      `);
      raw.close();
      raw = undefined;
      for (let reopen = 0; reopen < 2; reopen += 1) {
        ledger = createLocalLedgerDatabase({ dbPath });
        expect(ledger.listPendingTransactionObservations("hh")).toMatchObject([{
          id: "pending", amountMinor: -1800, status: "reserved",
        }]);
        expect(ledger.listMerchantCorrectionProvenance()).toEqual([{
          id: "correction", sourceTransactionId: "tx", merchantAlias: "kiwi",
          categoryId: "groceries", actor: "local-user", correctedAtIso: "2026-05-01T12:00:00Z",
        }]);
        expect(ledger.listSameMerchantPropagationOperations()).toMatchObject([{
          id: "propagation", changes: [{
            transactionId: "tx", beforeCategoryId: null, afterCategoryId: "groceries",
            beforeCategorization: categorization, afterCategorization: categorization,
          }],
        }]);
        expect(ledger.listImportJobHistory("hh")).toMatchObject([{
          id: "job", importedCount: 1, undoAvailable: true,
        }]);
        expect(ledger.listBackupSnapshots()).toMatchObject([{
          snapshotPath: "synthetic-backup.json", version: "3", transactionCount: 1,
        }]);
        expect(ledger.loadLedgerSnapshotData().transactions).toMatchObject([{
          id: "tx", amountMinor: -2500, categoryId: "groceries", categorization,
        }]);
        ledger.close();
        ledger = undefined;
      }
      ledger = createLocalLedgerDatabase({ dbPath });
      expect(ledger.undoSameMerchantPropagation("propagation")).toBe(true);
      ledger.close();
      ledger = createLocalLedgerDatabase({ dbPath });
      expect(ledger.loadLedgerSnapshotData().transactions).toMatchObject([{
        id: "tx", amountMinor: -2500, categorization,
      }]);
      expect(ledger.loadLedgerSnapshotData().transactions[0]).not.toHaveProperty("categoryId");
      raw = new DatabaseSync(dbPath);
      expect(raw.prepare("SELECT reconciled_transaction_id, reconciled_at_iso FROM pending_transaction_observations").get())
        .toEqual({ reconciled_transaction_id: null, reconciled_at_iso: null });
      expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(raw.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
    } finally {
      raw?.close();
      ledger?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
