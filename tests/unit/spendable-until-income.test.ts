import { describe, expect, it } from "vitest";
import { calculateSpendableUntilIncome } from "../../src/domain/forecast/spendableUntilIncome.js";
import type {
  Account,
  RecurringCommitmentScheduleOccurrence,
} from "../../src/domain/types.js";
import type { SpendableAccountBalance } from "../../src/domain/forecast/spendableUntilIncome.js";

const account: Account = {
  id: "account-nok",
  householdId: "household",
  name: "Synthetic current account",
  currencyCode: "NOK",
};

const balance: SpendableAccountBalance = {
  accountId: account.id,
  balanceMinor: 500_000,
  balanceDateIso: "2026-05-01",
  currencyCode: "NOK",
  verificationStatus: "verified",
};

const commitment: RecurringCommitmentScheduleOccurrence = {
  commitmentId: "commitment-rent",
  description: "Synthetic rent",
  dueDateIso: "2026-05-15",
  amountMinor: 60_000,
  currencyCode: "NOK",
  isEstimate: false,
  dueStatus: "upcoming",
  paymentStatus: "unmatched",
  nativeAmountMinor: 60_000,
  nativeCurrencyCode: "NOK",
  nokAmountMinor: 60_000,
  exchangeRate: null,
  conversionStatus: "converted",
};

