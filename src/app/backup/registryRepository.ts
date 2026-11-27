import {
  mapPropertyRecordRow,
  mapPropertyValuationSnapshotRow,
  mapHoldingValuationSnapshotRow,
  mapLoanBalanceSnapshotRow,
} from "./ledgerRowMappers.js";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { defaultHouseholdShare, validateHouseholdShare } from "../../domain/householdShareValidation.js";
import { isIsoCalendarDate } from "../../domain/date/calendarDate.js";
import { validatePropertyValuationCorrectionMetadata } from "../../domain/propertyRecordValidation.js";
import {
  validateLoanBalanceInput,
  validateLoanRecordInput,
  validateSourceOnlyLoanRecordInput,
} from "../../domain/loanRecordValidation.js";
import {
  validateHoldingRecordInput,
  validateHoldingRevision,
  validateHoldingValuationCorrectionMetadata,
  validateHoldingValuationInput,
} from "../../domain/holdingRecordValidation.js";
import type {
  HoldingRecord,
  HoldingRecordRevision,
  HoldingValuationSnapshot,
  LoanBalanceSnapshot,
  LoanRecord,
  SourceOnlyLoanRecord,
  PropertyRecord,
  PropertyValuationSnapshot,
} from "../../domain/types.js";
import { isCurrencyCode } from "../../domain/types.js";
import { sanitizeMortgageEvidenceDocuments } from "../../domain/import/rogalandMortgageHtml.js";
import type { MortgageIdentityFingerprinter } from "../../domain/import/mortgageIdentityFingerprint.js";
import type {
  MortgageEvidenceVersion,
  MortgageEvidenceVersionInput,
} from "../../shared/mortgageBankEvidence.js";
import type { LocalLedgerDatabase } from "./localLedgerContracts.js";

type RegistryRepository = Pick<LocalLedgerDatabase,
  | "createPropertyRecord"
  | "updatePropertyRecordLabel"
  | "updatePropertyOwnershipShare"
  | "listPropertyRecords"
  | "appendPropertyValuationSnapshot"
  | "listPropertyValuationSnapshots"
  | "createHoldingRecord"
  | "listHoldingRecords"
  | "correctHoldingRecord"
  | "appendHoldingValuationSnapshot"
  | "listHoldingValuationSnapshots"
  | "createLoanRecord"
  | "createSourceOnlyLoanRecord"
  | "listSourceOnlyLoanRecords"
  | "updateLoanResponsibilityShare"
  | "listLoanRecords"
  | "appendLoanBalanceSnapshot"
  | "listLoanBalanceSnapshots"
  | "getMortgageEvidenceRevision"
  | "appendMortgageEvidenceVersion"
  | "listMortgageEvidenceVersions"
>;

