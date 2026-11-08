import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { withIsolatedLedger } from "../helpers/isolatedLedger.js";
import type { LedgerSnapshotData } from "../../src/domain/backup/snapshotContract.js";

const seed: Omit<LedgerSnapshotData, "createdAtIso"> = {
  household: { id: "hh-a", name: "Synthetic household", createdAtIso: "2026-01-01T00:00:00Z" },
  accounts: [
    { id: "acc-z", householdId: "hh-a", name: "Current", currencyCode: "NOK" },
    { id: "acc-a", householdId: "hh-a", name: "Savings", currencyCode: "NOK" },
  ],
  transactions: [{ id: "tx-a", householdId: "hh-a", accountId: "acc-z",
    bookedAtIso: "2026-05-01", amountMinor: -2500, merchantRaw: "Kiwi" }],
  importJobs: [], monthlyCategoryTargets: [],
  accountStatementCoveragePeriods: [
    { id: "period-z", accountId: "acc-z", startDateIso: "2026-05-01", endDateIso: "2026-05-31",
      currencyCode: "NOK", sourceName: "synthetic.csv", sourceType: "csv", confirmed: false },
    { id: "period-a", accountId: "acc-a", startDateIso: "2026-04-01", endDateIso: "2026-04-30",
      currencyCode: "NOK", sourceName: "synthetic.pdf", sourceType: "pdf", confirmed: true,
      confirmedAtIso: "2026-05-01T12:00:00Z", importedAtIso: "2026-05-01T11:00:00Z" },
  ],
  accountBalanceCheckpoints: [
    { id: "balance-z", accountId: "acc-z", dateIso: "2026-05-01", currencyCode: "NOK",
      balanceMinor: -123, source: "manual", recordedAtIso: "2026-05-01T12:00:00Z" },
    { id: "balance-a", accountId: "acc-a", dateIso: "2026-04-01", currencyCode: "NOK",
      balanceMinor: 0, source: "statement", sourceReference: "synthetic",
      recordedAtIso: "2026-04-01T12:00:00Z" },
  ],
  properties: [
    { id: "property-a", householdId: "hh-a", label: "Zulu", createdAtIso: "2026-01-01T00:00:00Z",
      ownershipShareBasisPoints: 2500 },
    { id: "property-z", householdId: "hh-a", label: "Alpha", createdAtIso: "2026-01-01T00:00:00Z",
      ownershipShareBasisPoints: 10000 },
  ],
  propertyValuations: [
    { id: "value-z", propertyId: "property-a", effectiveDateIso: "2026-01-01",
      amountMinor: 10000, currencyCode: "NOK", recordedAtIso: "2026-01-02T00:00:00Z" },
    { id: "value-a", propertyId: "property-a", effectiveDateIso: "2026-01-01",
      amountMinor: 11000, currencyCode: "NOK", recordedAtIso: "2026-01-03T00:00:00Z",
      correction: { targetValuationId: "value-z", action: "supersede" } },
  ],
  holdings: [{ id: "holding-a", householdId: "hh-a", label: "Global fund", quantity: 1.5,
    costBasisMinor: 12300, currencyCode: "EUR", createdAtIso: "2026-01-01T00:00:00Z",
    revisions: [{ id: "revision-a", label: "Old fund", quantity: 1, costBasisMinor: 12000,
      currencyCode: "EUR", correctedAtIso: "2026-01-02T00:00:00Z" }] }],
  holdingValuations: [
    { id: "holding-value-z", holdingId: "holding-a", effectiveDateIso: "2026-01-01",
      amountMinor: 14000, currencyCode: "EUR", recordedAtIso: "2026-01-02T00:00:00Z" },
    { id: "holding-value-a", holdingId: "holding-a", effectiveDateIso: "2026-01-01",
      amountMinor: 0, currencyCode: "EUR", recordedAtIso: "2026-01-03T00:00:00Z",
      correction: { targetValuationId: "holding-value-z" } },
  ],
  loanRecords: [{ id: "loan-a", householdId: "hh-a", label: "Loan", principalMinor: 100000,
    annualInterestRateBasisPoints: 450, termMonths: 12, paymentAmountMinor: 9000,
    paymentFrequency: "monthly", currencyCode: "NOK", propertyId: "property-a",
    createdAtIso: "2026-01-01T00:00:00Z", responsibilityShareBasisPoints: 5000 }],
  loanBalanceSnapshots: [
    { id: "loan-value-z", loanId: "loan-a", effectiveDateIso: "2026-01-01", amountMinor: 100000,
      currencyCode: "NOK", recordedAtIso: "2026-01-02T00:00:00Z" },
    { id: "loan-value-a", loanId: "loan-a", effectiveDateIso: "2026-02-01", amountMinor: 91000,
      currencyCode: "NOK", recordedAtIso: "2026-02-02T00:00:00Z" },
  ],
  recurringCommitments: [
    { id: "commitment-a", householdId: "hh-a", description: "Zulu", currencyCode: "NOK",
      amountMinor: null, isVariable: true, cadence: "monthly", firstDueDateIso: "2026-05-31",
      activeFromIso: "2026-05-01", status: "active", createdAtIso: "2026-01-01T00:00:00Z",
      updatedAtIso: "2026-01-02T00:00:00Z" },
    { id: "commitment-z", householdId: "hh-a", description: "Alpha", currencyCode: "NOK",
      amountMinor: 2500, isVariable: false, cadence: "monthly", firstDueDateIso: "2026-05-01",
      activeFromIso: "2026-05-01", activeUntilIso: "2026-12-31", status: "paused",
      createdAtIso: "2026-01-01T00:00:00Z", updatedAtIso: "2026-01-02T00:00:00Z" },
  ],
  recurringCommitmentPaymentLinks: [{ id: "link-a", commitmentId: "commitment-z",
    occurrenceDateIso: "2026-05-01", transactionId: "tx-a", linkedAtIso: "2026-05-02T00:00:00Z" }],
  recurringCommitmentDecisions: [
    { id: "decision-z", commitmentId: "commitment-z", decisionType: "confirmed",
      decidedAtIso: "2026-05-01T00:00:00Z" },
    { id: "decision-a", commitmentId: "commitment-z", decisionType: "amount-change-confirmed",
      previousAmountMinor: 2500, newAmountMinor: 3000, decidedAtIso: "2026-05-02T00:00:00Z" },
  ],
};

