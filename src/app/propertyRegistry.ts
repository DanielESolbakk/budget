import { randomUUID } from "node:crypto";
import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import {
  validatePropertyRecordInput,
  validatePropertyValuationInput,
} from "../domain/propertyRecordValidation.js";
import type {
  PropertyRecord,
  PropertyRecordInput,
  PropertyValuationInput,
  PropertyValuationSnapshot,
  PropertyWithValuations,
} from "../domain/types.js";

export interface PropertyRegistryOptions {
  createId?: () => string;
  now?: () => Date;
}

export interface PropertyRegistry {
  list: () => PropertyWithValuations[];
  create: (input: PropertyRecordInput) => PropertyRecord;
  appendValuation: (input: PropertyValuationInput) => PropertyValuationSnapshot;
}

export function createPropertyRegistry(
  database: LocalLedgerDatabase,
  options: PropertyRegistryOptions = {}
): PropertyRegistry {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  function currentHouseholdId(): string {
    const metadata = database.loadRuntimeMetadata();
    if (metadata === null) {
      throw new Error("Local household is not available for the property registry.");
    }
    return metadata.household.id;
  }

  function list(): PropertyWithValuations[] {
    return database.listPropertyRecords(currentHouseholdId()).map((property) => ({
      ...property,
      valuations: database.listPropertyValuationSnapshots(property.id),
    }));
  }

  function create(input: PropertyRecordInput): PropertyRecord {
    const validated = validatePropertyRecordInput(input);
    const property: PropertyRecord = {
      id: createId(),
      householdId: currentHouseholdId(),
      label: validated.label.trim(),
      createdAtIso: now().toISOString(),
    };
    database.createPropertyRecord(property);
    return property;
  }

  function appendValuation(input: PropertyValuationInput): PropertyValuationSnapshot {
    const validated = validatePropertyValuationInput(input);
    const householdId = currentHouseholdId();
    const propertyExists = database
      .listPropertyRecords(householdId)
      .some((property) => property.id === validated.propertyId);
    if (!propertyExists) {
      throw new Error(`Property not found: ${validated.propertyId}`);
    }

    const snapshot: PropertyValuationSnapshot = {
      ...validated,
      id: createId(),
      currencyCode: validated.currencyCode,
      recordedAtIso: now().toISOString(),
    };
    database.appendPropertyValuationSnapshot(snapshot);
    return snapshot;
  }

  return { list, create, appendValuation };
}
