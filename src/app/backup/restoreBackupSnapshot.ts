import { readFileSync } from "node:fs";
import type { BackupSnapshot } from "../../domain/backup/snapshotContract.js";
import { SNAPSHOT_VERSION, type RestoreSnapshotInput, type RestoreSnapshotOutput } from "../../domain/backup/snapshotContract.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateBackupSnapshot(value: unknown, snapshotPath: string): BackupSnapshot {
  if (!isRecord(value) || !isRecord(value.metadata)) {
    throw new Error(`Invalid snapshot structure: ${snapshotPath}`);
  }

  const metadata = value.metadata;
  if (metadata.version !== SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported snapshot version: ${String(metadata.version ?? "unknown")}. Expected: ${SNAPSHOT_VERSION}`
    );
  }

  const collections = ["accounts", "transactions", "importJobs", "monthlyCategoryTargets"] as const;
  for (const collectionName of collections) {
    if (!Array.isArray(value[collectionName])) {
      throw new Error(`Invalid snapshot ${collectionName} collection: ${snapshotPath}`);
    }
  }

  const accounts = value.accounts as unknown[];
  const transactions = value.transactions as unknown[];

  if (
    !Number.isInteger(metadata.transactionCount) ||
    metadata.transactionCount !== transactions.length
  ) {
    throw new Error(`Snapshot transaction count does not match its transaction collection: ${snapshotPath}`);
  }

  if (!Number.isInteger(metadata.accountCount) || metadata.accountCount !== accounts.length) {
    throw new Error(`Snapshot account count does not match its account collection: ${snapshotPath}`);
  }

  if (!isRecord(value.household)) {
    throw new Error(`Invalid snapshot household: ${snapshotPath}`);
  }

  return value as unknown as BackupSnapshot;
}

/**
 * Reads a backup snapshot file and returns the equivalent ledger state.
 *
 * Throws when the snapshot file is missing, cannot be parsed, or was
 * produced by an incompatible snapshot version.
 */
export function restoreBackupSnapshot(input: RestoreSnapshotInput): RestoreSnapshotOutput {
  const raw = readFileSync(input.snapshotPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Failed to parse snapshot file: ${input.snapshotPath}`);
  }

  const snapshot = validateBackupSnapshot(parsed, input.snapshotPath);

  return {
    household: snapshot.household,
    accounts: snapshot.accounts,
    transactions: snapshot.transactions,
    importJobs: snapshot.importJobs,
    monthlyCategoryTargets: snapshot.monthlyCategoryTargets,
    transactionCount: snapshot.transactions.length,
  };
}
