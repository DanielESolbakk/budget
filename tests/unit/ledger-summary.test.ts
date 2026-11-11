import { describe, expect, it } from "vitest";
import { buildLedgerSummary, haveSameTransactionFilters } from "../../src/shared/ledgerSummary.js";
import type { Account, ExchangeRate, Transaction } from "../../src/domain/types.js";
import { parseTransactionFilters, parseTransactionQuery } from "../../electron/ipc/validation.js";

const accounts: Account[] = [
  { id: "account", householdId: "household", name: "Brukskonto", currencyCode: "NOK" },
];
const rates: ExchangeRate[] = [
  { id: "eur", currencyCode: "EUR", rateNokPerUnit: "11.50", effectiveDate: "2026-01-01", kind: "dated", source: "Synthetic", provenance: "manual" },
  { id: "later", currencyCode: "EUR", rateNokPerUnit: "12", effectiveDate: "2026-03-01", kind: "dated", source: "Synthetic", provenance: "manual" },
];
const transactions: Transaction[] = [
  { id: "salary", householdId: "household", accountId: "account", bookedAtIso: "2026-01-25", amountMinor: 300000, merchantRaw: "Synthetic salary" },
  { id: "kiwi", householdId: "household", accountId: "account", bookedAtIso: "2026-02-01", amountMinor: -50000, merchantRaw: "Kiwi Stavanger" },
  { id: "rema", householdId: "household", accountId: "account", bookedAtIso: "2026-02-24", amountMinor: -10000, currencyCode: "EUR", merchantRaw: "Rema 1000" },
];

describe("filtered ledger summaries", () => {
  it("preserves report date basis across query and saved-filter validation and rejects unsupported bases", () => {
    const filters = { bookedFromIso: "2026-01-25", bookedToIso: "2026-02-24", dateBasis: "booking-date" };
    expect(parseTransactionQuery(filters)).toEqual(filters);
    expect(parseTransactionFilters(filters)).toEqual(filters);
    expect(() => parseTransactionQuery({ dateBasis: "unknown" })).toThrow("dateBasis");
  });

  it("uses dated conversion across months without changing native amounts or input order", () => {
    const before = structuredClone(transactions);
    for (const input of [transactions, [...transactions].reverse()]) {
      expect(buildLedgerSummary(input, accounts, rates)).toMatchObject({
        incomeMinor: 300000, expenseMinor: 165000, netMinor: 135000,
        incompleteCurrencies: [],
        nativeSubtotals: [
          { currencyCode: "EUR", totalMinor: -10000 },
          { currencyCode: "NOK", totalMinor: 250000 },
        ],
      });
    }
    expect(transactions).toEqual(before);
  });

  it("excludes missing-rate currencies from NOK amounts and preserves their native subtotal", () => {
    expect(buildLedgerSummary([
      ...transactions,
      { ...transactions[2]!, id: "sek", currencyCode: "SEK" },
    ], accounts, rates)).toMatchObject({
      incomeMinor: 300000, expenseMinor: 165000, netMinor: 135000,
      incompleteCurrencies: ["SEK"],
      nativeSubtotals: expect.arrayContaining([{ currencyCode: "SEK", totalMinor: -10000 }]),
    });
    expect(buildLedgerSummary([], accounts, rates)).toMatchObject({
      incomeMinor: 0, expenseMinor: 0, netMinor: 0, incompleteCurrencies: [],
    });
  });

  it("rounds each converted transaction and ignores future rates", () => {
    expect(buildLedgerSummary([
      { ...transactions[2]!, amountMinor: -1 },
      { ...transactions[2]!, id: "second", amountMinor: -1 },
    ], accounts, rates)).toMatchObject({ incomeMinor: 0, expenseMinor: 24, netMinor: -24 });
    expect(buildLedgerSummary(transactions, accounts, [rates[1]!])).toMatchObject({
      incomeMinor: 300000, expenseMinor: 50000, netMinor: 250000, incompleteCurrencies: ["EUR"],
    });
  });

  it("rejects unsafe income or expense aggregates even when the native net is safe", () => {
    for (const sign of [-1, 1]) {
      expect(() => buildLedgerSummary([
        { ...transactions[0]!, id: "a", amountMinor: -sign * Number.MAX_SAFE_INTEGER },
        { ...transactions[0]!, id: "b", amountMinor: sign * Number.MAX_SAFE_INTEGER },
        { ...transactions[0]!, id: "c", amountMinor: sign },
      ], accounts, [])).toThrow("Ledger NOK totals exceed the safe integer range.");
    }
  });

  it("compares every active filter independent of property order and query-only pagination", () => {
    const original = { bookedFromIso: "2026-01-25", bookedToIso: "2026-02-24" };
    const sorted = { ...original, page: 2, sortBy: "amountMinor" as const };
    expect(haveSameTransactionFilters(original, sorted)).toBe(true);
    expect(haveSameTransactionFilters(original, { bookedToIso: original.bookedToIso, bookedFromIso: original.bookedFromIso })).toBe(true);
    for (const change of [
      { merchant: "Kiwi" }, { categoryId: "groceries" }, { amountFromMinor: 0 },
      { accountId: "other" }, { datePreset: "thisMonth" as const }, { uncategorizedOnly: true },
      { transactionType: "income" as const }, { largeTransactionsOnly: true }, { bookedToIso: "2026-02-23" },
      { dateBasis: "booking-date" as const },
    ]) {
      expect(haveSameTransactionFilters(original, { ...original, ...change })).toBe(false);
    }
  });
});
