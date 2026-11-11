import { createTransactionRepository } from "./transactionRepository.js";
import { createImportHistoryRepository } from "./importHistoryRepository.js";
import { createImportLedgerRepository } from "./importLedgerRepository.js";
import { createImportReviewRepository } from "./importReviewRepository.js";
import { createCorrectionRepository } from "./correctionRepository.js";
import { createRegistryRepository } from "./registryRepository.js";
import { createAccountCoverageRepository } from "./accountCoverageRepository.js";
import { createExchangeRateRepository } from "./exchangeRateRepository.js";
import { createRecurringCommitmentRepository } from "./recurringCommitmentRepository.js";
import { createReportingPreferencesRepository } from "./reportingPreferencesRepository.js";
import { ensureSchema } from "./ledgerSchema.js";
import { insertLedgerSnapshot, loadLedgerSnapshotData as readLedgerSnapshot } from "./ledgerSnapshot.js";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeHouseholdSetupInput } from "../onboarding/householdSetup.js";
import type { BackupSnapshotCatalogEntry, LedgerSnapshotData } from "../../domain/backup/snapshotContract.js";
import type { CsvImportProfile } from "../../domain/import/csvImportProfile.js";
import { type SavedLedgerView } from "../../domain/ledger/filterTransactions.js";
import type {
  Account,
  Household,
  MonthlyCategoryTarget,
} from "../../domain/types.js";
import type { LocalLedgerDatabase, LocalLedgerRuntimeMetadata } from "./localLedgerContracts.js";
export type { LocalLedgerDatabase, LocalLedgerRuntimeMetadata } from "./localLedgerContracts.js";

type LocalLedgerSeedData = Omit<LedgerSnapshotData, "createdAtIso">;

interface CreateLocalLedgerDatabaseOptions {
  dbPath?: string;
  seedData?: LocalLedgerSeedData;
}

function defaultLocalDatabasePath(): string {
  return process.env.BUDGET_DB_PATH ?? join(process.cwd(), "data", "local", "budget.sqlite");
}

