import { describe, expect, it } from "vitest";
import {
  createRecurringCommitmentPaymentSearchIndex,
} from "../../src/renderer/dashboard/recurringCommitmentSearch.js";
import type { RecurringCommitmentPaymentCandidate } from "../../src/domain/types.js";

const electricityPayment: RecurringCommitmentPaymentCandidate = {
  id: "payment-electricity",
  sourceType: "transaction",
  dateIso: "2026-03-31",
  amountMinor: -12_900,
  currencyCode: "NOK",
  description: "Electricity bill",
};

const pendingElectricityPayment: RecurringCommitmentPaymentCandidate = {
  id: "payment-electricity-pending",
  sourceType: "pending",
  dateIso: "2026-04-30",
  amountMinor: -13_100,
  currencyCode: "NOK",
  description: "Electricity bill",
};

const euroElectricityPayment: RecurringCommitmentPaymentCandidate = {
  id: "payment-electricity-eur",
  sourceType: "transaction",
  dateIso: "2026-03-31",
  amountMinor: -12_900,
  currencyCode: "EUR",
  description: "Electricity bill",
};

function createSearchIndex() {
  return createRecurringCommitmentPaymentSearchIndex([
    {
      candidate: electricityPayment,
      searchText: "Electricity bill 2026-03-31 129,00 kr transaction",
    },
    {
      candidate: pendingElectricityPayment,
      searchText: "Electricity bill 2026-04-30 131,00 kr pending",
    },
    {
      candidate: euroElectricityPayment,
      searchText: "Electricity bill 2026-03-31 EUR 129,00 transaction",
    },
  ]);
}

describe("recurring commitment payment search", () => {
  it("matches descriptions, dates, amounts, and source types within a currency", () => {
    const index = createSearchIndex();

    expect(index.search("NOK", " ELECTRICITY ")).toEqual([
      electricityPayment,
      pendingElectricityPayment,
    ]);
    expect(index.search("NOK", "2026-03-31")).toEqual([
      electricityPayment,
    ]);
    expect(index.search("NOK", "129,00 KR")).toEqual([
      electricityPayment,
    ]);
    expect(index.search("NOK", "PENDING")).toEqual([
      pendingElectricityPayment,
    ]);
    expect(index.search("EUR", "electricity")).toEqual([
      euroElectricityPayment,
    ]);
  });

  it("rejects candidates that only share a query bigram", () => {
    expect(
      createSearchIndex().search("NOK", "electricity internet")
    ).toEqual([]);
  });

  it("does not return results for searches shorter than two characters", () => {
    expect(
      createSearchIndex().search("NOK", "e")
    ).toEqual([]);
  });
});
