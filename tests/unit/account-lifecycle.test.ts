import { describe, expect, it } from "vitest";
import {
  archiveAccount,
  AccountInputValidationError,
  normalizeAccountInput,
  normalizeAccountUpdateInput,
  selectActiveAccounts,
} from "../../src/shared/accountLifecycle.js";
import type { Account } from "../../src/domain/types.js";

describe("normalizeAccountInput", () => {
  it("trims the account name and uppercases a valid currency code", () => {
    expect(normalizeAccountInput({
      accountName: "  Savings  ",
      currencyCode: "nok",
    })).toEqual({
      accountName: "Savings",
      currencyCode: "NOK",
    });
  });

  describe("normalizeAccountUpdateInput", () => {
    it("allows a rename and currency change when the account has no history", () => {
      expect(normalizeAccountUpdateInput(
        { accountName: "  Savings  ", currencyCode: "sek" },
        "NOK",
        { transactionCount: 0, coveragePeriodCount: 0, checkpointCount: 0 }
      )).toEqual({ accountName: "Savings", currencyCode: "SEK" });
    });

    it.each([
      ["transactions", { transactionCount: 1, coveragePeriodCount: 0, checkpointCount: 0 }],
      ["statement coverage", { transactionCount: 0, coveragePeriodCount: 1, checkpointCount: 0 }],
      ["checkpoints", { transactionCount: 0, coveragePeriodCount: 0, checkpointCount: 1 }],
    ] as const)("rejects currency changes when %s exist but permits a rename", (_history, history) => {
      let thrown: unknown;
      try {
        normalizeAccountUpdateInput(
          { accountName: "Main savings", currencyCode: "SEK" },
          "NOK",
          history
        );
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AccountInputValidationError);
      expect(thrown).toMatchObject({ field: "currencyCode" });
      expect(thrown).toMatchObject({
        message: expect.stringContaining("Create another account instead."),
      });
      expect(normalizeAccountUpdateInput(
        { accountName: "Main savings", currencyCode: "NOK" },
        "NOK",
        history
      )).toEqual({ accountName: "Main savings", currencyCode: "NOK" });
    });

    it.each([
      ["missing account name", { accountName: " ", currencyCode: "NOK" }, "accountName"],
      ["malformed currency", { accountName: "Savings", currencyCode: "N!" }, "currencyCode"],
    ] as const)("keeps %s errors field-specific", (_description, input, field) => {
      let thrown: unknown;
      try {
        normalizeAccountUpdateInput(
          input,
          "NOK",
          { transactionCount: 1, coveragePeriodCount: 0, checkpointCount: 0 }
        );
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AccountInputValidationError);
      expect(thrown).toMatchObject({ field });
    });
  });

  it.each([
    ["empty name", { accountName: " ", currencyCode: "NOK" }, "accountName"],
    ["two-letter currency", { accountName: "Savings", currencyCode: "NO" }, "currencyCode"],
    ["four-letter currency", { accountName: "Savings", currencyCode: "NOKK" }, "currencyCode"],
    ["non-letter currency", { accountName: "Savings", currencyCode: "N!K" }, "currencyCode"],
  ] as const)("rejects %s with a field-specific validation error", (_description, input, field) => {
    let thrown: unknown;
    try {
      normalizeAccountInput(input);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AccountInputValidationError);
    expect(thrown).toMatchObject({ field });
  });
});

describe("account archiving", () => {
  const account: Account = {
    id: "account-checking",
    householdId: "household-test",
    name: "Checking",
    currencyCode: "NOK",
  };
  const archivedAtIso = "2026-11-12T10:00:00.000Z";

  it("archives an active account without changing its identity or currency", () => {
    const input = { ...account };
    const archived = archiveAccount(input, 2, archivedAtIso);

    expect(archived).toEqual({
      ...account,
      archivedAtIso,
    });
    expect(input).toEqual(account);
  });

  it("rejects archiving the last active account with recovery guidance", () => {
    expect(() => archiveAccount(account, 1, archivedAtIso)).toThrow(
      "Keep at least one active account. Add another account before archiving this one."
    );
  });

  it("omits archived accounts from active-account selection without reordering others", () => {
    const savings: Account = {
      ...account,
      id: "account-savings",
      name: "Savings",
    };
    const archived = {
      ...account,
      id: "account-archived",
      name: "Archived",
      archivedAtIso,
    };

    expect(selectActiveAccounts([account, archived, savings])).toEqual([account, savings]);
  });
});
