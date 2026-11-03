import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildBackupSnapshot,
  createBackupSnapshot,
} from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { createRecurringCommitmentService } from "../../src/app/recurringCommitmentService.js";
import type {
  Household,
  ImportJob,
  PendingTransactionObservation,
  RecurringCommitment,
  RecurringCommitmentDecision,
  RecurringCommitmentPaymentLink,
  RecurringCommitmentInput,
  RecurringCommitmentPaymentLinkInput,
  RecurringCommitmentSchedule,
  Transaction,
} from "../../src/domain/types.js";
import type { LedgerSnapshotData } from "../../src/domain/backup/snapshotContract.js";

const household: Household = {
  id: "household-recurring",
  name: "Synthetic household",
  createdAtIso: "2026-01-01T00:00:00.000Z",
};

const commitment: RecurringCommitment = {
  id: "commitment-electricity",
  householdId: household.id,
  description: "Synthetic electricity bill",
  currencyCode: "NOK",
  amountMinor: null,
  isVariable: true,
  cadence: "monthly",
  firstDueDateIso: "2026-03-31",
  activeFromIso: "2026-03-01",
  status: "active",
  createdAtIso: "2026-03-01T08:00:00.000Z",
  updatedAtIso: "2026-03-02T08:00:00.000Z",
};

const paymentLink: RecurringCommitmentPaymentLink = {
  id: "payment-link-march",
  commitmentId: commitment.id,
  occurrenceDateIso: "2026-03-31",
  pendingObservationId: "pending-electricity",
  linkedAtIso: "2026-03-30T08:00:00.000Z",
};

const pendingObservation: PendingTransactionObservation = {
  id: "pending-electricity",
  householdId: household.id,
  accountId: "account-nok",
  transactionDateIso: "2026-03-31",
  amountMinor: -12_900,
  merchantRaw: "Synthetic electricity",
  sourceRowIndex: 1,
  currencyCode: "NOK",
  sourceType: "csv",
  sourceReference: "electricity-2026-03",
  status: "confirmed",
  sourceStatus: "Bekreftet",
};

const decision: RecurringCommitmentDecision = {
  id: "decision-confirm-electricity",
  commitmentId: commitment.id,
  decisionType: "confirmed",
  decidedAtIso: "2026-03-02T08:00:00.000Z",
};

const pendingElectricity: PendingTransactionObservation = {
  id: "pending-electricity",
  householdId: household.id,
  accountId: "account-nok",
  transactionDateIso: "2026-03-31",
  amountMinor: -12_900,
  merchantRaw: "Synthetic electricity",
  sourceRowIndex: 1,
  currencyCode: "NOK",
  sourceType: "csv",
  sourceReference: "electricity-2026-03",
  importJobId: "job-pending",
  status: "confirmed",
  sourceStatus: "Bekreftet",
};

function openLedger(dbPath: string, pendingObservations: PendingTransactionObservation[] = []) {
  return createLocalLedgerDatabase({
    dbPath,
    seedData: {
      household,
      accounts: [{
        id: "account-nok",
        householdId: household.id,
        name: "Synthetic NOK account",
        currencyCode: "NOK",
      }, {
        id: "account-eur",
        householdId: household.id,
        name: "Synthetic EUR account",
        currencyCode: "EUR",
      }],
      transactions: [],
      pendingObservations,
      importJobs: pendingObservations.length === 0
        ? []
        : [{
            id: "job-pending",
            householdId: household.id,
            sourceType: "csv",
            sourceName: "synthetic-pending.csv",
            startedAtIso: "2026-03-31T08:00:00.000Z",
          }],
      monthlyCategoryTargets: [],
    },
  });
}

let recurringServiceId = 0;

function createService(database: ReturnType<typeof openLedger>) {
  const service = createRecurringCommitmentService(database, {
    createId: () => `recurring-service-${++recurringServiceId}`,
    now: () => new Date("2026-03-01T08:00:00.000Z"),
  });
  expect(isRecurringCommitmentService(service)).toBe(true);
  if (!isRecurringCommitmentService(service)) {
    throw new Error("Recurring commitment service contract is invalid.");
  }
  return service;
}

const commitmentInput = {
  description: "Synthetic household bill",
  currencyCode: "NOK",
  amountMinor: 12_900,
  isVariable: false,
  cadence: "monthly" as const,
  firstDueDateIso: "2026-03-31",
  activeFromIso: "2026-03-01",
};

