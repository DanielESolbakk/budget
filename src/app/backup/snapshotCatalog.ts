import { mkdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
	BackupSnapshotCatalogEntry,
	BackupSnapshotKind,
	LedgerSnapshotData,
} from "../../domain/backup/snapshotContract.js";
import { createBackupSnapshot } from "./createBackupSnapshot.js";
import { inspectBackupSnapshot } from "./restoreBackupSnapshot.js";

export interface BackupSnapshotCatalogWriter {
	saveBackupSnapshot: (entry: BackupSnapshotCatalogEntry) => void;
	listBackupSnapshots: () => BackupSnapshotCatalogEntry[];
	deleteBackupSnapshot: (snapshotPath: string) => boolean;
}

export const MAX_PRE_RESTORE_SNAPSHOTS = 5;

export function catalogBackupSnapshot(
	input: { snapshotPath: string; kind: BackupSnapshotKind },
	catalog: BackupSnapshotCatalogWriter
): BackupSnapshotCatalogEntry {
	const entry: BackupSnapshotCatalogEntry = {
		...inspectBackupSnapshot({ snapshotPath: input.snapshotPath }),
		snapshotPath: input.snapshotPath,
		kind: input.kind,
		savedAtIso: new Date().toISOString(),
	};
	catalog.saveBackupSnapshot(entry);
	return entry;
}

function pruneOldPreRestoreSnapshots(catalog: BackupSnapshotCatalogWriter): void {
	const preRestoreSnapshots = catalog
		.listBackupSnapshots()
		.filter((snapshot) => snapshot.kind === "pre-restore")
		.sort((left, right) =>
			right.savedAtIso.localeCompare(left.savedAtIso) ||
			left.snapshotPath.localeCompare(right.snapshotPath)
		);

	for (const snapshot of preRestoreSnapshots.slice(MAX_PRE_RESTORE_SNAPSHOTS)) {
		rmSync(snapshot.snapshotPath, { force: true });
		catalog.deleteBackupSnapshot(snapshot.snapshotPath);
	}
}

export function createPreRestoreBackupSnapshot(input: {
	outputDirectory: string;
	ledgerSnapshotData: LedgerSnapshotData;
	catalog: BackupSnapshotCatalogWriter;
}): BackupSnapshotCatalogEntry {
	mkdirSync(input.outputDirectory, { recursive: true });
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const snapshotPath = join(
		input.outputDirectory,
		`pre-restore-${timestamp}-${randomUUID()}.json`
	);

	createBackupSnapshot({ ...input.ledgerSnapshotData, outputPath: snapshotPath });
	const entry = catalogBackupSnapshot({ snapshotPath, kind: "pre-restore" }, input.catalog);
	pruneOldPreRestoreSnapshots(input.catalog);
	return entry;
}
