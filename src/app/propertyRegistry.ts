import { randomUUID } from "node:crypto";
import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import {
  DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS,
  validatePropertyOwnershipShareUpdate,
} from "../domain/householdShareValidation.js";
import {
  validatePropertyLabelUpdateInput,
  validatePropertyRecordInput,
  validatePropertyValuationCorrectionInput,
  validatePropertyValuationInput,
} from "../domain/propertyRecordValidation.js";
import type {
  PropertyLabelUpdateInput,
  PropertyOwnershipShareUpdateInput,
  PropertyRecord,
  PropertyRecordInput,
  PropertyValuationCorrectionInput,
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
  renameProperty: (input: PropertyLabelUpdateInput) => PropertyRecord;
  updateOwnershipShare: (input: PropertyOwnershipShareUpdateInput) => PropertyRecord;
  appendValuation: (input: PropertyValuationInput) => PropertyValuationSnapshot;
  appendCorrection: (input: PropertyValuationCorrectionInput) => PropertyValuationSnapshot;
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
      ownershipShareBasisPoints: DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS,
    };
    database.createPropertyRecord(property);
    return property;
  }

  function renameProperty(input: PropertyLabelUpdateInput): PropertyRecord {
    const validated = validatePropertyLabelUpdateInput(input);
    const householdId = currentHouseholdId();
    const property = database
      .listPropertyRecords(householdId)
      .find((record) => record.id === validated.propertyId);
    if (property === undefined) {
      throw new Error(`Property not found: ${validated.propertyId}`);
    }

    database.updatePropertyRecordLabel(validated.propertyId, validated.label);
    return { ...property, label: validated.label };
  }

  function updateOwnershipShare(input: PropertyOwnershipShareUpdateInput): PropertyRecord {
    const validated = validatePropertyOwnershipShareUpdate(input);
    const property = database.listPropertyRecords(currentHouseholdId())
      .find((record) => record.id === validated.propertyId);
    if (property === undefined) throw new Error(`Property not found: ${validated.propertyId}`);
    database.updatePropertyOwnershipShare(validated.propertyId, validated.ownershipShareBasisPoints);
    return { ...property, ownershipShareBasisPoints: validated.ownershipShareBasisPoints };
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

  function appendCorrection(input: PropertyValuationCorrectionInput): PropertyValuationSnapshot {
    const validated = validatePropertyValuationCorrectionInput(input);
    const householdId = currentHouseholdId();
    const propertyExists = database
      .listPropertyRecords(householdId)
      .some((property) => property.id === validated.propertyId);
    if (!propertyExists) {
      throw new Error(`Property not found: ${validated.propertyId}`);
    }

    const valuations = database.listPropertyValuationSnapshots(validated.propertyId);
    const target = valuations.find((valuation) => valuation.id === validated.targetValuationId);
    if (target === undefined || target.correction?.action === "void") {
      throw new Error(`Active property valuation not found: ${validated.targetValuationId}`);
    }
    if (valuations.some((valuation) => valuation.correction?.targetValuationId === target.id)) {
      throw new Error(`Property valuation has already been corrected: ${target.id}`);
    }

    const snapshot: PropertyValuationSnapshot = {
      id: createId(),
      propertyId: target.propertyId,
      effectiveDateIso: validated.action === "supersede"
        ? validated.effectiveDateIso
        : target.effectiveDateIso,
      amountMinor: validated.action === "supersede"
        ? validated.amountMinor
        : target.amountMinor,
      currencyCode: validated.action === "supersede"
        ? validated.currencyCode
        : target.currencyCode,
      recordedAtIso: now().toISOString(),
      correction: {
        action: validated.action,
        targetValuationId: target.id,
      },
    };
    database.appendPropertyValuationSnapshot(snapshot);
    return snapshot;
  }

  return { list, create, renameProperty, updateOwnershipShare, appendValuation, appendCorrection };
}