const networkFetch = vi.fn(() => {
  throw new Error("Network access is not allowed in recurring commitment integration tests.");
});

interface RecurringCommitmentServiceTestApi {
  create: (input: RecurringCommitmentInput) => RecurringCommitment;
  list: () => RecurringCommitment[];
  confirm: (commitmentId: string) => RecurringCommitment;
  linkPayment: (input: RecurringCommitmentPaymentLinkInput) => RecurringCommitmentPaymentLink;
  getSchedule: (evaluatedAtIso: string) => RecurringCommitmentSchedule;
  confirmPriceChange: (commitmentId: string, newAmountMinor: number) => RecurringCommitment;
  pause: (commitmentId: string) => RecurringCommitment;
  resume: (commitmentId: string) => RecurringCommitment;
  end: (commitmentId: string) => RecurringCommitment;
}

function isRecurringCommitmentService(
  value: unknown
): value is RecurringCommitmentServiceTestApi {
  return typeof value === "object" && value !== null &&
    typeof Reflect.get(value, "create") === "function" &&
    typeof Reflect.get(value, "list") === "function" &&
    typeof Reflect.get(value, "confirm") === "function" &&
    typeof Reflect.get(value, "linkPayment") === "function" &&
    typeof Reflect.get(value, "getSchedule") === "function" &&
    typeof Reflect.get(value, "confirmPriceChange") === "function" &&
    typeof Reflect.get(value, "pause") === "function" &&
    typeof Reflect.get(value, "resume") === "function" &&
    typeof Reflect.get(value, "end") === "function";
}

