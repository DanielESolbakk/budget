import { mapAccountStatementCoveragePeriodRow, mapAccountBalanceCheckpointRow } from "./ledgerRowMappers.js";
import { DatabaseSync } from "node:sqlite";
import type { AccountBalanceCheckpoint, AccountStatementCoveragePeriod } from "../../domain/types.js";
import { isCurrencyCode } from "../../domain/types.js";
import type { LocalLedgerDatabase } from "./localLedgerContracts.js";

type AccountCoverageRepository = Pick<LocalLedgerDatabase,
  | "saveAccountStatementCoveragePeriod"
  | "appendAccountBalanceCheckpoint"
  | "listAccountStatementCoveragePeriods"
  | "listAccountBalanceCheckpoints"
>;

export function createAccountCoverageRepository(db: DatabaseSync): AccountCoverageRepository {
  function saveAccountStatementCoveragePeriod(period: AccountStatementCoveragePeriod): void {
    const isValidDate = (value: string): boolean =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
    if (
      period.id.trim().length === 0 ||
      period.accountId.trim().length === 0 ||
      !isValidDate(period.startDateIso) ||
      !isValidDate(period.endDateIso) ||
      period.startDateIso > period.endDateIso ||
      !isCurrencyCode(period.currencyCode) ||
      period.sourceName.trim().length === 0 ||
      (period.sourceType !== "manual" && period.sourceType !== "csv" && period.sourceType !== "pdf") ||
      typeof period.confirmed !== "boolean" ||
      (period.importedAtIso !== undefined && Number.isNaN(Date.parse(period.importedAtIso))) ||
      (period.confirmedAtIso !== undefined && Number.isNaN(Date.parse(period.confirmedAtIso))) ||
      (period.confirmed && period.confirmedAtIso === undefined)
    ) {
      throw new Error("Account statement coverage period is invalid.");
    }
    const account = db.prepare(
      "SELECT household_id, currency_code FROM accounts WHERE id = ?"
    ).get(period.accountId) as { household_id: string; currency_code: string } | undefined;
    if (account === undefined) {
      throw new Error(`Account not found: ${period.accountId}`);
    }
    if (period.currencyCode !== account.currency_code) {
      throw new Error("Account coverage currency must match the account currency.");
    }
    if (
      period.importJobId !== undefined &&
      db.prepare("SELECT 1 FROM import_jobs WHERE id = ? AND household_id = ?")
        .get(period.importJobId, account.household_id) === undefined
    ) {
      throw new Error(`Import job not found for account coverage period: ${period.importJobId}`);
    }

    db.prepare(`
      INSERT INTO account_statement_coverage_periods (
        id, account_id, start_date_iso, end_date_iso, currency_code, source_name,
        source_type, import_job_id, imported_at_iso, confirmed, confirmed_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_id = excluded.account_id,
        start_date_iso = excluded.start_date_iso,
        end_date_iso = excluded.end_date_iso,
        currency_code = excluded.currency_code,
        source_name = excluded.source_name,
        source_type = excluded.source_type,
        import_job_id = excluded.import_job_id,
        imported_at_iso = excluded.imported_at_iso,
        confirmed = excluded.confirmed,
        confirmed_at_iso = excluded.confirmed_at_iso
    `).run(
      period.id,
      period.accountId,
      period.startDateIso,
      period.endDateIso,
      period.currencyCode,
      period.sourceName,
      period.sourceType,
      period.importJobId ?? null,
      period.importedAtIso ?? null,
      period.confirmed ? 1 : 0,
      period.confirmedAtIso ?? null
    );
  }

  function appendAccountBalanceCheckpoint(checkpoint: AccountBalanceCheckpoint): void {
    if (
      checkpoint.id.trim().length === 0 ||
      checkpoint.accountId.trim().length === 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(checkpoint.dateIso) ||
      Number.isNaN(Date.parse(`${checkpoint.dateIso}T00:00:00.000Z`)) ||
      new Date(`${checkpoint.dateIso}T00:00:00.000Z`).toISOString().slice(0, 10) !== checkpoint.dateIso ||
      !isCurrencyCode(checkpoint.currencyCode) ||
      !Number.isSafeInteger(checkpoint.balanceMinor) ||
      checkpoint.source.trim().length === 0 ||
      (checkpoint.sourceReference !== undefined && checkpoint.sourceReference.trim().length === 0) ||
      Number.isNaN(Date.parse(checkpoint.recordedAtIso))
    ) {
      throw new Error("Account balance checkpoint is invalid.");
    }
    const account = db.prepare(
      "SELECT currency_code FROM accounts WHERE id = ?"
    ).get(checkpoint.accountId) as { currency_code: string } | undefined;
    if (account === undefined) {
      throw new Error(`Account not found: ${checkpoint.accountId}`);
    }
    if (checkpoint.currencyCode !== account.currency_code) {
      throw new Error("Account checkpoint currency must match the account currency.");
    }
    db.prepare(`
      INSERT INTO account_balance_checkpoints (
        id, account_id, date_iso, currency_code, balance_minor, source,
        source_reference, recorded_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.id,
      checkpoint.accountId,
      checkpoint.dateIso,
      checkpoint.currencyCode,
      checkpoint.balanceMinor,
      checkpoint.source,
      checkpoint.sourceReference ?? null,
      checkpoint.recordedAtIso
    );
  }

  function listAccountStatementCoveragePeriods(accountId: string): AccountStatementCoveragePeriod[] {
    return db.prepare(`
      SELECT id, account_id, start_date_iso, end_date_iso, currency_code, source_name,
        source_type, import_job_id, imported_at_iso, confirmed, confirmed_at_iso
      FROM account_statement_coverage_periods
      WHERE account_id = ?
      ORDER BY start_date_iso, end_date_iso, id
    `).all(accountId).map(mapAccountStatementCoveragePeriodRow);
  }

  function listAccountBalanceCheckpoints(accountId: string): AccountBalanceCheckpoint[] {
    return db.prepare(`
      SELECT id, account_id, date_iso, currency_code, balance_minor, source,
        source_reference, recorded_at_iso
      FROM account_balance_checkpoints
      WHERE account_id = ?
      ORDER BY date_iso, recorded_at_iso, id
    `).all(accountId).map(mapAccountBalanceCheckpointRow);
  }

  return {
    saveAccountStatementCoveragePeriod,
    appendAccountBalanceCheckpoint,
    listAccountStatementCoveragePeriods,
    listAccountBalanceCheckpoints,
  };
}
