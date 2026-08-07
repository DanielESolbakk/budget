import { writeFileSync } from "node:fs";
import {
  SNAPSHOT_VERSION,
  type BackupSnapshot,
  type BackupSnapshotFileOutput,
  type BackupSnapshotInput,
} from "../../domain/backup/snapshotContract.js";

/**
 * Builds a deterministic `BackupSnapshot` from the provided ledger data.
 *
 * All collections are sorted by `id` ascending so that identical ledger state
 * produces identical JSON when serialized.
 */
export function buildBackupSnapshot(input: BackupSnapshotInput): BackupSnapshot {
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
export function createBackupSnapshot(
  input: BackupSnapshotInput & { outputPath: string }
): BackupSnapshotFileOutput {
  const snapshot = buildBackupSnapshot(input);
  const json = JSON.stringify(snapshot, null, 2) + "\n";
  writeFileSync(input.outputPath, json, "utf8");

  return {
    outputPath: input.outputPath,
    transactionCount: snapshot.metadata.transactionCount,
    createdAtIso: snapshot.metadata.createdAtIso,
  };
}
