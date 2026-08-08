import { writeFileSync } from "node:fs";
import {
  SNAPSHOT_VERSION,
  type BackupSnapshot,
  type BackupSnapshotFileOutput,
  type CreateBackupSnapshotInput,
  type LedgerSnapshotData,
} from "../../domain/backup/snapshotContract.js";

function sortJsonValueRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValueRecursively(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nestedValue]) => [key, sortJsonValueRecursively(nestedValue)])
    );
  }

  return value;
}

/**
 * Builds a deterministic `BackupSnapshot` from the provided ledger data.
 *
 * All collections are sorted by `id` ascending so that identical ledger state
 * produces identical JSON when serialized.
 */
export function buildBackupSnapshot(input: LedgerSnapshotData): BackupSnapshot {
  const createdAtIso = input.createdAtIso ?? new Date().toISOString();

  const accounts = [...input.accounts].sort((a, b) => a.id.localeCompare(b.id));
  const transactions = [...input.transactions].sort((a, b) => a.id.localeCompare(b.id));
  const importJobs = [...input.importJobs].sort((a, b) => a.id.localeCompare(b.id));
  const monthlyCategoryTargets = [...input.monthlyCategoryTargets].sort((a, b) => {
    const byMonth = a.yearMonth.localeCompare(b.yearMonth);
    return byMonth !== 0 ? byMonth : a.categoryId.localeCompare(b.categoryId);
  });

  return {
    metadata: {
      version: SNAPSHOT_VERSION,
      createdAtIso,
      transactionCount: transactions.length,
      accountCount: accounts.length,
    },
    household: input.household,
    accounts,
    transactions,
    importJobs,
    monthlyCategoryTargets,
  };
}

/**
 * Writes a backup snapshot to disk at the given output path.
 *
 * The snapshot is serialized as deterministic JSON (sorted keys, 2-space
 * indentation) so that byte-for-byte comparison is possible across runs.
 */
export function createBackupSnapshot(input: CreateBackupSnapshotInput): BackupSnapshotFileOutput {
  const snapshot = buildBackupSnapshot(input);
  const json = JSON.stringify(sortJsonValueRecursively(snapshot), null, 2) + "\n";
  writeFileSync(input.outputPath, json, "utf8");

  return {
    outputPath: input.outputPath,
    transactionCount: snapshot.metadata.transactionCount,
    createdAtIso: snapshot.metadata.createdAtIso,
  };
}
