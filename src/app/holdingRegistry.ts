import { randomUUID } from "node:crypto";
import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import {
  validateHoldingCorrectionInput,
  validateHoldingRecordInput,
  validateHoldingValuationCorrectionInput,
  validateHoldingValuationInput,
} from "../domain/holdingRecordValidation.js";
import type {
  HoldingCorrectionInput,
  HoldingRecord,
  HoldingRecordInput,
  HoldingRecordRevision,
  HoldingValuationCorrectionInput,
  HoldingValuationInput,
  HoldingValuationSnapshot,
  HoldingWithValuations,
} from "../domain/types.js";

export interface HoldingRegistryOptions {
  createId?: () => string;
  now?: () => Date;
}

export interface HoldingRegistry {
  list: () => HoldingWithValuations[];
  create: (input: HoldingRecordInput) => HoldingRecord;
  appendValuation: (input: HoldingValuationInput) => HoldingValuationSnapshot;
  correctHolding: (input: HoldingCorrectionInput) => HoldingRecord;
  correctValuation: (input: HoldingValuationCorrectionInput) => HoldingValuationSnapshot;
}

export function createHoldingRegistry(
  database: LocalLedgerDatabase,
  options: HoldingRegistryOptions = {}
): HoldingRegistry {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  function currentHouseholdId(): string {
    const metadata = database.loadRuntimeMetadata();
    if (metadata === null) {
      throw new Error("Local household is not available for the holding registry.");
    }
    return metadata.household.id;
  }

  function list(): HoldingWithValuations[] {
    return database.listHoldingRecords(currentHouseholdId()).map((holding) => ({
      ...holding,
      valuations: database.listHoldingValuationSnapshots(holding.id),
    }));
  }

  function create(input: HoldingRecordInput): HoldingRecord {
    const validated = validateHoldingRecordInput(input);
    const holding: HoldingRecord = {
      ...validated,
      id: createId(),
      householdId: currentHouseholdId(),
      createdAtIso: now().toISOString(),
    };
    database.createHoldingRecord(holding);
    return holding;
  }

  function appendValuation(input: HoldingValuationInput): HoldingValuationSnapshot {
    const validated = validateHoldingValuationInput(input);
    const householdId = currentHouseholdId();
    const holdingExists = database
      .listHoldingRecords(householdId)
      .some((holding) => holding.id === validated.holdingId);
    if (!holdingExists) {
      throw new Error(`Investment holding not found: ${validated.holdingId}`);
    }

    const snapshot: HoldingValuationSnapshot = {
      ...validated,
      id: createId(),
      recordedAtIso: now().toISOString(),
    };
    database.appendHoldingValuationSnapshot(snapshot);
    return snapshot;
  }

  function correctHolding(input: HoldingCorrectionInput): HoldingRecord {
    const validated = validateHoldingCorrectionInput(input);
    const current = database.listHoldingRecords(currentHouseholdId())
      .find((holding) => holding.id === validated.holdingId);
    if (current === undefined) throw new Error(`Investment holding not found: ${validated.holdingId}`);
    const revision: HoldingRecordRevision = {
      id: createId(),
      correctedAtIso: now().toISOString(),
      label: current.label,
      quantity: current.quantity,
      costBasisMinor: current.costBasisMinor,
      currencyCode: current.currencyCode,
    };
    const corrected: HoldingRecord = {
      ...current,
      label: validated.label,
      quantity: validated.quantity,
      costBasisMinor: validated.costBasisMinor,
      currencyCode: validated.currencyCode,
      revisions: [...(current.revisions ?? []), revision],
    };
    database.correctHoldingRecord(corrected, revision);
    return corrected;
  }

  function correctValuation(input: HoldingValuationCorrectionInput): HoldingValuationSnapshot {
    const validated = validateHoldingValuationCorrectionInput(input);
    const holding = database.listHoldingRecords(currentHouseholdId())
      .find((record) => record.id === validated.holdingId);
    if (holding === undefined) throw new Error(`Investment holding not found: ${validated.holdingId}`);
    const snapshot: HoldingValuationSnapshot = {
      id: createId(),
      holdingId: validated.holdingId,
      effectiveDateIso: validated.effectiveDateIso,
      amountMinor: validated.amountMinor,
      currencyCode: validated.currencyCode,
      recordedAtIso: now().toISOString(),
      correction: { targetValuationId: validated.targetValuationId },
    };
    database.appendHoldingValuationSnapshot(snapshot);
    return snapshot;
  }

  return { list, create, appendValuation, correctHolding, correctValuation };
}
