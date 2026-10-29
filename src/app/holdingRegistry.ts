import { randomUUID } from "node:crypto";
import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import {
  validateHoldingRecordInput,
  validateHoldingValuationInput,
} from "../domain/holdingRecordValidation.js";
import type {
  HoldingRecord,
  HoldingRecordInput,
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

  return { list, create, appendValuation };
}
