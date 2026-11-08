import { DatabaseSync } from "node:sqlite";
import { transactionBookingTimeMillis } from "../../domain/ledger/filterTransactions.js";

export function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at_iso TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      currency_code TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      booked_at_iso TEXT NOT NULL,
      booked_at_millis INTEGER,
      amount_minor INTEGER NOT NULL,
      merchant_raw TEXT NOT NULL,
      merchant_search TEXT NOT NULL DEFAULT '',
      currency_code TEXT,
      source_type TEXT,
      source_reference TEXT,
      category_id TEXT,
      import_job_id TEXT,
      categorization_json TEXT,
      category_allocations_json TEXT
    );

    CREATE INDEX IF NOT EXISTS transactions_by_household_booked_at
      ON transactions (household_id, booked_at_iso);

    CREATE TABLE IF NOT EXISTS pending_transaction_observations (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      transaction_date_iso TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      merchant_raw TEXT NOT NULL,
      source_row_index INTEGER NOT NULL,
      currency_code TEXT,
      source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'pdf')),
      source_reference TEXT,
      import_job_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('reserved', 'confirmed')),
      source_status TEXT NOT NULL CHECK (source_status IN ('Reservert', 'Bekreftet')),
      reconciled_transaction_id TEXT,
      reconciled_at_iso TEXT
    );

    CREATE INDEX IF NOT EXISTS pending_observations_by_household_date
      ON pending_transaction_observations (household_id, transaction_date_iso, id);
    CREATE INDEX IF NOT EXISTS pending_observations_by_account_reference
      ON pending_transaction_observations (account_id, source_reference);

    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL,
      adapter_id TEXT,
      candidate_count INTEGER,
      validation_failure_count INTEGER,
      started_at_iso TEXT NOT NULL,
      finished_at_iso TEXT,
      provenance_json TEXT
    );

    CREATE TABLE IF NOT EXISTS import_review_items (
      id TEXT PRIMARY KEY,
      import_job_id TEXT NOT NULL,
      household_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'pdf')),
      source_name TEXT NOT NULL,
      source_identity TEXT NOT NULL,
      source_row_index INTEGER NOT NULL,
      source_evidence_json TEXT,
      raw_row TEXT NOT NULL,
      parser_errors_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('unresolved', 'corrected', 'dismissed')),
      created_at_iso TEXT NOT NULL,
      updated_at_iso TEXT NOT NULL,
      corrected_at_iso TEXT,
      corrected_transaction_id TEXT,
      correction_json TEXT,
      dismissal_reason TEXT,
      dismissed_at_iso TEXT
    );

    CREATE INDEX IF NOT EXISTS import_review_items_by_household_status
      ON import_review_items (household_id, status, created_at_iso);

    CREATE TABLE IF NOT EXISTS monthly_category_targets (
      year_month TEXT NOT NULL,
      category_id TEXT NOT NULL,
      target_minor INTEGER NOT NULL,
      PRIMARY KEY (year_month, category_id)
    );

    CREATE TABLE IF NOT EXISTS account_statement_coverage_periods (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      start_date_iso TEXT NOT NULL,
      end_date_iso TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'csv', 'pdf')),
      import_job_id TEXT,
      imported_at_iso TEXT,
      confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
      confirmed_at_iso TEXT
    );

    CREATE INDEX IF NOT EXISTS account_coverage_by_account_period
      ON account_statement_coverage_periods (account_id, start_date_iso, end_date_iso, id);

    CREATE TABLE IF NOT EXISTS account_balance_checkpoints (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      date_iso TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance_minor INTEGER NOT NULL,
      source TEXT NOT NULL,
      source_reference TEXT,
      recorded_at_iso TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS account_checkpoints_by_account_date
      ON account_balance_checkpoints (account_id, date_iso, recorded_at_iso, id);

    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at_iso TEXT NOT NULL,
      ownership_share_basis_points INTEGER NOT NULL DEFAULT 10000
        CHECK (typeof(ownership_share_basis_points) = 'integer' AND ownership_share_basis_points BETWEEN 0 AND 10000)
    );

    CREATE INDEX IF NOT EXISTS properties_by_household_label
      ON properties (household_id, label COLLATE NOCASE, id);

    CREATE TABLE IF NOT EXISTS property_valuation_snapshots (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL,
      effective_date_iso TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      currency_code TEXT NOT NULL,
      recorded_at_iso TEXT NOT NULL,
      correction_json TEXT
    );

    CREATE INDEX IF NOT EXISTS property_valuations_by_property_date
      ON property_valuation_snapshots (property_id, effective_date_iso, recorded_at_iso, id);

    CREATE TABLE IF NOT EXISTS investment_holdings (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      label TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      cost_basis_minor INTEGER NOT NULL CHECK (cost_basis_minor >= 0),
      currency_code TEXT NOT NULL,
      created_at_iso TEXT NOT NULL,
      revisions_json TEXT
    );

    CREATE INDEX IF NOT EXISTS holdings_by_household_label
      ON investment_holdings (household_id, label COLLATE NOCASE, id);

    CREATE TABLE IF NOT EXISTS holding_valuation_snapshots (
      id TEXT PRIMARY KEY,
      holding_id TEXT NOT NULL,
      effective_date_iso TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      currency_code TEXT NOT NULL,
      recorded_at_iso TEXT NOT NULL,
      correction_json TEXT
    );

    CREATE INDEX IF NOT EXISTS holding_valuations_by_holding_date
      ON holding_valuation_snapshots (holding_id, effective_date_iso, recorded_at_iso, id);

    CREATE TABLE IF NOT EXISTS loan_records (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      label TEXT NOT NULL,
      principal_minor INTEGER NOT NULL CHECK (principal_minor > 0),
      annual_interest_rate_basis_points INTEGER NOT NULL
        CHECK (annual_interest_rate_basis_points BETWEEN 0 AND 10000),
      term_months INTEGER NOT NULL CHECK (term_months > 0),
      payment_amount_minor INTEGER NOT NULL CHECK (payment_amount_minor > 0),
      payment_frequency TEXT NOT NULL
        CHECK (payment_frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
      currency_code TEXT NOT NULL,
      property_id TEXT,
      created_at_iso TEXT NOT NULL,
      responsibility_share_basis_points INTEGER NOT NULL DEFAULT 10000
        CHECK (typeof(responsibility_share_basis_points) = 'integer' AND responsibility_share_basis_points BETWEEN 0 AND 10000)
    );

    CREATE INDEX IF NOT EXISTS loans_by_household_label
      ON loan_records (household_id, label COLLATE NOCASE, id);

    CREATE TABLE IF NOT EXISTS loan_balance_snapshots (
      id TEXT PRIMARY KEY,
      loan_id TEXT NOT NULL,
      effective_date_iso TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      currency_code TEXT NOT NULL,
      recorded_at_iso TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS loan_balances_by_loan_date
      ON loan_balance_snapshots (loan_id, effective_date_iso, recorded_at_iso, id);

    CREATE TABLE IF NOT EXISTS recurring_commitments (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      description TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount_minor INTEGER CHECK (amount_minor IS NULL OR (typeof(amount_minor) = 'integer' AND amount_minor > 0)),
      is_variable INTEGER NOT NULL CHECK (is_variable IN (0, 1)),
      cadence TEXT NOT NULL CHECK (cadence IN ('monthly', 'annual')),
      first_due_date_iso TEXT NOT NULL,
      active_from_iso TEXT NOT NULL,
      active_until_iso TEXT,
      status TEXT NOT NULL CHECK (status IN ('suggested', 'active', 'paused', 'ended')),
      created_at_iso TEXT NOT NULL,
      updated_at_iso TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS recurring_commitments_by_household_status
      ON recurring_commitments (household_id, status, first_due_date_iso, id);

    CREATE TABLE IF NOT EXISTS recurring_commitment_payment_links (
      id TEXT PRIMARY KEY,
      commitment_id TEXT NOT NULL,
      occurrence_date_iso TEXT NOT NULL,
      transaction_id TEXT,
      pending_observation_id TEXT,
      linked_at_iso TEXT NOT NULL,
      CHECK (
        (transaction_id IS NOT NULL AND pending_observation_id IS NULL) OR
        (transaction_id IS NULL AND pending_observation_id IS NOT NULL)
      ),
      UNIQUE (commitment_id, occurrence_date_iso)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS recurring_payment_links_by_transaction
      ON recurring_commitment_payment_links (transaction_id)
      WHERE transaction_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS recurring_payment_links_by_pending
      ON recurring_commitment_payment_links (pending_observation_id)
      WHERE pending_observation_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS recurring_commitment_decisions (
      id TEXT PRIMARY KEY,
      commitment_id TEXT NOT NULL,
      decision_type TEXT NOT NULL CHECK (
        decision_type IN ('edited', 'confirmed', 'paused', 'resumed', 'ended', 'amount-change-confirmed')
      ),
      decided_at_iso TEXT NOT NULL,
      previous_amount_minor INTEGER,
      new_amount_minor INTEGER
    );

    CREATE INDEX IF NOT EXISTS recurring_commitment_decisions_by_commitment
      ON recurring_commitment_decisions (commitment_id, decided_at_iso, id);

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY,
      currency_code TEXT NOT NULL,
      rate_nok_per_unit TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('dated', 'monthly-reference')),
      source TEXT NOT NULL,
      provenance TEXT NOT NULL CHECK (provenance IN ('manual', 'local-file')),
      UNIQUE (currency_code, effective_date, kind)
    );

    CREATE TABLE IF NOT EXISTS merchant_category_rules (
      merchant_alias TEXT PRIMARY KEY,
      category_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS merchant_correction_provenance (
      id TEXT PRIMARY KEY,
      source_transaction_id TEXT NOT NULL,
      merchant_alias TEXT NOT NULL,
      category_id TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'local-user',
      corrected_at_iso TEXT NOT NULL,
      original_categorization_json TEXT
    );

    CREATE TABLE IF NOT EXISTS same_merchant_propagation_operations (
      id TEXT PRIMARY KEY,
      source_transaction_id TEXT NOT NULL,
      merchant_alias TEXT NOT NULL,
      category_id TEXT NOT NULL,
      applied_at_iso TEXT NOT NULL,
      undone_at_iso TEXT
    );

    CREATE TABLE IF NOT EXISTS same_merchant_propagation_changes (
      operation_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      before_category_id TEXT,
      after_category_id TEXT NOT NULL,
      before_categorization_json TEXT,
      after_categorization_json TEXT,
      PRIMARY KEY (operation_id, transaction_id)
    );

    CREATE TABLE IF NOT EXISTS saved_ledger_views (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      filters_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_snapshots (
      snapshot_path TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('backup', 'pre-restore')),
      version TEXT NOT NULL,
      household_name TEXT NOT NULL,
      created_at_iso TEXT NOT NULL,
      saved_at_iso TEXT NOT NULL,
      account_count INTEGER NOT NULL,
      transaction_count INTEGER NOT NULL,
      content_hash_sha256 TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS csv_import_profiles (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      account_id TEXT NOT NULL,
      column_mapping_json TEXT NOT NULL,
      created_at_iso TEXT NOT NULL,
      updated_at_iso TEXT NOT NULL,
      UNIQUE (household_id, name COLLATE NOCASE)
    );

    CREATE TABLE IF NOT EXISTS import_job_operations (
      import_job_id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      account_id TEXT,
      candidate_count INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      undone_at_iso TEXT,
      undo_removed_count INTEGER NOT NULL DEFAULT 0,
      undo_retained_count INTEGER NOT NULL DEFAULT 0,
      undo_available INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS import_job_transaction_baselines (
      import_job_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      baseline_json TEXT NOT NULL,
      PRIMARY KEY (import_job_id, transaction_id)
    );
  `);

  const propertyColumns = db.prepare("PRAGMA table_info(properties)").all() as Array<{ name: string }>;
  if (!propertyColumns.some((column) => column.name === "ownership_share_basis_points")) {
    db.exec(`ALTER TABLE properties ADD COLUMN ownership_share_basis_points INTEGER NOT NULL DEFAULT 10000
      CHECK (typeof(ownership_share_basis_points) = 'integer' AND ownership_share_basis_points BETWEEN 0 AND 10000)`);
  }
  const loanColumns = db.prepare("PRAGMA table_info(loan_records)").all() as Array<{ name: string }>;
  if (!loanColumns.some((column) => column.name === "responsibility_share_basis_points")) {
    db.exec(`ALTER TABLE loan_records ADD COLUMN responsibility_share_basis_points INTEGER NOT NULL DEFAULT 10000
      CHECK (typeof(responsibility_share_basis_points) = 'integer' AND responsibility_share_basis_points BETWEEN 0 AND 10000)`);
  }

  const propertyValuationColumns = db
    .prepare("PRAGMA table_info(property_valuation_snapshots)")
    .all() as Array<{ name: string }>;
  if (!propertyValuationColumns.some((column) => column.name === "correction_json")) {
    db.exec("ALTER TABLE property_valuation_snapshots ADD COLUMN correction_json TEXT");
  }
  const holdingColumns = db.prepare("PRAGMA table_info(investment_holdings)").all() as Array<{ name: string }>;
  if (!holdingColumns.some((column) => column.name === "revisions_json")) {
    db.exec("ALTER TABLE investment_holdings ADD COLUMN revisions_json TEXT");
  }
  const holdingValuationColumns = db.prepare("PRAGMA table_info(holding_valuation_snapshots)").all() as Array<{ name: string }>;
  if (!holdingValuationColumns.some((column) => column.name === "correction_json")) {
    db.exec("ALTER TABLE holding_valuation_snapshots ADD COLUMN correction_json TEXT");
  }

  const pendingObservationColumns = db
    .prepare("PRAGMA table_info(pending_transaction_observations)")
    .all() as Array<{ name: string }>;
  if (!pendingObservationColumns.some((column) => column.name === "reconciled_transaction_id")) {
    db.exec("ALTER TABLE pending_transaction_observations ADD COLUMN reconciled_transaction_id TEXT");
  }
  if (!pendingObservationColumns.some((column) => column.name === "reconciled_at_iso")) {
    db.exec("ALTER TABLE pending_transaction_observations ADD COLUMN reconciled_at_iso TEXT");
  }

  const transactionColumns = db.prepare("PRAGMA table_info(transactions)").all() as Array<{ name: string }>;
  if (!transactionColumns.some((column) => column.name === "currency_code")) {
    db.exec("ALTER TABLE transactions ADD COLUMN currency_code TEXT");
  }
  if (!transactionColumns.some((column) => column.name === "source_type")) {
    db.exec("ALTER TABLE transactions ADD COLUMN source_type TEXT");
  }
  if (!transactionColumns.some((column) => column.name === "source_reference")) {
    db.exec("ALTER TABLE transactions ADD COLUMN source_reference TEXT");
  }
  if (!transactionColumns.some((column) => column.name === "categorization_json")) {
    db.exec("ALTER TABLE transactions ADD COLUMN categorization_json TEXT");
  }
  if (!transactionColumns.some((column) => column.name === "category_allocations_json")) {
    db.exec("ALTER TABLE transactions ADD COLUMN category_allocations_json TEXT");
  }
  if (!transactionColumns.some((column) => column.name === "merchant_search")) {
    db.exec("ALTER TABLE transactions ADD COLUMN merchant_search TEXT NOT NULL DEFAULT ''");
  }
  db.exec("BEGIN");
  try {
    if (!transactionColumns.some((column) => column.name === "booked_at_millis")) {
      db.exec("ALTER TABLE transactions ADD COLUMN booked_at_millis INTEGER");
    }
    const bookings = db.prepare(
      "SELECT id, booked_at_iso FROM transactions WHERE booked_at_millis IS NULL"
    ).all() as Array<{ id: string; booked_at_iso: string }>;
    const updateBooking = db.prepare("UPDATE transactions SET booked_at_millis = ? WHERE id = ?");
    for (const booking of bookings) {
      updateBooking.run(transactionBookingTimeMillis(booking.booked_at_iso), booking.id);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transactions_household_booking_millis_id
        ON transactions (household_id, booked_at_millis, id)
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const correctionProvenanceColumns = db
    .prepare("PRAGMA table_info(merchant_correction_provenance)")
    .all() as Array<{ name: string }>;
  if (!correctionProvenanceColumns.some((column) => column.name === "original_categorization_json")) {
    db.exec("ALTER TABLE merchant_correction_provenance ADD COLUMN original_categorization_json TEXT");
  }
  if (!correctionProvenanceColumns.some((column) => column.name === "actor")) {
    db.exec("ALTER TABLE merchant_correction_provenance ADD COLUMN actor TEXT NOT NULL DEFAULT 'local-user'");
  }
  const propagationChangeColumns = db
    .prepare("PRAGMA table_info(same_merchant_propagation_changes)")
    .all() as Array<{ name: string }>;
  const propagationCategorizationColumns = [
    ["before_categorization_json", "TEXT"],
    ["after_categorization_json", "TEXT"],
  ] as const;
  const isLegacyPropagationSchema = propagationCategorizationColumns.some(([columnName]) =>
    !propagationChangeColumns.some((column) => column.name === columnName)
  );
  for (const [columnName, columnType] of propagationCategorizationColumns) {
    if (!propagationChangeColumns.some((column) => column.name === columnName)) {
      db.exec(`ALTER TABLE same_merchant_propagation_changes ADD COLUMN ${columnName} ${columnType}`);
    }
  }
  if (isLegacyPropagationSchema) {
    db.exec(`
      UPDATE same_merchant_propagation_changes
      SET before_categorization_json = (
        SELECT categorization_json FROM transactions
        WHERE transactions.id = same_merchant_propagation_changes.transaction_id
      ),
      after_categorization_json = (
        SELECT categorization_json FROM transactions
        WHERE transactions.id = same_merchant_propagation_changes.transaction_id
      )
      WHERE before_categorization_json IS NULL AND after_categorization_json IS NULL
    `);
  }
  const transactionsWithoutMerchantSearch = db
    .prepare("SELECT id, merchant_raw FROM transactions WHERE merchant_search = ''")
    .all() as Array<{ id: string; merchant_raw: string }>;
  const updateMerchantSearch = db.prepare("UPDATE transactions SET merchant_search = ? WHERE id = ?");
  for (const transaction of transactionsWithoutMerchantSearch) {
    updateMerchantSearch.run(transaction.merchant_raw.toUpperCase(), transaction.id);
  }

  const importOperationColumns = db.prepare("PRAGMA table_info(import_job_operations)").all() as Array<{ name: string }>;
  if (!importOperationColumns.some((column) => column.name === "undo_available")) {
    db.exec("ALTER TABLE import_job_operations ADD COLUMN undo_available INTEGER NOT NULL DEFAULT 1");
  }

  const backupSnapshotColumns = db.prepare("PRAGMA table_info(backup_snapshots)").all() as Array<{ name: string }>;
  if (!backupSnapshotColumns.some((column) => column.name === "version")) {
    db.exec("ALTER TABLE backup_snapshots ADD COLUMN version TEXT NOT NULL DEFAULT '3'");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transactions_household_booked_id
      ON transactions (household_id, booked_at_iso, id);
    CREATE INDEX IF NOT EXISTS idx_transactions_household_account_booked_id
      ON transactions (household_id, account_id, booked_at_iso, id);
    CREATE INDEX IF NOT EXISTS idx_transactions_household_amount_id
      ON transactions (household_id, amount_minor, id);
    CREATE INDEX IF NOT EXISTS idx_transactions_household_category_id
      ON transactions (household_id, category_id, id);
    CREATE INDEX IF NOT EXISTS idx_transactions_household_allocations
      ON transactions (household_id, category_allocations_json);
    CREATE INDEX IF NOT EXISTS idx_merchant_correction_provenance_corrected_at
      ON merchant_correction_provenance (corrected_at_iso, id);
    CREATE INDEX IF NOT EXISTS idx_same_merchant_propagation_applied_at
      ON same_merchant_propagation_operations (applied_at_iso, id);
    CREATE INDEX IF NOT EXISTS idx_backup_snapshots_saved_at
      ON backup_snapshots (saved_at_iso DESC, snapshot_path);
  `);

  const importJobColumns = db.prepare("PRAGMA table_info(import_jobs)").all() as Array<{ name: string }>;
  const importJobColumnsToAdd = [
    ["adapter_id", "TEXT"],
    ["candidate_count", "INTEGER"],
    ["validation_failure_count", "INTEGER"],
    ["provenance_json", "TEXT"],
  ] as const;
  for (const [columnName, columnType] of importJobColumnsToAdd) {
    if (!importJobColumns.some((column) => column.name === columnName)) {
      db.exec(`ALTER TABLE import_jobs ADD COLUMN ${columnName} ${columnType}`);
    }
  }
  const importReviewItemColumns = db
    .prepare("PRAGMA table_info(import_review_items)")
    .all() as Array<{ name: string }>;
  if (!importReviewItemColumns.some((column) => column.name === "source_evidence_json")) {
    db.exec("ALTER TABLE import_review_items ADD COLUMN source_evidence_json TEXT");
  }
}
