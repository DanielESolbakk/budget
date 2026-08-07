import type { Account, Household, ImportJob, MonthlyCategoryTarget, Transaction } from "../types.js";

/** Snapshot format version – increment when the schema changes in a breaking way. */
export const SNAPSHOT_VERSION = "1" as const;

export type SnapshotVersion = typeof SNAPSHOT_VERSION;

/** Deterministic metadata written into every snapshot. */
export interface SnapshotMetadata {
  /** Snapshot format version string. */
  version: SnapshotVersion;
  /** ISO 8601 datetime string recording when the snapshot was created. */
  createdAtIso: string;
  /** Total number of transactions contained in the snapshot. */
  transactionCount: number;
  /** Total number of accounts contained in the snapshot. */
  accountCount: number;
}

/**
 * Deterministic household ledger snapshot.
 *
 * All collections are sorted by `id` ascending so that identical ledger state
 * always produces byte-for-byte identical JSON when serialized with stable
 * key ordering.
 */
export interface BackupSnapshot {
  metadata: SnapshotMetadata;
  household: Household;
  accounts: Account[];
  transactions: Transaction[];
  importJobs: ImportJob[];
  monthlyCategoryTargets: MonthlyCategoryTarget[];
}

/** Input required to build a snapshot. */
export interface BackupSnapshotInput {
  household: Household;
  accounts: Account[];
  transactions: Transaction[];
  importJobs: ImportJob[];
  monthlyCategoryTargets: MonthlyCategoryTarget[];
  /** Override the creation timestamp (ISO 8601). Defaults to current UTC time. */
  createdAtIso?: string;
}

/** Output produced when a snapshot is serialized to disk. */
export interface BackupSnapshotFileOutput {
  /** Absolute path where the snapshot was written. */
  outputPath: string;
  /** Number of transactions contained in the snapshot. */
  transactionCount: number;
  /** ISO 8601 datetime string recorded as the snapshot creation time. */
  createdAtIso: string;
}

/** Input required to restore a snapshot. */
export interface RestoreSnapshotInput {
  /** Absolute path to the snapshot file to restore from. */
  snapshotPath: string;
}

/** Output produced by a successful restore. */
export interface RestoreSnapshotOutput {
  household: Household;
  accounts: Account[];
  transactions: Transaction[];
  importJobs: ImportJob[];
  monthlyCategoryTargets: MonthlyCategoryTarget[];
  /** Number of transactions that were restored. */
  transactionCount: number;
}
