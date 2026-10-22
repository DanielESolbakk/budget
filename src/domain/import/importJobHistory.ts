import type { ImportJob } from "../types.js";

export type ImportUndoRetentionReason = "changed-after-import" | "baseline-unavailable";

export interface RetainedImportTransaction {
  id: string;
  bookedAtIso: string;
  amountMinor: number;
  merchantRaw: string;
  currencyCode: string;
  reason: ImportUndoRetentionReason;
}

export interface ImportJobHistoryEntry {
  id: string;
  householdId: string;
  sourceType: ImportJob["sourceType"];
  sourceName: string;
  adapterId: string | null;
  accountId: string | null;
  candidateCount: number;
  importedCount: number;
  duplicateCount: number;
  undoAvailable: boolean;
  startedAtIso: string;
  finishedAtIso: string | null;
  undoneAtIso: string | null;
  undoRemovedCount: number;
  undoRetainedCount: number;
  retainedTransactions: RetainedImportTransaction[];
}

export interface UndoImportJobResult {
  importJobId: string;
  removedCount: number;
  retainedCount: number;
  alreadyUndone: boolean;
  retainedTransactions: RetainedImportTransaction[];
}