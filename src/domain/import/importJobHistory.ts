import type { ImportJob } from "../types.js";

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
}

export interface UndoImportJobResult {
  importJobId: string;
  removedCount: number;
  retainedCount: number;
  alreadyUndone: boolean;
}