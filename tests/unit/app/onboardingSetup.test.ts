import { describe, expect, it } from "vitest";
import { normalizeHouseholdSetupInput } from "../../../src/app/onboarding/householdSetup.js";

describe("normalizeHouseholdSetupInput", () => {
  it("trims household and account names and normalizes currency", () => {
    expect(
      normalizeHouseholdSetupInput({
        householdName: "  Test Household  ",
        accountName: "  Checking  ",
        currencyCode: "nok",
      })
    ).toEqual({
      householdName: "Test Household",
      accountName: "Checking",
      currencyCode: "NOK",
    });
  });

  it.each([
    ["not an object", null],
    ["whitespace household name", { householdName: " ", accountName: "Checking", currencyCode: "NOK" }],
    ["whitespace account name", { householdName: "Household", accountName: "\t", currencyCode: "NOK" }],
    ["malformed currency", { householdName: "Household", accountName: "Checking", currencyCode: "NO" }],
    ["overlong name", { householdName: "H".repeat(101), accountName: "Checking", currencyCode: "NOK" }],
  ])("rejects %s", (_description, input) => {
    expect(() => normalizeHouseholdSetupInput(input)).toThrow();
  });
});
