import { readFileSync } from "node:fs";
import type { BackupSnapshot } from "../../domain/backup/snapshotContract.js";
import { SNAPSHOT_VERSION, type RestoreSnapshotInput, type RestoreSnapshotOutput } from "../../domain/backup/snapshotContract.js";

/**
 * Reads a backup snapshot file and returns the equivalent ledger state.
 *
 * Throws when the snapshot file is missing, cannot be parsed, or was
 * produced by an incompatible snapshot version.
 */
export function restoreBackupSnapshot(input: RestoreSnapshotInput): RestoreSnapshotOutput {
  const raw = readFileSync(input.snapshotPath, "utf8");

  let snapshot: BackupSnapshot;
  try {
    snapshot = JSON.parse(raw) as BackupSnapshot;
  } catch {
    throw new Error(`Failed to parse snapshot file: ${input.snapshotPath}`);
  }

  if (!snapshot.metadata || snapshot.metadata.version !== SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported snapshot version: ${snapshot.metadata?.version ?? "unknown"}. Expected: ${SNAPSHOT_VERSION}`
    );
  }

  return {
    household: snapshot.household,
    accounts: snapshot.accounts,
    transactions: snapshot.transactions,
    importJobs: snapshot.importJobs,
    monthlyCategoryTargets: snapshot.monthlyCategoryTargets,
    transactionCount: snapshot.transactions.length,
  };
}