describe("calculateSpendableUntilIncome", () => {
  it("subtracts pending debits and confirmed commitments before income, then applies the reserve", () => {
    const result = calculateSpendableUntilIncome({
      accounts: [account],
      selectedAccountIds: [account.id],
      balances: [balance],
      transactions: [],
      pendingObservations: [{
        id: "pending-electricity",
        householdId: account.householdId,
        accountId: account.id,
        transactionDateIso: "2026-05-10",
        amountMinor: -40_000,
        merchantRaw: "Synthetic electricity",
        sourceRowIndex: 1,
        currencyCode: "NOK",
        sourceType: "csv",
        status: "confirmed",
        sourceStatus: "Bekreftet",
      }],
      commitments: [commitment],
      rates: [],
      evaluatedAtIso: "2026-05-05T00:00:00.000Z",
      nextIncomeDateIso: "2026-05-20",
      reserveMinor: 50_000,
    });

    expect(result).toMatchObject({
      state: "complete",
      evaluatedAtIso: "2026-05-05T00:00:00.000Z",
      nextIncomeDateIso: "2026-05-20",
      selectedAccountIds: [account.id],
      lowestProjectedCashNokMinor: 400_000,
      spendableCashNokMinor: 350_000,
      reserveNokMinor: 50_000,
      selectedAccounts: [{
        accountId: account.id,
        accountName: account.name,
        balanceMinor: 500_000,
        currencyCode: "NOK",
        balanceDateIso: "2026-05-01",
        balanceNokMinor: 500_000,
        isEstimate: false,
      }],
    });
  });

  it("includes booked account movements recorded after the verified balance date", () => {
    const result = calculateSpendableUntilIncome({
      accounts: [account],
      selectedAccountIds: [account.id],
      balances: [balance],
      transactions: [{
        id: "transaction-internet",
        householdId: account.householdId,
        accountId: account.id,
        bookedAtIso: "2026-05-06T09:00:00.000Z",
        amountMinor: -10_000,
        merchantRaw: "Synthetic internet",
        currencyCode: "NOK",
      }],
      pendingObservations: [{
        id: "pending-electricity",
        householdId: account.householdId,
        accountId: account.id,
        transactionDateIso: "2026-05-10",
        amountMinor: -40_000,
        merchantRaw: "Synthetic electricity",
        sourceRowIndex: 1,
        currencyCode: "NOK",
        sourceType: "csv",
        status: "confirmed",
        sourceStatus: "Bekreftet",
      }],
      commitments: [commitment],
      rates: [],
      evaluatedAtIso: "2026-05-05T00:00:00.000Z",
      nextIncomeDateIso: "2026-05-20",
      reserveMinor: 50_000,
    });

    expect(result).toMatchObject({
      state: "complete",
      lowestProjectedCashNokMinor: 390_000,
      spendableCashNokMinor: 340_000,
    });
  });

  it("converts a verified foreign-currency balance using its dated local rate", () => {
    const eurAccount: Account = {
      id: "account-eur",
      householdId: account.householdId,
      name: "Synthetic EUR account",
      currencyCode: "EUR",
    };
    const result = calculateSpendableUntilIncome({
      accounts: [eurAccount],
      selectedAccountIds: [eurAccount.id],
      balances: [{
        accountId: eurAccount.id,
        balanceMinor: 10_000,
        balanceDateIso: "2026-05-01",
        currencyCode: "EUR",
        verificationStatus: "verified",
      }],
      transactions: [],
      pendingObservations: [],
      commitments: [],
      rates: [{
        id: "eur-dated-may",
        currencyCode: "EUR",
        rateNokPerUnit: "11.5",
        effectiveDate: "2026-04-30",
        kind: "dated",
        source: "Synthetic local rate",
        provenance: "manual",
      }],
      evaluatedAtIso: "2026-05-05T00:00:00.000Z",
      nextIncomeDateIso: "2026-05-20",
      reserveMinor: 10_000,
    });

    expect(result).toMatchObject({
      state: "complete",
      lowestProjectedCashNokMinor: 115_000,
      spendableCashNokMinor: 105_000,
    });
  });

  it("uses and identifies an explicitly selected monthly reference estimate", () => {
    const eurAccount: Account = {
      id: "account-eur",
      householdId: account.householdId,
      name: "Synthetic EUR account",
      currencyCode: "EUR",
    };
    const result = calculateSpendableUntilIncome({
      accounts: [eurAccount],
      selectedAccountIds: [eurAccount.id],
      balances: [{
        accountId: eurAccount.id,
        balanceMinor: 10_000,
        balanceDateIso: "2026-05-01",
        currencyCode: "EUR",
        verificationStatus: "verified",
      }],
      transactions: [],
      pendingObservations: [],
      commitments: [],
      rates: [{
        id: "eur-monthly-may",
        currencyCode: "EUR",
        rateNokPerUnit: "11.4",
        effectiveDate: "2026-05-01",
        kind: "monthly-reference",
        source: "Synthetic monthly estimate",
        provenance: "manual",
      }],
      monthlyReferenceRateIds: { "EUR/2026-05": "eur-monthly-may" },
      evaluatedAtIso: "2026-05-05T00:00:00.000Z",
      nextIncomeDateIso: "2026-05-20",
      reserveMinor: 0,
    });

    expect(result).toMatchObject({
      state: "complete",
      lowestProjectedCashNokMinor: 114_000,
      selectedAccounts: [{
        balanceMinor: 10_000,
        currencyCode: "EUR",
        balanceNokMinor: 114_000,
        exchangeRate: { id: "eur-monthly-may", kind: "monthly-reference" },
        isEstimate: true,
      }],
    });
  });

  it("returns an auditable native-currency breakdown of included cash movements", () => {
    const result = calculateSpendableUntilIncome({
      accounts: [account],
      selectedAccountIds: [account.id],
      balances: [balance],
      transactions: [{
        id: "transaction-internet",
        householdId: account.householdId,
        accountId: account.id,
        bookedAtIso: "2026-05-06T09:00:00.000Z",
        amountMinor: -10_000,
        merchantRaw: "Synthetic internet",
        currencyCode: "NOK",
      }],
      pendingObservations: [{
        id: "pending-electricity",
        householdId: account.householdId,
        accountId: account.id,
        transactionDateIso: "2026-05-10",
        amountMinor: -40_000,
        merchantRaw: "Synthetic electricity",
        sourceRowIndex: 1,
        currencyCode: "NOK",
        sourceType: "csv",
        status: "confirmed",
        sourceStatus: "Bekreftet",
      }],
      commitments: [commitment],
      rates: [],
      evaluatedAtIso: "2026-05-05T00:00:00.000Z",
      nextIncomeDateIso: "2026-05-20",
      reserveMinor: 50_000,
    });

    expect(result).toMatchObject({
      lineItems: [
        {
          id: "transaction-internet",
          kind: "booked-transaction",
          dateIso: "2026-05-06",
          amountMinor: -10_000,
          currencyCode: "NOK",
          amountNokMinor: -10_000,
        },
        {
          id: "pending-electricity",
          kind: "pending-debit",
          dateIso: "2026-05-10",
          amountMinor: -40_000,
          currencyCode: "NOK",
          amountNokMinor: -40_000,
        },
        {
          id: "commitment-rent",
          kind: "confirmed-commitment",
          dateIso: "2026-05-15",
          amountMinor: -60_000,
          currencyCode: "NOK",
          amountNokMinor: -60_000,
        },
      ],
      nativeSubtotals: [{
        currencyCode: "NOK",
        balanceMinor: 500_000,
        bookedMinor: -10_000,
        pendingMinor: -40_000,
        commitmentsMinor: -60_000,
      }],
    });
  });

  it("reports an incomplete estimate when a pending debit points to a missing booked transaction", () => {
    const result = calculateSpendableUntilIncome({
      accounts: [account],
      selectedAccountIds: [account.id],
      balances: [balance],
      transactions: [],
      pendingObservations: [{
        id: "pending-electricity",
        householdId: account.householdId,
        accountId: account.id,
        transactionDateIso: "2026-05-10",
        amountMinor: -40_000,
        merchantRaw: "Synthetic electricity",
        sourceRowIndex: 1,
        currencyCode: "NOK",
        sourceType: "csv",
        status: "confirmed",
        sourceStatus: "Bekreftet",
        reconciledTransactionId: "missing-booked-transaction",
      }],
      commitments: [],
      rates: [],
      evaluatedAtIso: "2026-05-05T00:00:00.000Z",
      nextIncomeDateIso: "2026-05-20",
      reserveMinor: 50_000,
    });

    expect(result).toMatchObject({
      state: "incomplete",
      spendableCashNokMinor: null,
      incompleteReasons: [expect.objectContaining({
        code: "missing-reconciled-transaction",
        accountId: account.id,
        dateIso: "2026-05-10",
      })],
    });
  });

  it("does not treat an incoming transaction as a reconciled pending debit", () => {
    const result = calculateSpendableUntilIncome({
      accounts: [account],
      selectedAccountIds: [account.id],
      balances: [balance],
      transactions: [{
        id: "transaction-refund",
        householdId: account.householdId,
        accountId: account.id,
        bookedAtIso: "2026-05-10T09:00:00.000Z",
        amountMinor: 40_000,
        merchantRaw: "Synthetic refund",
        currencyCode: "NOK",
      }],
      pendingObservations: [{
        id: "pending-electricity",
        householdId: account.householdId,
        accountId: account.id,
        transactionDateIso: "2026-05-10",
        amountMinor: -40_000,
        merchantRaw: "Synthetic electricity",
        sourceRowIndex: 1,
        currencyCode: "NOK",
        sourceType: "csv",
        status: "confirmed",
        sourceStatus: "Bekreftet",
        reconciledTransactionId: "transaction-refund",
      }],
      commitments: [],
      rates: [],
      evaluatedAtIso: "2026-05-05T00:00:00.000Z",
      nextIncomeDateIso: "2026-05-20",
      reserveMinor: 50_000,
    });

    expect(result).toMatchObject({
      state: "incomplete",
      spendableCashNokMinor: null,
      incompleteReasons: [expect.objectContaining({
        code: "invalid-reconciled-transaction",
        accountId: account.id,
        dateIso: "2026-05-10",
      })],
    });
  });

  it("includes an unreconciled pending debit dated before the evaluation date", () => {
    const result = calculateSpendableUntilIncome({
      accounts: [account],
      selectedAccountIds: [account.id],
      balances: [balance],
      transactions: [],
      pendingObservations: [{
        id: "pending-electricity",
        householdId: account.householdId,
        accountId: account.id,
        transactionDateIso: "2026-05-04",
        amountMinor: -40_000,
        merchantRaw: "Synthetic electricity",
        sourceRowIndex: 1,
        currencyCode: "NOK",
        sourceType: "csv",
        status: "confirmed",
        sourceStatus: "Bekreftet",
      }],
      commitments: [],
      rates: [],
      evaluatedAtIso: "2026-05-05T00:00:00.000Z",
      nextIncomeDateIso: "2026-05-20",
      reserveMinor: 50_000,
    });

    expect(result).toMatchObject({
      state: "complete",
      lowestProjectedCashNokMinor: 460_000,
      spendableCashNokMinor: 410_000,
    });
  });

  it("does not project an unmatched commitment that is already past due", () => {
    const result = calculateSpendableUntilIncome({
      accounts: [account],
      selectedAccountIds: [account.id],
      balances: [balance],
      transactions: [],
      pendingObservations: [],
      commitments: [{
        ...commitment,
        dueDateIso: "2026-05-04",
      }],
      rates: [],
      evaluatedAtIso: "2026-05-05T00:00:00.000Z",
      nextIncomeDateIso: "2026-05-20",
      reserveMinor: 50_000,
    });

    expect(result).toMatchObject({
      state: "complete",
      lowestProjectedCashNokMinor: 500_000,
      spendableCashNokMinor: 450_000,
    });
  });

  it.each([
    ["stale", "stale-balance"],
    ["unverified", "unverified-balance"],
    ["missing", "missing-balance"],
  ] as const)(
    "identifies a selected account with %s balance evidence",
    (verificationStatus, reasonCode) => {
      const result = calculateSpendableUntilIncome({
        accounts: [account],
        selectedAccountIds: [account.id],
        balances: [{
          ...balance,
          balanceMinor: verificationStatus === "missing" ? null : balance.balanceMinor,
          balanceDateIso: verificationStatus === "missing" ? null : balance.balanceDateIso,
          verificationStatus,
        }],
        transactions: [],
        pendingObservations: [],
        commitments: [],
        rates: [],
        evaluatedAtIso: "2026-05-05T00:00:00.000Z",
        nextIncomeDateIso: "2026-05-20",
        reserveMinor: 0,
      });

      expect(result).toMatchObject({
        state: "incomplete",
        spendableCashNokMinor: null,
        incompleteReasons: [expect.objectContaining({
          code: reasonCode,
          accountId: account.id,
        })],
      });
    }
  );
});
