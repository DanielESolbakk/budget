import { validateBackupSnapshot } from "./validateBackupSnapshot.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { BackupSnapshot } from "../../domain/backup/snapshotContract.js";
import {
  type BackupSnapshotSummary,
  type RestoreSnapshotInput,
  type RestoreSnapshotOutput,
} from "../../domain/backup/snapshotContract.js";

function readValidatedBackupSnapshot(
  snapshotPath: string,
  expectedContentHashSha256?: string
): { snapshot: BackupSnapshot; contentHashSha256: string } {
  const raw = readFileSync(snapshotPath);
  const contentHashSha256 = createHash("sha256").update(raw).digest("hex");
  if (
    expectedContentHashSha256 !== undefined &&
    contentHashSha256 !== expectedContentHashSha256
  ) {
    throw new Error("Snapshot changed since it was reviewed. Review it again before restoring.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    throw new Error(`Failed to parse snapshot file: ${snapshotPath}`);
  }

  return {
    snapshot: validateBackupSnapshot(parsed, snapshotPath),
    contentHashSha256,
  };
}

export function inspectBackupSnapshot(input: RestoreSnapshotInput): BackupSnapshotSummary {
  const { snapshot, contentHashSha256 } = readValidatedBackupSnapshot(input.snapshotPath);

  return {
    version: snapshot.metadata.version,
    householdName: snapshot.household.name,
    createdAtIso: snapshot.metadata.createdAtIso,
    accountCount: snapshot.metadata.accountCount,
    transactionCount: snapshot.metadata.transactionCount,
    contentHashSha256,
  };
}

/**
 * Reads a backup snapshot file and returns the equivalent ledger state.
 *
 * Throws when the snapshot file is missing, cannot be parsed, or was
 * produced by an incompatible snapshot version.
 */
export function restoreBackupSnapshot(input: RestoreSnapshotInput): RestoreSnapshotOutput {
  const { snapshot } = readValidatedBackupSnapshot(
    input.snapshotPath,
    input.expectedContentHashSha256
  );

  return {
    household: snapshot.household,
    accounts: snapshot.accounts,
    transactions: snapshot.transactions,
    ...(snapshot.pendingObservations === undefined
      ? {}
      : { pendingObservations: snapshot.pendingObservations }),
    importJobs: snapshot.importJobs,
    monthlyCategoryTargets: snapshot.monthlyCategoryTargets,
    merchantCategoryRules:
      snapshot.metadata.version === "1" ? [] : snapshot.merchantCategoryRules,
    accountStatementCoveragePeriods: snapshot.accountStatementCoveragePeriods,
    accountBalanceCheckpoints: snapshot.accountBalanceCheckpoints,
    exchangeRates: snapshot.exchangeRates,
    properties: snapshot.properties,
    propertyValuations: snapshot.propertyValuations,
    holdings: snapshot.holdings,
    holdingValuations: snapshot.holdingValuations,
    loanRecords: snapshot.loanRecords,
    loanBalanceSnapshots: snapshot.loanBalanceSnapshots,
    recurringCommitments: snapshot.recurringCommitments,
    recurringCommitmentPaymentLinks: snapshot.recurringCommitmentPaymentLinks,
    recurringCommitmentDecisions: snapshot.recurringCommitmentDecisions,
    transactionCount: snapshot.transactions.length,
  };
}