export function createRegistryRepository(
  db: DatabaseSync,
  fingerprinter: MortgageIdentityFingerprinter
): RegistryRepository {
  function getMortgageEvidenceRevision(loanId: string, householdId: string): string | null {
    const loan = listLoanRecords(householdId).find((candidate) => candidate.id === loanId);
    if (loan !== undefined) {
      return createHash("sha256").update(JSON.stringify({
        kind: "complete",
        loan,
        balances: listLoanBalanceSnapshots(loanId),
      })).digest("hex");
    }

    const sourceOnlyLoan = listSourceOnlyLoanRecords(householdId)
      .find((candidate) => candidate.id === loanId);
    if (sourceOnlyLoan === undefined) return null;
    return createHash("sha256").update(JSON.stringify({
      kind: "source-only",
      loan: sourceOnlyLoan,
    })).digest("hex");
  }

  function listMortgageEvidenceVersions(
    householdId: string,
    loanId?: string
  ): MortgageEvidenceVersion[] {
    const query = loanId === undefined ? `
      SELECT id, loan_id, household_id, version_number, source_as_of_date_iso,
        imported_at_iso, documents_json, pairing_json, attachment_json,
        term_comparisons_json, term_differences_acknowledged, schedule_validation_json
      FROM mortgage_evidence_versions
      WHERE household_id = ?
      ORDER BY version_number, id
    ` : `
      SELECT id, loan_id, household_id, version_number, source_as_of_date_iso,
        imported_at_iso, documents_json, pairing_json, attachment_json,
        term_comparisons_json, term_differences_acknowledged, schedule_validation_json
      FROM mortgage_evidence_versions
      WHERE household_id = ? AND loan_id = ?
      ORDER BY version_number, id
    `;
    const rows = (loanId === undefined
      ? db.prepare(query).all(householdId)
      : db.prepare(query).all(householdId, loanId)) as Array<{
      id: string;
      loan_id: string;
      household_id: string;
      version_number: number;
      source_as_of_date_iso: string | null;
      imported_at_iso: string;
      documents_json: string;
      pairing_json: string | null;
      attachment_json: string;
      term_comparisons_json: string;
      term_differences_acknowledged: number;
      schedule_validation_json: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      loanId: row.loan_id,
      householdId: row.household_id,
      versionNumber: row.version_number,
      sourceAsOfDateIso: row.source_as_of_date_iso,
      importedAtIso: row.imported_at_iso,
      documents: JSON.parse(row.documents_json) as MortgageEvidenceVersion["documents"],
      pairing: row.pairing_json === null
        ? null
        : JSON.parse(row.pairing_json) as MortgageEvidenceVersion["pairing"],
      attachment: JSON.parse(row.attachment_json) as MortgageEvidenceVersion["attachment"],
      termComparisons: JSON.parse(row.term_comparisons_json) as MortgageEvidenceVersion["termComparisons"],
      termDifferencesAcknowledged: row.term_differences_acknowledged === 1,
      scheduleValidation: row.schedule_validation_json === null
        ? null
        : JSON.parse(row.schedule_validation_json) as MortgageEvidenceVersion["scheduleValidation"],
    }));
  }

  function appendMortgageEvidenceVersion(
    input: MortgageEvidenceVersionInput,
    expectedLoanRevision: string | null,
    expectedVersionNumber: number,
    sourceOnlyLoan?: SourceOnlyLoanRecord
  ): MortgageEvidenceVersion {
    const persistedInput = {
      ...input,
      documents: sanitizeMortgageEvidenceDocuments(input.documents, fingerprinter),
    };
    db.exec("BEGIN IMMEDIATE");
    try {
      if (db.prepare("SELECT 1 FROM households WHERE id = ?").get(persistedInput.householdId) === undefined) {
        throw new Error(`Household not found for mortgage evidence: ${persistedInput.householdId}`);
      }
      if (sourceOnlyLoan !== undefined) {
        if (
          expectedLoanRevision !== null ||
          expectedVersionNumber !== 0 ||
          sourceOnlyLoan.id !== persistedInput.loanId ||
          sourceOnlyLoan.householdId !== persistedInput.householdId
        ) {
          throw new Error("New source-only loan and mortgage evidence do not match.");
        }
        createSourceOnlyLoanRecord(sourceOnlyLoan);
      } else {
        const currentLoanRevision = getMortgageEvidenceRevision(
          persistedInput.loanId,
          persistedInput.householdId
        );
        if (currentLoanRevision === null) {
          throw new Error(`Loan not found for mortgage evidence: ${persistedInput.loanId}`);
        }
        if (expectedLoanRevision === null || currentLoanRevision !== expectedLoanRevision) {
          throw new Error("Loan changed after mortgage evidence preview.");
        }
      }
      if (
        !Number.isSafeInteger(expectedVersionNumber) ||
        expectedVersionNumber < 0 ||
        !isIsoCalendarDate(persistedInput.sourceAsOfDateIso ?? "2000-01-01") ||
        !persistedInput.importedAtIso.includes("T") ||
        Number.isNaN(Date.parse(persistedInput.importedAtIso)) ||
        persistedInput.documents.length === 0 ||
        persistedInput.documents.length > 2 ||
        typeof persistedInput.termDifferencesAcknowledged !== "boolean" ||
        !Array.isArray(persistedInput.termComparisons) ||
        (persistedInput.termComparisons.some((comparison) => comparison.status === "differs") &&
          !persistedInput.termDifferencesAcknowledged) ||
        persistedInput.documents.some((document) => (
          !/^[0-9a-f]{64}$/i.test(document.sourceHashSha256) ||
            document.parserVersion.trim() === "" ||
            !Number.isSafeInteger(document.parserLimits.maxSourceCharacters) ||
            document.parserLimits.maxSourceCharacters <= 0 ||
            !Number.isSafeInteger(document.parserLimits.maxElements) ||
            document.parserLimits.maxElements <= 0 ||
            !Number.isSafeInteger(document.parserLimits.maxDepth) ||
            document.parserLimits.maxDepth <= 0 ||
            document.parsedDocument.role !== document.role ||
            !["parsed", "partial"].includes(document.parsedDocument.parseStatus)
          )) ||
          !["verified", "confirmed"].includes(persistedInput.attachment.status) ||
          (persistedInput.pairing !== null &&
            !["verified", "confirmed"].includes(persistedInput.pairing.status))
      ) {
        throw new Error("Mortgage evidence version is invalid.");
      }

      const currentVersionNumber = (db.prepare(`
        SELECT COALESCE(MAX(version_number), 0) AS version_number
        FROM mortgage_evidence_versions
        WHERE loan_id = ?
      `).get(persistedInput.loanId) as { version_number: number }).version_number;
      if (currentVersionNumber !== expectedVersionNumber) {
        throw new Error("Mortgage evidence changed after preview.");
      }

      const version: MortgageEvidenceVersion = {
        ...persistedInput,
        versionNumber: currentVersionNumber + 1,
      };
      db.prepare(`
        INSERT INTO mortgage_evidence_versions (
          id, loan_id, household_id, version_number, source_as_of_date_iso,
          imported_at_iso, documents_json, pairing_json, attachment_json,
          term_comparisons_json, term_differences_acknowledged, schedule_validation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        version.id,
        version.loanId,
        version.householdId,
        version.versionNumber,
        version.sourceAsOfDateIso,
        version.importedAtIso,
        JSON.stringify(version.documents),
        version.pairing === null ? null : JSON.stringify(version.pairing),
        JSON.stringify(version.attachment),
        JSON.stringify(version.termComparisons),
        version.termDifferencesAcknowledged ? 1 : 0,
        version.scheduleValidation === null ? null : JSON.stringify(version.scheduleValidation)
      );
      db.exec("COMMIT");
      return version;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function assertLoanIdAvailable(loanId: string): void {
    if (
      db.prepare("SELECT 1 FROM loan_records WHERE id = ?").get(loanId) !== undefined ||
      db.prepare("SELECT 1 FROM source_only_loan_records WHERE id = ?").get(loanId) !== undefined
    ) {
      throw new Error("Loan ID is already in use.");
    }
  }

  function createPropertyRecord(property: PropertyRecord): void {
    if (
      property.id.trim().length === 0 ||
      property.householdId.trim().length === 0 ||
      property.label.trim().length === 0 ||
      !property.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(property.createdAtIso))
    ) {
      throw new Error("Property record is invalid.");
    }
    if (
      db.prepare("SELECT 1 FROM households WHERE id = ?").get(property.householdId) === undefined
    ) {
      throw new Error(`Household not found for property: ${property.householdId}`);
    }
    db.prepare(
      "INSERT INTO properties (id, household_id, label, created_at_iso, ownership_share_basis_points) VALUES (?, ?, ?, ?, ?)"
    ).run(property.id, property.householdId, property.label, property.createdAtIso,
      defaultHouseholdShare(property.ownershipShareBasisPoints, "Property ownership share"));
  }

  function updatePropertyRecordLabel(propertyId: string, label: string): void {
    if (propertyId.trim().length === 0 || label.trim().length === 0) {
      throw new Error("Property label update is invalid.");
    }
    const result = db.prepare("UPDATE properties SET label = ? WHERE id = ?")
      .run(label.trim(), propertyId);
    if (Number(result.changes) !== 1) {
      throw new Error(`Property not found: ${propertyId}`);
    }
  }

  function updatePropertyOwnershipShare(propertyId: string, basisPoints: number): void {
    const result = db.prepare("UPDATE properties SET ownership_share_basis_points = ? WHERE id = ?")
      .run(validateHouseholdShare(basisPoints, "Property ownership share"), propertyId);
    if (Number(result.changes) !== 1) throw new Error(`Property not found: ${propertyId}`);
  }

  function listPropertyRecords(householdId: string): PropertyRecord[] {
    return db.prepare(`
      SELECT id, household_id, label, created_at_iso, ownership_share_basis_points
      FROM properties
      WHERE household_id = ?
      ORDER BY label COLLATE NOCASE, id
    `).all(householdId).map(mapPropertyRecordRow);
  }

  function appendPropertyValuationSnapshot(valuation: PropertyValuationSnapshot): void {
    const isIsoCalendarDate = (value: string): boolean =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
    const correction = valuation.correction === undefined
      ? undefined
      : validatePropertyValuationCorrectionMetadata(valuation.correction);
    if (
      valuation.id.trim().length === 0 ||
      valuation.propertyId.trim().length === 0 ||
      !isIsoCalendarDate(valuation.effectiveDateIso) ||
      !Number.isSafeInteger(valuation.amountMinor) ||
      valuation.amountMinor < 0 ||
      !isCurrencyCode(valuation.currencyCode) ||
      !valuation.recordedAtIso.includes("T") ||
      Number.isNaN(Date.parse(valuation.recordedAtIso))
    ) {
      throw new Error("Property valuation snapshot is invalid.");
    }
    if (
      db.prepare("SELECT 1 FROM properties WHERE id = ?").get(valuation.propertyId) === undefined
    ) {
      throw new Error(`Property not found for valuation: ${valuation.propertyId}`);
    }

    if (correction !== undefined) {
      const target = db.prepare(`
        SELECT id, effective_date_iso, amount_minor, currency_code, correction_json
        FROM property_valuation_snapshots
        WHERE id = ? AND property_id = ?
      `).get(correction.targetValuationId, valuation.propertyId) as {
        id: string;
        effective_date_iso: string;
        amount_minor: number;
        currency_code: string;
        correction_json: string | null;
      } | undefined;
      if (target === undefined) {
        throw new Error(`Property valuation not found: ${correction.targetValuationId}`);
      }

      const targetCorrection = target.correction_json === null
        ? undefined
        : validatePropertyValuationCorrectionMetadata(JSON.parse(target.correction_json) as unknown);
      if (targetCorrection?.action === "void") {
        throw new Error(`A void record cannot be corrected: ${correction.targetValuationId}`);
      }

      const existingCorrections = db.prepare(`
        SELECT correction_json
        FROM property_valuation_snapshots
        WHERE property_id = ? AND correction_json IS NOT NULL
      `).all(valuation.propertyId) as Array<{ correction_json: string }>;
      if (existingCorrections.some((row) =>
        validatePropertyValuationCorrectionMetadata(JSON.parse(row.correction_json) as unknown)
          .targetValuationId === correction.targetValuationId
      )) {
        throw new Error(`Property valuation has already been corrected: ${correction.targetValuationId}`);
      }
      if (
        correction.action === "void" &&
        (valuation.effectiveDateIso !== target.effective_date_iso ||
          valuation.amountMinor !== target.amount_minor ||
          valuation.currencyCode !== target.currency_code)
      ) {
        throw new Error("A void record must preserve the target valuation's original value.");
      }
    }

    db.prepare(`
      INSERT INTO property_valuation_snapshots (
        id, property_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso, correction_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      valuation.id,
      valuation.propertyId,
      valuation.effectiveDateIso,
      valuation.amountMinor,
      valuation.currencyCode,
      valuation.recordedAtIso,
      correction === undefined ? null : JSON.stringify(correction)
    );
  }

  function listPropertyValuationSnapshots(propertyId: string): PropertyValuationSnapshot[] {
    return db.prepare(`
      SELECT id, property_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso,
        correction_json
      FROM property_valuation_snapshots
      WHERE property_id = ?
      ORDER BY effective_date_iso, recorded_at_iso, id
    `).all(propertyId).map(mapPropertyValuationSnapshotRow);
  }

  function createHoldingRecord(holding: HoldingRecord): void {
    if (
      holding.id.trim().length === 0 ||
      holding.householdId.trim().length === 0 ||
      !holding.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(holding.createdAtIso))
    ) {
      throw new Error("Investment holding identity or creation timestamp is invalid.");
    }
    if (
      db.prepare("SELECT 1 FROM households WHERE id = ?").get(holding.householdId) === undefined
    ) {
      throw new Error(`Household not found for investment holding: ${holding.householdId}`);
    }

    const validated = validateHoldingRecordInput(holding);
    db.prepare(`
      INSERT INTO investment_holdings (
        id, household_id, label, quantity, cost_basis_minor, currency_code, created_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      holding.id,
      holding.householdId,
      validated.label,
      validated.quantity,
      validated.costBasisMinor,
      validated.currencyCode,
      holding.createdAtIso
    );
  }

  function listHoldingRecords(householdId: string): HoldingRecord[] {
    return db.prepare(`
      SELECT id, household_id, label, quantity, cost_basis_minor, currency_code, created_at_iso, revisions_json
      FROM investment_holdings
      WHERE household_id = ?
      ORDER BY label COLLATE NOCASE, id
    `).all(householdId).map((row) => {
      const holding = row as {
        id: string;
        household_id: string;
        label: string;
        quantity: number;
        cost_basis_minor: number;
        currency_code: string;
        created_at_iso: string;
        revisions_json: string | null;
      };
      const parsed: unknown = holding.revisions_json === null ? [] : JSON.parse(holding.revisions_json);
      if (!Array.isArray(parsed)) throw new Error("Investment holding revisions are invalid.");
      const revisions = parsed.map(validateHoldingRevision);
      if (new Set(revisions.map((revision) => revision.id)).size !== revisions.length) {
        throw new Error("Investment holding revision IDs must be unique.");
      }
      return {
        id: holding.id,
        householdId: holding.household_id,
        label: holding.label,
        quantity: holding.quantity,
        costBasisMinor: holding.cost_basis_minor,
        currencyCode: holding.currency_code,
        createdAtIso: holding.created_at_iso,
        ...(revisions.length === 0 ? {} : { revisions }),
      };
    });
  }

  function correctHoldingRecord(holding: HoldingRecord, revision: HoldingRecordRevision): void {
    const validated = validateHoldingRecordInput(holding);
    const previous = validateHoldingRevision(revision);
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = listHoldingRecords(holding.householdId).find((record) => record.id === holding.id);
      if (current === undefined || current.createdAtIso !== holding.createdAtIso ||
          current.label !== previous.label || current.quantity !== previous.quantity ||
          current.costBasisMinor !== previous.costBasisMinor ||
          current.currencyCode !== previous.currencyCode) {
        throw new Error("Investment holding changed before the correction could be saved.");
      }
      const revisions = [...(current.revisions ?? []), previous];
      if (new Set(revisions.map((item) => item.id)).size !== revisions.length) {
        throw new Error("Investment holding revision IDs must be unique.");
      }
      db.prepare(`
        UPDATE investment_holdings
        SET label = ?, quantity = ?, cost_basis_minor = ?, currency_code = ?, revisions_json = ?
        WHERE id = ? AND household_id = ?
      `).run(validated.label, validated.quantity, validated.costBasisMinor,
        validated.currencyCode, JSON.stringify(revisions), holding.id, holding.householdId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function appendHoldingValuationSnapshot(valuation: HoldingValuationSnapshot): void {
    if (
      valuation.id.trim().length === 0 ||
      !valuation.recordedAtIso.includes("T") ||
      Number.isNaN(Date.parse(valuation.recordedAtIso))
    ) {
      throw new Error("Investment holding valuation identity or recorded timestamp is invalid.");
    }
    const validated = validateHoldingValuationInput(valuation);
    if (
      db.prepare("SELECT 1 FROM investment_holdings WHERE id = ?")
        .get(validated.holdingId) === undefined
    ) {
      throw new Error(`Investment holding not found for valuation: ${validated.holdingId}`);
    }

    const correction = valuation.correction === undefined
      ? undefined
      : validateHoldingValuationCorrectionMetadata(valuation.correction);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (correction !== undefined) {
        const values = listHoldingValuationSnapshots(validated.holdingId);
        if (correction.targetValuationId === valuation.id ||
            !values.some((value) => value.id === correction.targetValuationId) ||
            values.some((value) => value.correction?.targetValuationId === correction.targetValuationId)) {
          throw new Error("Investment holding value is missing or has already been corrected.");
        }
      }
      db.prepare(`
        INSERT INTO holding_valuation_snapshots (
          id, holding_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso, correction_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        valuation.id,
        validated.holdingId,
        validated.effectiveDateIso,
        validated.amountMinor,
        validated.currencyCode,
        valuation.recordedAtIso,
        correction === undefined ? null : JSON.stringify(correction)
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listHoldingValuationSnapshots(holdingId: string): HoldingValuationSnapshot[] {
    return db.prepare(`
      SELECT id, holding_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso, correction_json
      FROM holding_valuation_snapshots
      WHERE holding_id = ?
      ORDER BY effective_date_iso, recorded_at_iso, id
    `).all(holdingId).map(mapHoldingValuationSnapshotRow);
  }

  function createLoanRecord(loan: LoanRecord): void {
    if (
      loan.id.trim().length === 0 ||
      loan.householdId.trim().length === 0 ||
      !loan.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(loan.createdAtIso))
    ) {
      throw new Error("Loan record identity or creation timestamp is invalid.");
    }
    if (
      db.prepare("SELECT 1 FROM households WHERE id = ?").get(loan.householdId) === undefined
    ) {
      throw new Error(`Household not found for loan: ${loan.householdId}`);
    }
    assertLoanIdAvailable(loan.id);

    const propertyIds = listPropertyRecords(loan.householdId).map((property) => property.id);
    const validated = validateLoanRecordInput(loan, propertyIds);
    db.prepare(`
      INSERT INTO loan_records (
        id, household_id, label, principal_minor, annual_interest_rate_basis_points,
        term_months, payment_amount_minor, payment_frequency, currency_code, property_id,
        created_at_iso, responsibility_share_basis_points
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      loan.id,
      loan.householdId,
      validated.label,
      validated.principalMinor,
      validated.annualInterestRateBasisPoints,
      validated.termMonths,
      validated.paymentAmountMinor,
      validated.paymentFrequency,
      validated.currencyCode,
      validated.propertyId ?? null,
      loan.createdAtIso,
      defaultHouseholdShare(loan.responsibilityShareBasisPoints, "Loan responsibility share")
    );
  }

  function createSourceOnlyLoanRecord(loan: SourceOnlyLoanRecord): void {
    if (
      loan.id.trim().length === 0 ||
      loan.householdId.trim().length === 0 ||
      !loan.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(loan.createdAtIso)) ||
      loan.recordStatus !== "source-only"
    ) {
      throw new Error("Source-only loan record identity or creation timestamp is invalid.");
    }
    if (db.prepare("SELECT 1 FROM households WHERE id = ?").get(loan.householdId) === undefined) {
      throw new Error(`Household not found for source-only loan: ${loan.householdId}`);
    }
    assertLoanIdAvailable(loan.id);

    const propertyIds = listPropertyRecords(loan.householdId).map((property) => property.id);
    const validated = validateSourceOnlyLoanRecordInput(loan, propertyIds);
    db.prepare(`
      INSERT INTO source_only_loan_records (
        id, household_id, label, currency_code, property_id,
        created_at_iso, responsibility_share_basis_points
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      loan.id,
      loan.householdId,
      validated.label,
      validated.currencyCode,
      validated.propertyId ?? null,
      loan.createdAtIso,
      defaultHouseholdShare(loan.responsibilityShareBasisPoints, "Loan responsibility share")
    );
  }

  function listSourceOnlyLoanRecords(householdId: string): SourceOnlyLoanRecord[] {
    return db.prepare(`
      SELECT id, household_id, label, currency_code, property_id, created_at_iso,
        responsibility_share_basis_points
      FROM source_only_loan_records
      WHERE household_id = ?
      ORDER BY label COLLATE NOCASE, id
    `).all(householdId).map((row) => {
      const sourceOnlyLoan = row as {
        id: string;
        household_id: string;
        label: string;
        currency_code: string;
        property_id: string | null;
        created_at_iso: string;
        responsibility_share_basis_points: number;
      };
      return {
        id: sourceOnlyLoan.id,
        householdId: sourceOnlyLoan.household_id,
        label: sourceOnlyLoan.label,
        currencyCode: sourceOnlyLoan.currency_code,
        ...(sourceOnlyLoan.property_id === null ? {} : { propertyId: sourceOnlyLoan.property_id }),
        createdAtIso: sourceOnlyLoan.created_at_iso,
        responsibilityShareBasisPoints: sourceOnlyLoan.responsibility_share_basis_points,
        recordStatus: "source-only",
      };
    });
  }

  function updateLoanResponsibilityShare(loanId: string, basisPoints: number): void {
    const result = db.prepare("UPDATE loan_records SET responsibility_share_basis_points = ? WHERE id = ?")
      .run(validateHouseholdShare(basisPoints, "Loan responsibility share"), loanId);
    if (Number(result.changes) !== 1) throw new Error(`Loan not found: ${loanId}`);
  }

  function listLoanRecords(householdId: string): LoanRecord[] {
    return db.prepare(`
      SELECT id, household_id, label, principal_minor, annual_interest_rate_basis_points,
        term_months, payment_amount_minor, payment_frequency, currency_code, property_id,
        created_at_iso, responsibility_share_basis_points
      FROM loan_records
      WHERE household_id = ?
      ORDER BY label COLLATE NOCASE, id
    `).all(householdId).map((row) => {
      const loan = row as {
        id: string;
        household_id: string;
        label: string;
        principal_minor: number;
        annual_interest_rate_basis_points: number;
        term_months: number;
        payment_amount_minor: number;
        payment_frequency: LoanRecord["paymentFrequency"];
        currency_code: string;
        property_id: string | null;
        created_at_iso: string;
        responsibility_share_basis_points: number;
      };
      return {
        id: loan.id,
        householdId: loan.household_id,
        label: loan.label,
        principalMinor: loan.principal_minor,
        annualInterestRateBasisPoints: loan.annual_interest_rate_basis_points,
        termMonths: loan.term_months,
        paymentAmountMinor: loan.payment_amount_minor,
        paymentFrequency: loan.payment_frequency,
        currencyCode: loan.currency_code,
        ...(loan.property_id === null ? {} : { propertyId: loan.property_id }),
        createdAtIso: loan.created_at_iso,
        responsibilityShareBasisPoints: loan.responsibility_share_basis_points,
      };
    });
  }

  function appendLoanBalanceSnapshot(balance: LoanBalanceSnapshot): void {
    if (
      balance.id.trim().length === 0 ||
      !balance.recordedAtIso.includes("T") ||
      Number.isNaN(Date.parse(balance.recordedAtIso))
    ) {
      throw new Error("Loan balance snapshot identity or recorded timestamp is invalid.");
    }
    const loan = db.prepare(`
      SELECT currency_code
      FROM loan_records
      WHERE id = ?
    `).get(balance.loanId) as { currency_code: string } | undefined;
    if (loan === undefined) {
      throw new Error(`Loan not found for balance snapshot: ${balance.loanId}`);
    }
    const validated = validateLoanBalanceInput(balance);
    if (balance.currencyCode !== loan.currency_code) {
      throw new Error("Loan balance currency must match the loan's original currency.");
    }

    db.prepare(`
      INSERT INTO loan_balance_snapshots (
        id, loan_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      balance.id,
      validated.loanId,
      validated.effectiveDateIso,
      validated.amountMinor,
      balance.currencyCode,
      balance.recordedAtIso
    );
  }

  function listLoanBalanceSnapshots(loanId: string): LoanBalanceSnapshot[] {
    return db.prepare(`
      SELECT id, loan_id, effective_date_iso, amount_minor, currency_code, recorded_at_iso
      FROM loan_balance_snapshots
      WHERE loan_id = ?
      ORDER BY effective_date_iso, recorded_at_iso, id
    `).all(loanId).map(mapLoanBalanceSnapshotRow);
  }

  return {
    createPropertyRecord,
    updatePropertyRecordLabel,
    updatePropertyOwnershipShare,
    listPropertyRecords,
    appendPropertyValuationSnapshot,
    listPropertyValuationSnapshots,
    createHoldingRecord,
    listHoldingRecords,
    correctHoldingRecord,
    appendHoldingValuationSnapshot,
    listHoldingValuationSnapshots,
    createLoanRecord,
    createSourceOnlyLoanRecord,
    listSourceOnlyLoanRecords,
    updateLoanResponsibilityShare,
    listLoanRecords,
    appendLoanBalanceSnapshot,
    listLoanBalanceSnapshots,
    getMortgageEvidenceRevision,
    appendMortgageEvidenceVersion,
    listMortgageEvidenceVersions,
  };
}
