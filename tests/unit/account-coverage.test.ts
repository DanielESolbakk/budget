import { describe, expect, it } from "vitest";
import { assessAccountCoverage } from "../../src/domain/ledger/accountCoverage.js";

const period = {
  id: "period-may",
  accountId: "account-nok",
  startDateIso: "2026-05-01",
  endDateIso: "2026-05-31",
  currencyCode: "NOK",
  sourceName: "Synthetic May statement",
  sourceType: "csv" as const,
  importedAtIso: "2026-06-01T09:00:00Z",
  confirmed: true,
  confirmedAtIso: "2026-06-02T09:00:00Z",
};

const checkpoints = [
  {
    id: "opening",
    accountId: "account-nok",
    dateIso: "2026-05-01",
    currencyCode: "NOK",
    balanceMinor: 100_000,
    source: "Statement",
    recordedAtIso: "2026-06-02T09:00:00Z",
  },
  {
    id: "closing",
    accountId: "account-nok",
    dateIso: "2026-05-31",
    currencyCode: "NOK",
    balanceMinor: 92_500,
    source: "Statement",
    recordedAtIso: "2026-06-02T09:00:00Z",
  },
];

const expense = {
  id: "booked-expense",
  householdId: "household",
  accountId: "account-nok",
  bookedAtIso: "2026-05-12T00:00:00Z",
  amountMinor: -12_500,
  merchantRaw: "Synthetic bill",
  currencyCode: "NOK",
};

describe("account statement coverage", () => {
  it("reconciles the closing balance against exact booked movements", () => {
    const result = assessAccountCoverage({
      period,
      relatedPeriods: [period],
      checkpoints,
      transactions: [expense, {
        ...expense,
        id: "booked-refund",
        bookedAtIso: "2026-05-18T00:00:00Z",
        amountMinor: 5_000,
      }],
      pendingObservations: [],
      importJobs: [],
      evaluatedAtIso: "2026-06-03T00:00:00Z",
    });

    expect(result.differenceMinor).toBe(0);
    expect(result.reconciliationStatus).toBe("matched");
  });

  it("includes both period boundary dates and excludes movements outside the period", () => {
    const result = assessAccountCoverage({
      period,
      relatedPeriods: [period],
      checkpoints,
      transactions: [
        { ...expense, id: "before-period", bookedAtIso: "2026-04-30T23:59:59Z", amountMinor: -30_000 },
        { ...expense, id: "start-date", bookedAtIso: "2026-05-01T00:00:00Z", amountMinor: -1_000 },
        { ...expense, id: "mid-period", amountMinor: -10_000 },
        { ...expense, id: "end-date", bookedAtIso: "2026-05-31T23:59:59Z", amountMinor: 3_500 },
        { ...expense, id: "after-period", bookedAtIso: "2026-06-01T00:00:00Z", amountMinor: 40_000 },
      ],
      pendingObservations: [],
      importJobs: [],
      evaluatedAtIso: "2026-06-03T00:00:00Z",
    });

    expect(result.differenceMinor).toBe(0);
    expect(result.reconciliationStatus).toBe("matched");
  });

  it("reports a 500-minor-unit mismatch without changing the booked movements", () => {
    const result = assessAccountCoverage({
      period,
      relatedPeriods: [period],
      checkpoints: checkpoints.map((checkpoint) =>
        checkpoint.id === "closing" ? { ...checkpoint, balanceMinor: 93_000 } : checkpoint
      ),
      transactions: [expense, {
        ...expense,
        id: "booked-refund",
        bookedAtIso: "2026-05-18T00:00:00Z",
        amountMinor: 5_000,
      }],
      pendingObservations: [],
      importJobs: [],
      evaluatedAtIso: "2026-06-03T00:00:00Z",
    });

    expect(result.differenceMinor).toBe(500);
    expect(result.reconciliationStatus).toBe("mismatch");
  });

  it("excludes pending observations and counts their matched booked transaction once", () => {
    const pendingObservation = {
      id: "pending-bill",
      householdId: "household",
      accountId: "account-nok",
      transactionDateIso: "2026-05-12",
      amountMinor: -12_500,
      merchantRaw: "Synthetic bill",
      sourceRowIndex: 1,
      currencyCode: "NOK",
      sourceType: "csv" as const,
      status: "confirmed" as const,
      sourceStatus: "Bekreftet" as const,
      reconciledTransactionId: "booked-expense",
      reconciledAtIso: "2026-05-13T00:00:00Z",
    };

    const result = assessAccountCoverage({
      period,
      relatedPeriods: [period],
      checkpoints: checkpoints.map((checkpoint) =>
        checkpoint.id === "closing" ? { ...checkpoint, balanceMinor: 87_500 } : checkpoint
      ),
      transactions: [expense],
      pendingObservations: [pendingObservation],
      importJobs: [],
      evaluatedAtIso: "2026-06-03T00:00:00Z",
    });

    expect(result.differenceMinor).toBe(0);
  });

  it("keeps an unconfirmed transaction-free period unknown while identifying it as empty", () => {
    const unconfirmedPeriod = {
      id: period.id,
      accountId: period.accountId,
      startDateIso: period.startDateIso,
      endDateIso: period.endDateIso,
      currencyCode: period.currencyCode,
      sourceName: period.sourceName,
      sourceType: period.sourceType,
      confirmed: false,
    };
    const result = assessAccountCoverage({
      period: unconfirmedPeriod,
      relatedPeriods: [unconfirmedPeriod],
      checkpoints,
      transactions: [],
      pendingObservations: [],
      importJobs: [],
      evaluatedAtIso: "2026-06-03T00:00:00Z",
    });

    expect(result.coverageStatus).toBe("unknown");
    expect(result.periodStatus).toBe("empty");
  });

  it("distinguishes overlapping periods and late imports", () => {
    const overlapping = assessAccountCoverage({
      period,
      relatedPeriods: [period, { ...period, id: "period-overlap", startDateIso: "2026-05-20" }],
      checkpoints,
      transactions: [expense],
      pendingObservations: [],
      importJobs: [],
      evaluatedAtIso: "2026-06-03T00:00:00Z",
    });
    const lateImport = assessAccountCoverage({
      period: { ...period, importedAtIso: "2026-06-04T00:00:00Z" },
      relatedPeriods: [{ ...period, importedAtIso: "2026-06-04T00:00:00Z" }],
      checkpoints,
      transactions: [expense],
      pendingObservations: [],
      importJobs: [],
      evaluatedAtIso: "2026-06-05T00:00:00Z",
    });

    expect(overlapping.periodStatus).toBe("overlapping");
    expect(lateImport.periodStatus).toBe("late-arriving");
  });

  it("distinguishes missing and stale checkpoints", () => {
    const missing = assessAccountCoverage({
      period,
      relatedPeriods: [period],
      checkpoints: [],
      transactions: [expense],
      pendingObservations: [],
      importJobs: [],
      evaluatedAtIso: "2026-06-03T00:00:00Z",
    });
    const stale = assessAccountCoverage({
      period,
      relatedPeriods: [period],
      checkpoints: checkpoints.map((checkpoint) => ({
        ...checkpoint,
        dateIso: "2026-04-30",
      })),
      transactions: [expense],
      pendingObservations: [],
      importJobs: [],
      evaluatedAtIso: "2026-06-03T00:00:00Z",
    });

    expect(missing.checkpointStatus).toBe("missing");
    expect(stale.checkpointStatus).toBe("stale");
  });
});