beforeEach(() => {
  networkFetch.mockClear();
  vi.stubGlobal("fetch", networkFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recurring commitments in backup snapshots", () => {
  it("persists a confirmed commitment and its decision across restart and backup restore", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-persistence-"));
    const sourcePath = join(directory, "source.sqlite");
    const restoredPath = join(directory, "restored.sqlite");
    const snapshotPath = join(directory, "backup.json");
    let ledger = openLedger(sourcePath);

    try {
      const service = createService(ledger);
      const suggested = service.create(commitmentInput);
      expect(suggested.status).toBe("suggested");

      const confirmed = service.confirm(suggested.id);
      expect(confirmed.status).toBe("active");
      expect(ledger.loadLedgerSnapshotData().recurringCommitments).toEqual([confirmed]);
      expect(ledger.loadLedgerSnapshotData().recurringCommitmentDecisions).toMatchObject([
        {
          commitmentId: confirmed.id,
          decisionType: "confirmed",
          decidedAtIso: "2026-03-01T08:00:00.000Z",
        },
      ]);

      ledger.close();
      ledger = openLedger(sourcePath);
      expect(createService(ledger).list()).toEqual([confirmed]);
      expect(networkFetch).not.toHaveBeenCalled();

      createBackupSnapshot({
        ...ledger.loadLedgerSnapshotData(),
        outputPath: snapshotPath,
        createdAtIso: "2026-03-02T08:00:00.000Z",
      });
      const restored = restoreBackupSnapshot({ snapshotPath });
      expect(restored.recurringCommitments).toEqual([confirmed]);
      expect(restored.recurringCommitmentDecisions).toMatchObject([
        { commitmentId: confirmed.id, decisionType: "confirmed" },
      ]);

      const restoredLedger = openLedger(restoredPath);
      try {
        restoredLedger.replaceLedgerSnapshotData(restored);
        expect(createService(restoredLedger).list()).toEqual([confirmed]);
        expect(restoredLedger.loadLedgerSnapshotData().recurringCommitmentDecisions)
          .toEqual(restored.recurringCommitmentDecisions);
      } finally {
        restoredLedger.close();
      }
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resumes a paused commitment and persists the resumed decision", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-resume-"));
    const databasePath = join(directory, "ledger.sqlite");
    let ledger = openLedger(databasePath);

    try {
      const service = createService(ledger);
      const active = service.confirm(service.create(commitmentInput).id);
      const paused = service.pause(active.id);

      expect(paused.status).toBe("paused");
      const resumed = service.resume(paused.id);

      expect(resumed.status).toBe("active");
      expect(ledger.loadLedgerSnapshotData().recurringCommitmentDecisions?.map(
        (entry) => entry.decisionType
      )).toEqual(["confirmed", "paused", "resumed"]);

      ledger.close();
      ledger = openLedger(databasePath);
      expect(createService(ledger).list()).toMatchObject([
        { id: active.id, status: "active" },
      ]);
      expect(ledger.loadLedgerSnapshotData().recurringCommitmentDecisions?.map(
        (entry) => entry.decisionType
      )).toEqual(["confirmed", "paused", "resumed"]);
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resolves a linked pending payment to its booked transaction without duplicating an occurrence", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-payment-match-"));
    const ledger = openLedger(join(directory, "ledger.sqlite"), [pendingElectricity]);

    try {
      const service = createService(ledger);
      const commitment = service.confirm(service.create(commitmentInput).id);
      service.linkPayment({
        commitmentId: commitment.id,
        occurrenceDateIso: "2026-03-31",
        pendingObservationId: pendingElectricity.id,
      });

      const importJob: ImportJob = {
        id: "job-booked-electricity",
        householdId: household.id,
        sourceType: "csv",
        sourceName: "synthetic-booked.csv",
        startedAtIso: "2026-04-01T08:00:00.000Z",
      };
      const transaction: Transaction = {
        id: "transaction-electricity",
        householdId: household.id,
        accountId: "account-nok",
        bookedAtIso: "2026-03-31T12:00:00.000Z",
        amountMinor: -12_900,
        merchantRaw: "Synthetic electricity",
        currencyCode: "NOK",
        sourceType: "csv",
        sourceReference: "electricity-2026-03",
        importJobId: importJob.id,
      };
      ledger.appendImportJobAndTransactions(importJob, [transaction]);

      const schedule = service.getSchedule("2026-04-01T00:00:00.000Z");
      const marchOccurrences = schedule.occurrences.filter(
        (occurrence) => occurrence.commitmentId === commitment.id &&
          occurrence.dueDateIso === "2026-03-31"
      );

      expect(marchOccurrences).toHaveLength(1);
      expect(marchOccurrences[0]).toMatchObject({
        paymentStatus: "matched",
        linkedTransactionId: transaction.id,
        linkedPaymentDateIso: "2026-03-31",
      });
      expect(ledger.loadLedgerSnapshotData().pendingObservations?.[0]?.reconciledTransactionId)
        .toBe(transaction.id);
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not count a pending bill as paid when it reconciles to an incoming transaction", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-invalid-reconciliation-"));
    const sourceReference = "mismatched-booked-reference";
    const pending: PendingTransactionObservation = {
      ...pendingElectricity,
      id: "pending-reconciled-income",
      sourceReference,
    };
    const ledger = openLedger(join(directory, "ledger.sqlite"), [pending]);

    try {
      const service = createService(ledger);
      const commitment = service.confirm(service.create(commitmentInput).id);
      service.linkPayment({
        commitmentId: commitment.id,
        occurrenceDateIso: "2026-03-31",
        pendingObservationId: pending.id,
      });
      const importJob: ImportJob = {
        id: "job-mismatched-booking",
        householdId: household.id,
        sourceType: "csv",
        sourceName: "synthetic-mismatched-booking.csv",
        startedAtIso: "2026-04-01T08:00:00.000Z",
      };
      ledger.appendImportJobAndTransactions(importJob, [{
        id: "transaction-incoming-reconciliation",
        householdId: household.id,
        accountId: "account-nok",
        bookedAtIso: "2026-03-31T12:00:00.000Z",
        amountMinor: 12_900,
        merchantRaw: "Synthetic electricity",
        currencyCode: "NOK",
        sourceType: "csv",
        sourceReference,
        importJobId: importJob.id,
      }]);

      const marchOccurrence = service.getSchedule("2026-04-01T00:00:00.000Z")
        .occurrences.find((occurrence) =>
          occurrence.commitmentId === commitment.id &&
          occurrence.dueDateIso === "2026-03-31"
        );
      expect(marchOccurrence).toMatchObject({ paymentStatus: "unmatched" });
      expect(marchOccurrence?.linkedTransactionId).toBeUndefined();
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not offer or accept incoming transactions as recurring bill payments", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-incoming-payment-"));
    const databasePath = join(directory, "ledger.sqlite");
    const incomingObservation: PendingTransactionObservation = {
      id: "pending-income",
      householdId: household.id,
      accountId: "account-nok",
      transactionDateIso: "2026-03-31",
      amountMinor: 50_000,
      merchantRaw: "Synthetic salary",
      sourceRowIndex: 1,
      currencyCode: "NOK",
      sourceType: "csv",
      sourceReference: "salary-2026-03",
      importJobId: "job-pending",
      status: "confirmed",
      sourceStatus: "Bekreftet",
    };
    const ledger = openLedger(databasePath, [incomingObservation]);

    try {
      const service = createService(ledger);
      const commitment = service.confirm(service.create(commitmentInput).id);
      const incomingTransaction: Transaction = {
        id: "transaction-salary",
        householdId: household.id,
        accountId: "account-nok",
        bookedAtIso: "2026-03-31T12:00:00.000Z",
        amountMinor: 100_000,
        merchantRaw: "Synthetic salary",
        currencyCode: "NOK",
        sourceType: "manual",
      };
      ledger.appendTransactions([incomingTransaction]);

      const schedule = service.getSchedule("2026-04-01T00:00:00.000Z");
      expect(schedule.paymentCandidates).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: incomingTransaction.id }),
        expect.objectContaining({ id: incomingObservation.id }),
      ]));
      expect(() => service.linkPayment({
        commitmentId: commitment.id,
        occurrenceDateIso: "2026-03-31",
        transactionId: incomingTransaction.id,
      })).toThrow(/outgoing payment/i);
      expect(() => service.linkPayment({
        commitmentId: commitment.id,
        occurrenceDateIso: "2026-03-31",
        pendingObservationId: incomingObservation.id,
      })).toThrow(/outgoing payment/i);
      expect(() => ledger.createRecurringCommitmentPaymentLink({
        id: "link-income-transaction",
        commitmentId: commitment.id,
        occurrenceDateIso: "2026-03-31",
        transactionId: incomingTransaction.id,
        linkedAtIso: "2026-04-01T00:00:00.000Z",
      })).toThrow(/outgoing payment/i);
      expect(() => ledger.createRecurringCommitmentPaymentLink({
        id: "link-income-pending",
        commitmentId: commitment.id,
        occurrenceDateIso: "2026-03-31",
        pendingObservationId: incomingObservation.id,
        linkedAtIso: "2026-04-01T00:00:00.000Z",
      })).toThrow(/outgoing payment/i);
      expect(ledger.loadLedgerSnapshotData().recurringCommitmentPaymentLinks).toEqual([]);
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps every overdue occurrence and local payment candidate visible", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-old-overdue-"));
    const ledger = openLedger(join(directory, "ledger.sqlite"));

    try {
      const service = createService(ledger);
      const commitment = service.confirm(service.create({
        ...commitmentInput,
        firstDueDateIso: "2024-01-31",
        activeFromIso: "2024-01-01",
      }).id);
      const oldPayment: Transaction = {
        id: "transaction-old-recurring-payment",
        householdId: household.id,
        accountId: "account-nok",
        bookedAtIso: "2024-01-31T12:00:00.000Z",
        amountMinor: -12_900,
        merchantRaw: "Synthetic household bill",
        currencyCode: "NOK",
        sourceType: "manual",
      };
      ledger.appendTransactions([oldPayment]);

      const schedule = service.getSchedule("2026-05-01T00:00:00.000Z");
      expect(schedule.occurrences).toHaveLength(32);
      expect(schedule.occurrences.filter((occurrence) => occurrence.dueStatus === "past-due"))
        .toHaveLength(28);
      expect(schedule.occurrences).toContainEqual(expect.objectContaining({
        commitmentId: commitment.id,
        dueDateIso: "2024-01-31",
        dueStatus: "past-due",
        paymentStatus: "unmatched",
      }));
      expect(schedule.paymentCandidates).toContainEqual(expect.objectContaining({
        id: oldPayment.id,
        sourceType: "transaction",
      }));
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects backup payment links that point to incoming transactions", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-invalid-payment-backup-"));
    const databasePath = join(directory, "ledger.sqlite");
    const snapshotPath = join(directory, "invalid-payment-backup.json");
    const ledger = openLedger(databasePath);

    try {
      const service = createService(ledger);
      const commitment = service.confirm(service.create(commitmentInput).id);
      const incomingTransaction: Transaction = {
        id: "transaction-salary-backup",
        householdId: household.id,
        accountId: "account-nok",
        bookedAtIso: "2026-03-31T12:00:00.000Z",
        amountMinor: 100_000,
        merchantRaw: "Synthetic salary",
        currencyCode: "NOK",
        sourceType: "manual",
      };
      ledger.appendTransactions([incomingTransaction]);
      const snapshot = buildBackupSnapshot({
        ...ledger.loadLedgerSnapshotData(),
        recurringCommitmentPaymentLinks: [{
          id: "link-income-backup",
          commitmentId: commitment.id,
          occurrenceDateIso: "2026-03-31",
          transactionId: incomingTransaction.id,
          linkedAtIso: "2026-04-01T00:00:00.000Z",
        }],
        createdAtIso: "2026-04-01T08:00:00.000Z",
      });
      writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`, "utf8");

      expect(() => restoreBackupSnapshot({ snapshotPath }))
        .toThrow(/recurring commitment transaction links/i);
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects backup payment links whose dates are not commitment due dates", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-off-schedule-backup-"));
    const databasePath = join(directory, "ledger.sqlite");
    const snapshotPath = join(directory, "off-schedule-backup.json");
    const ledger = openLedger(databasePath, [pendingElectricity]);

    try {
      const service = createService(ledger);
      const confirmed = service.confirm(service.create(commitmentInput).id);
      const snapshot = buildBackupSnapshot({
        ...ledger.loadLedgerSnapshotData(),
        recurringCommitmentPaymentLinks: [{
          id: "payment-link-off-schedule",
          commitmentId: confirmed.id,
          occurrenceDateIso: "2026-03-30",
          pendingObservationId: pendingElectricity.id,
          linkedAtIso: "2026-03-30T08:00:00.000Z",
        }],
        createdAtIso: "2026-04-01T08:00:00.000Z",
      });
      writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`, "utf8");

      expect(() => restoreBackupSnapshot({ snapshotPath }))
        .toThrow(/recurring commitment payment links/i);
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps a suggested price change separate until the user confirms it", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-price-change-"));
    const databasePath = join(directory, "ledger.sqlite");
    const snapshotPath = join(directory, "price-change-backup.json");
    let ledger = openLedger(databasePath);

    try {
      const service = createService(ledger);
      const commitment = service.confirm(service.create(commitmentInput).id);
      const payments: Transaction[] = [
        {
          id: "transaction-march-payment",
          householdId: household.id,
          accountId: "account-nok",
          bookedAtIso: "2026-03-31T12:00:00.000Z",
          amountMinor: -12_900,
          merchantRaw: "Synthetic bill",
          currencyCode: "NOK",
          sourceType: "manual",
        },
        {
          id: "transaction-april-payment",
          householdId: household.id,
          accountId: "account-nok",
          bookedAtIso: "2026-04-30T12:00:00.000Z",
          amountMinor: -17_900,
          merchantRaw: "Synthetic bill",
          currencyCode: "NOK",
          sourceType: "manual",
        },
      ];
      ledger.appendTransactions(payments);
      service.linkPayment({
        commitmentId: commitment.id,
        occurrenceDateIso: "2026-03-31",
        transactionId: payments[0]!.id,
      });
      service.linkPayment({
        commitmentId: commitment.id,
        occurrenceDateIso: "2026-04-30",
        transactionId: payments[1]!.id,
      });

      const schedule = service.getSchedule("2026-05-01T00:00:00.000Z");
      expect(schedule.priceChanges).toContainEqual({
        commitmentId: commitment.id,
        description: commitment.description,
        previousAmountMinor: 12_900,
        observedAmountMinor: 17_900,
        differenceMinor: 5_000,
        currencyCode: "NOK",
        previousPaymentDateIso: "2026-03-31",
        previousPaymentDescription: "Synthetic bill",
        observedPaymentDateIso: "2026-04-30",
        observedPaymentDescription: "Synthetic bill",
      });
      expect(service.list()[0]?.amountMinor).toBe(12_900);

      service.confirmPriceChange(commitment.id, 17_900);

      expect(service.list()[0]?.amountMinor).toBe(17_900);
      expect(ledger.loadLedgerSnapshotData().recurringCommitmentDecisions)
        .toContainEqual(expect.objectContaining({
          commitmentId: commitment.id,
          decisionType: "amount-change-confirmed",
          previousAmountMinor: 12_900,
          newAmountMinor: 17_900,
        }));

      ledger.close();
      ledger = openLedger(databasePath);
      expect(createService(ledger).list()[0]?.amountMinor).toBe(17_900);
      expect(ledger.loadLedgerSnapshotData().recurringCommitmentDecisions)
        .toContainEqual(expect.objectContaining({
          commitmentId: commitment.id,
          decisionType: "amount-change-confirmed",
          previousAmountMinor: 12_900,
          newAmountMinor: 17_900,
        }));

      createBackupSnapshot({
        ...ledger.loadLedgerSnapshotData(),
        outputPath: snapshotPath,
        createdAtIso: "2026-05-02T08:00:00.000Z",
      });
      const restored = restoreBackupSnapshot({ snapshotPath });
      expect(restored.recurringCommitments[0]?.amountMinor).toBe(17_900);
      expect(restored.recurringCommitmentPaymentLinks).toHaveLength(2);
      expect(restored.recurringCommitmentDecisions)
        .toContainEqual(expect.objectContaining({
          commitmentId: commitment.id,
          decisionType: "amount-change-confirmed",
          previousAmountMinor: 12_900,
          newAmountMinor: 17_900,
        }));
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not offer or apply price changes after a commitment has ended", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-ended-price-change-"));
    const ledger = openLedger(join(directory, "ledger.sqlite"));

    try {
      const service = createService(ledger);
      const activeCommitment = service.confirm(service.create(commitmentInput).id);
      const payments: Transaction[] = [
        {
          id: "transaction-before-ending",
          householdId: household.id,
          accountId: "account-nok",
          bookedAtIso: "2026-03-31T12:00:00.000Z",
          amountMinor: -12_900,
          merchantRaw: "Synthetic bill",
          currencyCode: "NOK",
          sourceType: "manual",
        },
        {
          id: "transaction-price-after-ending",
          householdId: household.id,
          accountId: "account-nok",
          bookedAtIso: "2026-04-30T12:00:00.000Z",
          amountMinor: -17_900,
          merchantRaw: "Synthetic bill",
          currencyCode: "NOK",
          sourceType: "manual",
        },
      ];
      ledger.appendTransactions(payments);
      service.linkPayment({
        commitmentId: activeCommitment.id,
        occurrenceDateIso: "2026-03-31",
        transactionId: payments[0]!.id,
      });
      service.linkPayment({
        commitmentId: activeCommitment.id,
        occurrenceDateIso: "2026-04-30",
        transactionId: payments[1]!.id,
      });
      service.end(activeCommitment.id);

      expect(service.getSchedule("2026-05-01T00:00:00.000Z").priceChanges)
        .not.toContainEqual(expect.objectContaining({ commitmentId: activeCommitment.id }));
      expect(() => service.confirmPriceChange(activeCommitment.id, 17_900))
        .toThrow(/ended/i);
      expect(service.list()[0]?.amountMinor).toBe(12_900);
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses a dated rate for foreign commitments and leaves missing-rate amounts incomplete", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-fx-"));
    const databasePath = join(directory, "ledger.sqlite");
    const ledger = openLedger(databasePath);
    const noRateLedger = openLedger(join(directory, "no-rate.sqlite"));

    try {
      const service = createService(ledger);
      const commitment = service.confirm(service.create({
        ...commitmentInput,
        currencyCode: "EUR",
        amountMinor: 10_000,
      }).id);
      const dateRate = {
        id: "eur-rate-march",
        currencyCode: "EUR",
        rateNokPerUnit: "11.50",
        effectiveDate: "2026-03-01",
        kind: "dated" as const,
        source: "Synthetic dated rate",
        provenance: "manual" as const,
      };
      ledger.upsertExchangeRate(dateRate);

      const withRate = service.getSchedule("2026-03-01T00:00:00.000Z").occurrences
        .find((occurrence) => occurrence.commitmentId === commitment.id &&
          occurrence.dueDateIso === "2026-03-31");
      expect(withRate).toMatchObject({
        nativeAmountMinor: 10_000,
        nativeCurrencyCode: "EUR",
        nokAmountMinor: 115_000,
        exchangeRate: dateRate,
        isEstimate: false,
      });

      const noRateService = createService(noRateLedger);
      const noRateCommitment = noRateService.confirm(noRateService.create({
        ...commitmentInput,
        currencyCode: "EUR",
        amountMinor: 10_000,
      }).id);
      const incomplete = noRateService.getSchedule("2026-03-01T00:00:00.000Z").occurrences
        .find((occurrence) => occurrence.commitmentId === noRateCommitment.id &&
          occurrence.dueDateIso === "2026-03-31");
      expect(incomplete).toMatchObject({
        nativeAmountMinor: 10_000,
        nativeCurrencyCode: "EUR",
        nokAmountMinor: null,
        exchangeRate: null,
        isEstimate: false,
        conversionStatus: "incomplete",
      });
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      ledger.close();
      noRateLedger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("loads empty recurring collections from an existing ledger", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-empty-ledger-"));
    const ledger = openLedger(join(directory, "ledger.sqlite"));

    try {
      const snapshot = ledger.loadLedgerSnapshotData();

      expect(Reflect.get(snapshot, "recurringCommitments")).toEqual([]);
      expect(Reflect.get(snapshot, "recurringCommitmentPaymentLinks")).toEqual([]);
      expect(Reflect.get(snapshot, "recurringCommitmentDecisions")).toEqual([]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("includes commitments, payment links, and user decisions in deterministic snapshots", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-backup-"));
    const snapshotPath = join(directory, "recurring-backup.json");
    const snapshotInput: LedgerSnapshotData & {
      recurringCommitments: RecurringCommitment[];
      recurringCommitmentPaymentLinks: RecurringCommitmentPaymentLink[];
      recurringCommitmentDecisions: RecurringCommitmentDecision[];
    } = {
      household,
      accounts: [{
        id: "account-nok",
        householdId: household.id,
        name: "Synthetic NOK account",
        currencyCode: "NOK",
      }],
      transactions: [],
      pendingObservations: [pendingObservation],
      importJobs: [],
      monthlyCategoryTargets: [],
      recurringCommitments: [commitment],
      recurringCommitmentPaymentLinks: [paymentLink],
      recurringCommitmentDecisions: [decision],
      createdAtIso: "2026-03-03T08:00:00.000Z",
    };

    try {
      const snapshot = buildBackupSnapshot(snapshotInput);

      expect(snapshot.metadata.version).toBe("10");
      expect(Reflect.get(snapshot, "recurringCommitments")).toEqual([commitment]);
      expect(Reflect.get(snapshot, "recurringCommitmentPaymentLinks")).toEqual([paymentLink]);
      expect(Reflect.get(snapshot, "recurringCommitmentDecisions")).toEqual([decision]);

      createBackupSnapshot({ ...snapshotInput, outputPath: snapshotPath });
      const restored = restoreBackupSnapshot({ snapshotPath });
      expect(Reflect.get(restored, "recurringCommitments")).toEqual([commitment]);
      expect(Reflect.get(restored, "recurringCommitmentPaymentLinks")).toEqual([paymentLink]);
      expect(Reflect.get(restored, "recurringCommitmentDecisions")).toEqual([decision]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores version 9 snapshots with empty recurring collections", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-recurring-legacy-backup-"));
    const snapshotPath = join(directory, "legacy-backup.json");
    const snapshot = buildBackupSnapshot({
      household,
      accounts: [],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
      createdAtIso: "2026-03-03T08:00:00.000Z",
    });
    const legacySnapshot: Record<string, unknown> = {
      ...snapshot,
      metadata: { ...snapshot.metadata, version: "9" },
    };
    delete legacySnapshot["recurringCommitments"];
    delete legacySnapshot["recurringCommitmentPaymentLinks"];
    delete legacySnapshot["recurringCommitmentDecisions"];

    try {
      writeFileSync(snapshotPath, `${JSON.stringify(legacySnapshot)}\n`, "utf8");

      const restored = restoreBackupSnapshot({ snapshotPath });

      expect(Reflect.get(restored, "recurringCommitments")).toEqual([]);
      expect(Reflect.get(restored, "recurringCommitmentPaymentLinks")).toEqual([]);
      expect(Reflect.get(restored, "recurringCommitmentDecisions")).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
