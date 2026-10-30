import { randomUUID } from "node:crypto";
import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import {
  DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS,
  validateLoanResponsibilityShareUpdate,
} from "../domain/householdShareValidation.js";
import {
  validateLoanBalanceInput,
  validateLoanRecordInput,
} from "../domain/loanRecordValidation.js";
import type {
  LoanBalanceInput,
  LoanBalanceSnapshot,
  LoanRecord,
  LoanRecordInput,
  LoanResponsibilityShareUpdateInput,
  LoanWithBalances,
} from "../domain/types.js";

export interface LoanRegistryOptions {
  createId?: () => string;
  now?: () => Date;
}

export interface LoanRegistry {
  list: () => LoanWithBalances[];
  create: (input: LoanRecordInput) => LoanRecord;
  updateResponsibilityShare: (input: LoanResponsibilityShareUpdateInput) => LoanRecord;
  appendBalance: (input: LoanBalanceInput) => LoanBalanceSnapshot;
}

export function createLoanRegistry(
  database: LocalLedgerDatabase,
  options: LoanRegistryOptions = {}
): LoanRegistry {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  function currentHouseholdId(): string {
    const metadata = database.loadRuntimeMetadata();
    if (metadata === null) {
      throw new Error("Local household is not available for the loan registry.");
    }
    return metadata.household.id;
  }

  function list(): LoanWithBalances[] {
    return database.listLoanRecords(currentHouseholdId()).map((loan) => ({
      ...loan,
      balances: database.listLoanBalanceSnapshots(loan.id),
    }));
  }

  function create(input: LoanRecordInput): LoanRecord {
    const householdId = currentHouseholdId();
    const propertyIds = database.listPropertyRecords(householdId).map((property) => property.id);
    const validated = validateLoanRecordInput(input, propertyIds);
    const loan: LoanRecord = {
      ...validated,
      id: createId(),
      householdId,
      createdAtIso: now().toISOString(),
      responsibilityShareBasisPoints: DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS,
    };
    database.createLoanRecord(loan);
    return loan;
  }

  function updateResponsibilityShare(input: LoanResponsibilityShareUpdateInput): LoanRecord {
    const validated = validateLoanResponsibilityShareUpdate(input);
    const loan = database.listLoanRecords(currentHouseholdId())
      .find((record) => record.id === validated.loanId);
    if (loan === undefined) throw new Error(`Loan not found: ${validated.loanId}`);
    database.updateLoanResponsibilityShare(validated.loanId, validated.responsibilityShareBasisPoints);
    return { ...loan, responsibilityShareBasisPoints: validated.responsibilityShareBasisPoints };
  }

  function appendBalance(input: LoanBalanceInput): LoanBalanceSnapshot {
    const validated = validateLoanBalanceInput(input);
    const loan = database
      .listLoanRecords(currentHouseholdId())
      .find((record) => record.id === validated.loanId);
    if (loan === undefined) {
      throw new Error(`Loan not found: ${validated.loanId}`);
    }

    const snapshot: LoanBalanceSnapshot = {
      ...validated,
      id: createId(),
      currencyCode: loan.currencyCode,
      recordedAtIso: now().toISOString(),
    };
    database.appendLoanBalanceSnapshot(snapshot);
    return snapshot;
  }

  return { list, create, updateResponsibilityShare, appendBalance };
}
