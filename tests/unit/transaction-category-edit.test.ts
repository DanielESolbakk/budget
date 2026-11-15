import { describe, expect, it } from "vitest";
import type { Transaction } from "../../src/domain/types.js";
import {
  decideTransactionCategoryEdit,
  isTransactionCategoryEditStateCurrent,
  type TransactionCategoryEditExpectedState,
} from "../../src/shared/transactionCategoryEdit.js";

const transaction: Transaction = {
  id: "tx-category-edit",
  householdId: "hh-category-edit",
  accountId: "acc-category-edit",
  bookedAtIso: "2026-05-01T00:00:00Z",
  amountMinor: -10_000,
  merchantRaw: "MENY AS",
  currencyCode: "NOK",
  sourceType: "manual",
  categoryId: "groceries",
};

const categories = ["groceries", "fuel", "housing"];

describe("transaction category edit decisions", () => {
  it("allows a rule-only save when the selected category is unchanged", () => {
    expect(decideTransactionCategoryEdit({
      mode: "single",
      transaction,
      merchantAlias: "MENY",
      merchantCategoryRule: null,
      categoryId: "groceries",
      rememberForMerchant: true,
    }, categories)).toMatchObject({
      transactionChanged: false,
      merchantRuleEffect: "updated",
      shouldWrite: true,
    });
  });

  it("reports an already-matching rule without scheduling a duplicate correction write", () => {
    expect(decideTransactionCategoryEdit({
      mode: "single",
      transaction,
      merchantAlias: "MENY",
      merchantCategoryRule: { merchantAlias: "MENY", categoryId: "groceries" },
      categoryId: "groceries",
      rememberForMerchant: true,
    }, categories)).toMatchObject({
      transactionChanged: false,
      merchantRuleEffect: "already-matching",
      shouldWrite: false,
    });
  });

  it("does not write an unchanged category when remembering is not requested", () => {
    expect(decideTransactionCategoryEdit({
      mode: "single",
      transaction,
      merchantAlias: "MENY",
      merchantCategoryRule: null,
      categoryId: "groceries",
      rememberForMerchant: false,
    }, categories)).toMatchObject({
      transactionChanged: false,
      merchantRuleEffect: "not-requested",
      shouldWrite: false,
    });
  });

  it("changes only this transaction when remembering is explicitly disabled", () => {
    expect(decideTransactionCategoryEdit({
      mode: "single",
      transaction,
      merchantAlias: "MENY",
      merchantCategoryRule: { merchantAlias: "MENY", categoryId: "fuel" },
      categoryId: "housing",
      rememberForMerchant: false,
    }, categories)).toMatchObject({
      transactionChanged: true,
      merchantRuleEffect: "not-requested",
      shouldWrite: true,
    });
  });

  it("keeps an empty alias transaction-only even if a stale client requests remembering", () => {
    expect(decideTransactionCategoryEdit({
      mode: "single",
      transaction,
      merchantAlias: "",
      merchantCategoryRule: null,
      categoryId: "housing",
      rememberForMerchant: true,
    }, categories)).toMatchObject({
      transactionChanged: true,
      merchantRuleEffect: "unavailable",
      shouldWrite: true,
    });
  });

  it("rejects split requests that also ask for single-category merchant learning", () => {
    expect(() => decideTransactionCategoryEdit({
      mode: "split",
      transaction,
      merchantAlias: "MENY",
      merchantCategoryRule: null,
      allocations: [
        { categoryId: "groceries", amountMinor: -6_000 },
        { categoryId: "fuel", amountMinor: -4_000 },
      ],
      rememberForMerchant: true,
    }, categories)).toThrow(/split.*remember/i);
  });

  it("rejects invalid categories and allocations before producing edit effects", () => {
    expect(() => decideTransactionCategoryEdit({
      mode: "single",
      transaction,
      merchantAlias: "MENY",
      merchantCategoryRule: null,
      categoryId: "missing",
      rememberForMerchant: false,
    }, categories)).toThrow(/category/i);
    expect(() => decideTransactionCategoryEdit({
      mode: "split",
      transaction,
      merchantAlias: "MENY",
      merchantCategoryRule: null,
      allocations: [
        { categoryId: "groceries", amountMinor: -6_000 },
        { categoryId: "fuel", amountMinor: -3_000 },
      ],
      rememberForMerchant: false,
    }, categories)).toThrow(/sum exactly/i);
  });

  it("rejects an edit opened before the transaction, rule, or database generation changed", () => {
    const expectedState: TransactionCategoryEditExpectedState = {
      databaseGeneration: 4,
      transaction,
      merchantCategoryRule: { merchantAlias: "MENY", categoryId: "groceries" },
    };

    expect(isTransactionCategoryEditStateCurrent(expectedState, {
      ...expectedState,
      databaseGeneration: 5,
    })).toBe(false);
    expect(isTransactionCategoryEditStateCurrent(expectedState, {
      ...expectedState,
      transaction: { ...transaction, amountMinor: -9_900 },
    })).toBe(false);
    expect(isTransactionCategoryEditStateCurrent(expectedState, {
      ...expectedState,
      merchantCategoryRule: { merchantAlias: "MENY", categoryId: "fuel" },
    })).toBe(false);
    expect(isTransactionCategoryEditStateCurrent(expectedState, expectedState)).toBe(true);
  });
});