describe("ledger list and snapshot row contracts", () => {
  it("preserves independent literal values, optional omission, booleans and correction history", async () => {
    await withIsolatedLedger({ seed }, ({ ledger }) => {
      const snapshot = ledger.loadLedgerSnapshotData();
      expect(snapshot.accountStatementCoveragePeriods).toEqual([
        { id: "period-a", accountId: "acc-a", startDateIso: "2026-04-01", endDateIso: "2026-04-30",
          currencyCode: "NOK", sourceName: "synthetic.pdf", sourceType: "pdf", confirmed: true,
          confirmedAtIso: "2026-05-01T12:00:00Z", importedAtIso: "2026-05-01T11:00:00Z" },
        { id: "period-z", accountId: "acc-z", startDateIso: "2026-05-01", endDateIso: "2026-05-31",
          currencyCode: "NOK", sourceName: "synthetic.csv", sourceType: "csv", confirmed: false },
      ]);
      expect(ledger.listAccountStatementCoveragePeriods("acc-z")).toEqual([
        { id: "period-z", accountId: "acc-z", startDateIso: "2026-05-01", endDateIso: "2026-05-31",
          currencyCode: "NOK", sourceName: "synthetic.csv", sourceType: "csv", confirmed: false },
      ]);
      expect(snapshot.accountBalanceCheckpoints).toEqual([
        { id: "balance-a", accountId: "acc-a", dateIso: "2026-04-01", currencyCode: "NOK",
          balanceMinor: 0, source: "statement", sourceReference: "synthetic",
          recordedAtIso: "2026-04-01T12:00:00Z" },
        { id: "balance-z", accountId: "acc-z", dateIso: "2026-05-01", currencyCode: "NOK",
          balanceMinor: -123, source: "manual", recordedAtIso: "2026-05-01T12:00:00Z" },
      ]);
      expect(snapshot.propertyValuations).toEqual([
        { id: "value-z", propertyId: "property-a", effectiveDateIso: "2026-01-01",
          amountMinor: 10000, currencyCode: "NOK", recordedAtIso: "2026-01-02T00:00:00Z" },
        { id: "value-a", propertyId: "property-a", effectiveDateIso: "2026-01-01",
          amountMinor: 11000, currencyCode: "NOK", recordedAtIso: "2026-01-03T00:00:00Z",
          correction: { targetValuationId: "value-z", action: "supersede" } },
      ]);
      expect(snapshot.holdingValuations).toEqual([
        { id: "holding-value-z", holdingId: "holding-a", effectiveDateIso: "2026-01-01",
          amountMinor: 14000, currencyCode: "EUR", recordedAtIso: "2026-01-02T00:00:00Z" },
        { id: "holding-value-a", holdingId: "holding-a", effectiveDateIso: "2026-01-01",
          amountMinor: 0, currencyCode: "EUR", recordedAtIso: "2026-01-03T00:00:00Z",
          correction: { targetValuationId: "holding-value-z" } },
      ]);
      expect(snapshot.loanBalanceSnapshots).toEqual([
        { id: "loan-value-z", loanId: "loan-a", effectiveDateIso: "2026-01-01", amountMinor: 100000,
          currencyCode: "NOK", recordedAtIso: "2026-01-02T00:00:00Z" },
        { id: "loan-value-a", loanId: "loan-a", effectiveDateIso: "2026-02-01", amountMinor: 91000,
          currencyCode: "NOK", recordedAtIso: "2026-02-02T00:00:00Z" },
      ]);
      expect(snapshot.recurringCommitments).toEqual([
        { id: "commitment-a", householdId: "hh-a", description: "Zulu", currencyCode: "NOK",
          amountMinor: null, isVariable: true, cadence: "monthly", firstDueDateIso: "2026-05-31",
          activeFromIso: "2026-05-01", status: "active", createdAtIso: "2026-01-01T00:00:00Z",
          updatedAtIso: "2026-01-02T00:00:00Z" },
        { id: "commitment-z", householdId: "hh-a", description: "Alpha", currencyCode: "NOK",
          amountMinor: 2500, isVariable: false, cadence: "monthly", firstDueDateIso: "2026-05-01",
          activeFromIso: "2026-05-01", activeUntilIso: "2026-12-31", status: "paused",
          createdAtIso: "2026-01-01T00:00:00Z", updatedAtIso: "2026-01-02T00:00:00Z" },
      ]);
      expect(snapshot.recurringCommitmentPaymentLinks).toEqual([
        { id: "link-a", commitmentId: "commitment-z", occurrenceDateIso: "2026-05-01",
          transactionId: "tx-a", linkedAtIso: "2026-05-02T00:00:00Z" },
      ]);
      expect(snapshot.recurringCommitmentDecisions).toEqual([
        { id: "decision-z", commitmentId: "commitment-z", decisionType: "confirmed",
          decidedAtIso: "2026-05-01T00:00:00Z" },
        { id: "decision-a", commitmentId: "commitment-z", decisionType: "amount-change-confirmed",
          previousAmountMinor: 2500, newAmountMinor: 3000, decidedAtIso: "2026-05-02T00:00:00Z" },
      ]);
      expect(snapshot.holdings).toEqual([{ id: "holding-a", householdId: "hh-a", label: "Global fund",
        quantity: 1.5, costBasisMinor: 12300, currencyCode: "EUR", createdAtIso: "2026-01-01T00:00:00Z",
        revisions: [{ id: "revision-a", label: "Old fund", quantity: 1, costBasisMinor: 12000,
          currencyCode: "EUR", correctedAtIso: "2026-01-02T00:00:00Z" }] }]);
      expect(snapshot.loanRecords).toEqual([
        { id: "loan-a", householdId: "hh-a", label: "Loan", principalMinor: 100000,
          annualInterestRateBasisPoints: 450, termMonths: 12, paymentAmountMinor: 9000,
          paymentFrequency: "monthly", currencyCode: "NOK", propertyId: "property-a",
          createdAtIso: "2026-01-01T00:00:00Z", responsibilityShareBasisPoints: 5000 },
      ]);
      expect(ledger.listHoldingRecords("hh-a")).toEqual(snapshot.holdings);
      expect(ledger.listLoanRecords("hh-a")).toEqual(snapshot.loanRecords);
      expect(ledger.listRecurringCommitments("hh-a")).toEqual([
        snapshot.recurringCommitments?.[1], snapshot.recurringCommitments?.[0],
      ]);
      for (const accountId of ["acc-a", "acc-z"]) {
        expect(ledger.listAccountBalanceCheckpoints(accountId)).toEqual(
          snapshot.accountBalanceCheckpoints?.filter((row) => row.accountId === accountId));
      }
      expect(ledger.listPropertyValuationSnapshots("property-a")).toEqual(snapshot.propertyValuations);
      expect(ledger.listHoldingValuationSnapshots("holding-a")).toEqual(snapshot.holdingValuations);
      expect(ledger.listLoanBalanceSnapshots("loan-a")).toEqual(snapshot.loanBalanceSnapshots);
      expect(ledger.listRecurringCommitmentPaymentLinks("hh-a")).toEqual(snapshot.recurringCommitmentPaymentLinks);
      expect(ledger.listRecurringCommitmentDecisions("hh-a")).toEqual(snapshot.recurringCommitmentDecisions);
    });
  });

  it("retains list-specific ordering and household/account scope rather than imposing snapshot order", async () => {
    await withIsolatedLedger({ seed }, ({ ledger, dbPath }) => {
      const raw = new DatabaseSync(dbPath);
      try {
        raw.exec(`
          INSERT INTO households VALUES ('hh-other', 'Other synthetic household', '2026-01-01T00:00:00Z');
          INSERT INTO accounts VALUES ('acc-other', 'hh-other', 'Other account', 'NOK');
        `);
      } finally {
        raw.close();
      }
      ledger.createPropertyRecord({ id: "property-other", householdId: "hh-other", label: "Aardvark",
        createdAtIso: "2026-01-01T00:00:00Z" });
      ledger.createHoldingRecord({ id: "holding-other", householdId: "hh-other", label: "Other fund",
        quantity: 1, costBasisMinor: 100, currencyCode: "NOK", createdAtIso: "2026-01-01T00:00:00Z" });
      ledger.createLoanRecord({ id: "loan-other", householdId: "hh-other", label: "Other loan",
        principalMinor: 1000, annualInterestRateBasisPoints: 100, termMonths: 12,
        paymentAmountMinor: 100, paymentFrequency: "monthly", currencyCode: "NOK",
        createdAtIso: "2026-01-01T00:00:00Z" });
      ledger.createRecurringCommitment({ id: "commitment-other", householdId: "hh-other",
        description: "Other bill", currencyCode: "NOK", amountMinor: 100, isVariable: false,
        cadence: "monthly", firstDueDateIso: "2026-01-01", activeFromIso: "2026-01-01",
        status: "active", createdAtIso: "2026-01-01T00:00:00Z", updatedAtIso: "2026-01-01T00:00:00Z" });
      expect(ledger.listPropertyRecords("hh-a")).toEqual([
        { id: "property-z", householdId: "hh-a", label: "Alpha", createdAtIso: "2026-01-01T00:00:00Z",
          ownershipShareBasisPoints: 10000 },
        { id: "property-a", householdId: "hh-a", label: "Zulu", createdAtIso: "2026-01-01T00:00:00Z",
          ownershipShareBasisPoints: 2500 },
      ]);
      expect(ledger.listRecurringCommitments("hh-a").map((row) => row.id)).toEqual(["commitment-z", "commitment-a"]);
      expect(ledger.loadLedgerSnapshotData().recurringCommitments?.map((row) => row.id))
        .toEqual(["commitment-a", "commitment-z"]);
      expect(ledger.loadLedgerSnapshotData().properties?.map((row) => row.id))
        .toEqual(["property-a", "property-other", "property-z"]);
      expect(ledger.listHoldingRecords("hh-a").map(row => row.id)).toEqual(["holding-a"]);
      expect(ledger.listLoanRecords("hh-a").map(row => row.id)).toEqual(["loan-a"]);
      expect(ledger.loadLedgerSnapshotData().holdings?.map(row => row.id)).toEqual(["holding-a"]);
      expect(ledger.loadLedgerSnapshotData().loanRecords?.map(row => row.id)).toEqual(["loan-a"]);
      expect(ledger.listAccountStatementCoveragePeriods("acc-other")).toEqual([]);
      expect(ledger.listAccountBalanceCheckpoints("acc-other")).toEqual([]);
      expect(ledger.listRecurringCommitmentPaymentLinks("hh-other")).toEqual([]);
      expect(ledger.listRecurringCommitmentDecisions("hh-other")).toEqual([]);
    });
  });
});