function seedIfEmpty(db: DatabaseSync, seedData: LocalLedgerSeedData): void {
  const existingCount = db
    .prepare("SELECT COUNT(*) AS count FROM households")
    .get() as { count: number };

  if (existingCount.count > 0) {
    return;
  }

  db.exec("BEGIN");

  try {
    insertLedgerSnapshot(db, seedData);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function hasHousehold(db: DatabaseSync): boolean {
  return db.prepare("SELECT id FROM households LIMIT 1").get() !== undefined;
}

function createInitialHouseholdAndAccount(
  db: DatabaseSync,
  input: { householdName: string; accountName: string; currencyCode: string }
): { household: Household; account: Account } {
  const { householdName, accountName, currencyCode } = normalizeHouseholdSetupInput(input);

  const household: Household = {
    id: randomUUID(),
    name: householdName,
    createdAtIso: new Date().toISOString(),
  };
  const account: Account = {
    id: randomUUID(),
    householdId: household.id,
    name: accountName,
    currencyCode,
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    if (hasHousehold(db)) {
      throw new Error("A household has already been set up.");
    }
    db.prepare("INSERT INTO households (id, name, created_at_iso) VALUES (?, ?, ?)")
      .run(household.id, household.name, household.createdAtIso);
    db.prepare("INSERT INTO accounts (id, household_id, name, currency_code) VALUES (?, ?, ?, ?)")
      .run(account.id, account.householdId, account.name, account.currencyCode);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { household, account };
}

export function createLocalLedgerDatabase(
  options: CreateLocalLedgerDatabaseOptions
): LocalLedgerDatabase {
  const dbPath = options.dbPath ?? defaultLocalDatabasePath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  try {
    ensureSchema(db);
    if (options.seedData !== undefined) seedIfEmpty(db, options.seedData);
  } catch (error) {
    db.close();
    throw error;
  }

  const {
    listMonthlyTotals,
    getTransactionsForMonth,
    getTransactionsForDateRange,
    getTransactionsForAccount,
    listPendingTransactionObservations,
    getTransactionById,
    updateTransactionCategoryAllocations,
    queryTransactions,
    getFilteredTransactions,
    listUncategorizedTransactions,
    getAccountsForHousehold,
    getTransactionsForImportJob,
    getImportedTransactionsForSource,
  } = createTransactionRepository(db, { loadLedgerSnapshotData });
  const {
    backfillImportJobHistory,
    listImportJobHistory,
    undoImportJob,
  } = createImportHistoryRepository(db);
  const {
    appendImportJob,
    hasImportJob,
    appendTransactions,
    appendImportJobAndTransactions,
    appendManualEntry,
  } = createImportLedgerRepository(db);
  const {
    listImportReviewItems,
    completeImportReviewCorrection,
    completeImportReviewDismissal,
  } = createImportReviewRepository(db, { getTransactionById });
  const {
    updateTransactionCategory,
    updateTransactionCategoryAndRule,
    listMerchantCorrectionProvenance,
    applySameMerchantPropagation,
    listSameMerchantPropagationOperations,
    undoSameMerchantPropagation,
    listMerchantCategoryRules,
    upsertMerchantCategoryRule,
  } = createCorrectionRepository(db);

  const {
    createPropertyRecord,
    updatePropertyRecordLabel,
    updatePropertyOwnershipShare,
    listPropertyRecords,
    appendPropertyValuationSnapshot,
    listPropertyValuationSnapshots,
    createHoldingRecord,
    listHoldingRecords,
    correctHoldingRecord,
    appendHoldingValuationSnapshot,
    listHoldingValuationSnapshots,
    createLoanRecord,
    updateLoanResponsibilityShare,
    listLoanRecords,
    appendLoanBalanceSnapshot,
    listLoanBalanceSnapshots,
  } = createRegistryRepository(db);
  const {
    saveAccountStatementCoveragePeriod,
    appendAccountBalanceCheckpoint,
    listAccountStatementCoveragePeriods,
    listAccountBalanceCheckpoints,
  } = createAccountCoverageRepository(db);
  const {
    upsertExchangeRate,
    upsertExchangeRates,
    listExchangeRates,
  } = createExchangeRateRepository(db);
  const {
    createRecurringCommitment,
    updateRecurringCommitment,
    updateRecurringCommitmentAndDecision,
    listRecurringCommitments,
    createRecurringCommitmentPaymentLink,
    listRecurringCommitmentPaymentLinks,
    createRecurringCommitmentDecision,
    listRecurringCommitmentDecisions,
  } = createRecurringCommitmentRepository(db, { getTransactionById, getAccountsForHousehold });
  const { getReportingPeriodRule, saveReportingPeriodRule } =
    createReportingPreferencesRepository(db);

  function loadRuntimeMetadata(): LocalLedgerRuntimeMetadata | null {
    const householdRow = db
      .prepare("SELECT id, name, created_at_iso FROM households ORDER BY id LIMIT 1")
      .get() as { id: string; name: string; created_at_iso: string } | undefined;
    if (householdRow === undefined) return null;

    const targets = db.prepare(`
      SELECT year_month, category_id, target_minor
      FROM monthly_category_targets
      ORDER BY year_month, category_id
    `).all() as Array<{ year_month: string; category_id: string; target_minor: number }>;

    return {
      household: {
        id: householdRow.id,
        name: householdRow.name,
        createdAtIso: householdRow.created_at_iso,
      },
      accounts: getAccountsForHousehold(householdRow.id),
      monthlyCategoryTargets: targets.map((target) => ({
        yearMonth: target.year_month,
        categoryId: target.category_id,
        targetMinor: target.target_minor,
      })),
      merchantCategoryRules: listMerchantCategoryRules(),
    };
  }

  backfillImportJobHistory();

  function loadLedgerSnapshotData(): LedgerSnapshotData {
    return readLedgerSnapshot(db, {
      listExchangeRates,
      listHoldingRecords,
      listLoanRecords,
      getReportingPeriodRule,
    });
  }

  function replaceLedgerSnapshotData(snapshot: LedgerSnapshotData): void {
    db.exec("BEGIN");
    try {
      db.exec(`
        DELETE FROM household_preferences;
        DELETE FROM import_job_transaction_baselines;
        DELETE FROM import_job_operations;
        DELETE FROM same_merchant_propagation_changes;
        DELETE FROM same_merchant_propagation_operations;
        DELETE FROM merchant_correction_provenance;
        DELETE FROM recurring_commitment_payment_links;
        DELETE FROM recurring_commitment_decisions;
        DELETE FROM recurring_commitments;
        DELETE FROM exchange_rates;
        DELETE FROM account_balance_checkpoints;
        DELETE FROM account_statement_coverage_periods;
        DELETE FROM monthly_category_targets;
        DELETE FROM pending_transaction_observations;
        DELETE FROM transactions;
        DELETE FROM import_jobs;
        DELETE FROM merchant_category_rules;
        DELETE FROM loan_balance_snapshots;
        DELETE FROM loan_records;
        DELETE FROM holding_valuation_snapshots;
        DELETE FROM investment_holdings;
        DELETE FROM property_valuation_snapshots;
        DELETE FROM properties;
        DELETE FROM accounts;
        DELETE FROM households;
      `);
      insertLedgerSnapshot(db, snapshot);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function upsertMonthlyCategoryTarget(target: MonthlyCategoryTarget): void {
    db.prepare(
      "INSERT INTO monthly_category_targets (year_month, category_id, target_minor) VALUES (?, ?, ?) ON CONFLICT(year_month, category_id) DO UPDATE SET target_minor = excluded.target_minor"
    ).run(target.yearMonth, target.categoryId, target.targetMinor);
  }

  function saveLedgerView(savedLedgerView: SavedLedgerView): void {
    db.prepare(
      "INSERT INTO saved_ledger_views (id, name, filters_json) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET id = excluded.id, filters_json = excluded.filters_json"
    ).run(savedLedgerView.id, savedLedgerView.name, JSON.stringify(savedLedgerView.filters));
  }

  function listSavedLedgerViews(): SavedLedgerView[] {
    return db
      .prepare("SELECT id, name, filters_json FROM saved_ledger_views ORDER BY name COLLATE NOCASE")
      .all()
      .map((row) => {
        const savedView = row as { id: string; name: string; filters_json: string };
        return {
          id: savedView.id,
          name: savedView.name,
          filters: JSON.parse(savedView.filters_json) as SavedLedgerView["filters"],
        };
      });
  }

  function deleteSavedLedgerView(viewId: string): boolean {
    const result = db
      .prepare("DELETE FROM saved_ledger_views WHERE id = ?")
      .run(viewId) as { changes: number | bigint };
    return Number(result.changes) > 0;
  }

  function saveBackupSnapshot(entry: BackupSnapshotCatalogEntry): void {
    db.prepare(`
      INSERT INTO backup_snapshots (
        snapshot_path, kind, version, household_name, created_at_iso, saved_at_iso,
        account_count, transaction_count, content_hash_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_path) DO UPDATE SET
        kind = excluded.kind,
        version = excluded.version,
        household_name = excluded.household_name,
        created_at_iso = excluded.created_at_iso,
        saved_at_iso = excluded.saved_at_iso,
        account_count = excluded.account_count,
        transaction_count = excluded.transaction_count,
        content_hash_sha256 = excluded.content_hash_sha256
    `).run(
      entry.snapshotPath,
      entry.kind,
      entry.version,
      entry.householdName,
      entry.createdAtIso,
      entry.savedAtIso,
      entry.accountCount,
      entry.transactionCount,
      entry.contentHashSha256
    );
  }

  function listBackupSnapshots(): BackupSnapshotCatalogEntry[] {
    return db.prepare(`
      SELECT snapshot_path, kind, version, household_name, created_at_iso, saved_at_iso,
        account_count, transaction_count, content_hash_sha256
      FROM backup_snapshots
      ORDER BY saved_at_iso DESC, snapshot_path ASC
    `).all().map((row) => {
      const snapshot = row as {
        snapshot_path: string;
        kind: BackupSnapshotCatalogEntry["kind"];
        version: BackupSnapshotCatalogEntry["version"];
        household_name: string;
        created_at_iso: string;
        saved_at_iso: string;
        account_count: number;
        transaction_count: number;
        content_hash_sha256: string;
      };
      return {
        snapshotPath: snapshot.snapshot_path,
        kind: snapshot.kind,
        version: snapshot.version,
        householdName: snapshot.household_name,
        createdAtIso: snapshot.created_at_iso,
        savedAtIso: snapshot.saved_at_iso,
        accountCount: snapshot.account_count,
        transactionCount: snapshot.transaction_count,
        contentHashSha256: snapshot.content_hash_sha256,
      };
    });
  }

  function deleteBackupSnapshot(snapshotPath: string): boolean {
    const result = db.prepare(
      "DELETE FROM backup_snapshots WHERE snapshot_path = ?"
    ).run(snapshotPath) as { changes: number | bigint };
    return Number(result.changes) > 0;
  }

  function saveCsvImportProfile(profile: CsvImportProfile): void {
    const accountExists = db.prepare(
      "SELECT 1 FROM accounts WHERE id = ? AND household_id = ?"
    ).get(profile.accountId, profile.householdId);
    if (accountExists === undefined) {
      throw new Error("CSV import profile account must belong to its household.");
    }

    db.prepare(`
      INSERT INTO csv_import_profiles (
        id, household_id, name, account_id, column_mapping_json, created_at_iso, updated_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        household_id = excluded.household_id,
        name = excluded.name,
        account_id = excluded.account_id,
        column_mapping_json = excluded.column_mapping_json,
        updated_at_iso = excluded.updated_at_iso
    `).run(
      profile.id,
      profile.householdId,
      profile.name,
      profile.accountId,
      JSON.stringify(profile.columnMapping),
      profile.createdAtIso,
      profile.updatedAtIso
    );
  }

  function listCsvImportProfiles(householdId: string): CsvImportProfile[] {
    return db.prepare(`
      SELECT id, household_id, name, account_id, column_mapping_json, created_at_iso, updated_at_iso
      FROM csv_import_profiles
      WHERE household_id = ?
      ORDER BY name COLLATE NOCASE
    `).all(householdId).map((row) => {
      const profile = row as {
        id: string;
        household_id: string;
        name: string;
        account_id: string;
        column_mapping_json: string;
        created_at_iso: string;
        updated_at_iso: string;
      };
      return {
        id: profile.id,
        householdId: profile.household_id,
        name: profile.name,
        accountId: profile.account_id,
        columnMapping: JSON.parse(profile.column_mapping_json) as CsvImportProfile["columnMapping"],
        createdAtIso: profile.created_at_iso,
        updatedAtIso: profile.updated_at_iso,
      };
    });
  }

  function deleteCsvImportProfile(householdId: string, profileId: string): boolean {
    const result = db.prepare(
      "DELETE FROM csv_import_profiles WHERE household_id = ? AND id = ?"
    ).run(householdId, profileId) as { changes: number | bigint };
    return Number(result.changes) > 0;
  }

  return {
    hasHousehold: () => hasHousehold(db),
    createInitialHouseholdAndAccount: (input) => createInitialHouseholdAndAccount(db, input),
    getReportingPeriodRule,
    saveReportingPeriodRule,
    loadRuntimeMetadata,
    listMonthlyTotals,
    getTransactionsForMonth,
    getTransactionsForDateRange,
    getTransactionsForAccount,
    listPendingTransactionObservations,
    getTransactionById,
    updateTransactionCategoryAllocations,
    saveAccountStatementCoveragePeriod,
    appendAccountBalanceCheckpoint,
    listAccountStatementCoveragePeriods,
    listAccountBalanceCheckpoints,
    upsertExchangeRate,
    upsertExchangeRates,
    listExchangeRates,
    createPropertyRecord,
    updatePropertyRecordLabel,
    updatePropertyOwnershipShare,
    listPropertyRecords,
    appendPropertyValuationSnapshot,
    listPropertyValuationSnapshots,
    createHoldingRecord,
    listHoldingRecords,
    correctHoldingRecord,
    appendHoldingValuationSnapshot,
    listHoldingValuationSnapshots,
    createLoanRecord,
    updateLoanResponsibilityShare,
    listLoanRecords,
    appendLoanBalanceSnapshot,
    listLoanBalanceSnapshots,
    createRecurringCommitment,
    updateRecurringCommitment,
    updateRecurringCommitmentAndDecision,
    listRecurringCommitments,
    createRecurringCommitmentPaymentLink,
    listRecurringCommitmentPaymentLinks,
    createRecurringCommitmentDecision,
    listRecurringCommitmentDecisions,
    loadLedgerSnapshotData,
    replaceLedgerSnapshotData,
    queryTransactions,
    getFilteredTransactions,
    listUncategorizedTransactions,
    saveLedgerView,
    listSavedLedgerViews,
    deleteSavedLedgerView,
    saveBackupSnapshot,
    listBackupSnapshots,
    deleteBackupSnapshot,
    saveCsvImportProfile,
    listCsvImportProfiles,
    deleteCsvImportProfile,
    listImportJobHistory,
    undoImportJob,
    getAccountsForHousehold,
    upsertMonthlyCategoryTarget,
    appendImportJob,
    hasImportJob,
    getTransactionsForImportJob,
    getImportedTransactionsForSource,
    listImportReviewItems,
    completeImportReviewCorrection,
    completeImportReviewDismissal,
    appendImportJobAndTransactions,
    appendTransactions,
    updateTransactionCategory,
    updateTransactionCategoryAndRule,
    listMerchantCorrectionProvenance,
    applySameMerchantPropagation,
    listSameMerchantPropagationOperations,
    undoSameMerchantPropagation,
    listMerchantCategoryRules,
    upsertMerchantCategoryRule,
    appendManualEntry,
    close: () => db.close(),
  };
}