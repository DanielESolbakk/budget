import { describe, expect, it } from "vitest";
import { previewSameMerchantPropagation } from "../../src/app/reviewQueue.js";

const household = {
  id: "hh-propagation",
  name: "Propagation Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const sourceTransaction = {
  id: "tx-corrected",
  householdId: household.id,
  accountId: "account-checking",
  bookedAtIso: "2026-05-01T00:00:00Z",
  amountMinor: -1200,
  merchantRaw: "REMA 1000 AS",
  categoryId: "groceries",
};

const accounts = [
  {
    id: "account-checking",
    householdId: household.id,
    name: "Brukskonto",
    currencyCode: "NOK",
  },
  {
    id: "account-savings",
    householdId: household.id,
    name: "Sparekonto",
    currencyCode: "NOK",
  },
];

const uncategorizedTransactions = [
  {
    id: "tx-later",
    householdId: household.id,
    accountId: "account-savings",
    bookedAtIso: "2026-05-04T00:00:00Z",
    amountMinor: -890,
    merchantRaw: "REMA 1000 ASA",
  },
  {
    id: "tx-earlier",
    householdId: household.id,
    accountId: "account-checking",
    bookedAtIso: "2026-05-02T00:00:00Z",
    amountMinor: -710,
    merchantRaw: "Rema   1000",
  },
  {
    id: "tx-unrelated",
    householdId: household.id,
    accountId: "account-checking",
    bookedAtIso: "2026-05-03T00:00:00Z",
    amountMinor: -500,
    merchantRaw: "Stavanger Taxi",
  },
  {
    id: "tx-already-categorized",
    householdId: household.id,
    accountId: "account-checking",
    bookedAtIso: "2026-05-03T00:00:00Z",
    amountMinor: -400,
    merchantRaw: "REMA 1000",
    categoryId: "transport",
  },
  {
    id: "tx-other-household",
    householdId: "hh-other",
    accountId: "account-other",
    bookedAtIso: "2026-05-03T00:00:00Z",
    amountMinor: -300,
    merchantRaw: "REMA 1000",
  },
];

const database = {
  getTransactionById: (transactionId: string) =>
    transactionId === sourceTransaction.id ? sourceTransaction : undefined,
  listMerchantCorrectionProvenance: () => [{
    id: "correction-1",
    sourceTransactionId: sourceTransaction.id,
    merchantAlias: "REMA 1000",
    categoryId: "groceries",
    correctedAtIso: "2026-05-05T00:00:00Z",
  }],
  listMerchantCategoryRules: () => [{ merchantAlias: "REMA 1000", categoryId: "groceries" }],
  listUncategorizedTransactions: () => uncategorizedTransactions,
  getAccountsForHousehold: () => accounts,
};

describe("same-merchant propagation preview", () => {
  it("previews only uncategorized same-alias rows in stable order with account and category details", () => {
    expect(previewSameMerchantPropagation(database, sourceTransaction.id)).toEqual({
      sourceTransactionId: "tx-corrected",
      merchantAlias: "REMA 1000",
      categoryId: "groceries",
      candidates: [
        {
          transactionId: "tx-earlier",
          bookedAtIso: "2026-05-02T00:00:00Z",
          merchantRaw: "Rema   1000",
          accountName: "Brukskonto",
          amountMinor: -710,
          proposedCategoryId: "groceries",
        },
        {
          transactionId: "tx-later",
          bookedAtIso: "2026-05-04T00:00:00Z",
          merchantRaw: "REMA 1000 ASA",
          accountName: "Sparekonto",
          amountMinor: -890,
          proposedCategoryId: "groceries",
        },
      ],
    });
  });
});