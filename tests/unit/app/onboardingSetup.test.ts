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

  it.each([
    ["householdName", { householdName: " ", accountName: "Checking", currencyCode: "NOK" }, "Enter a household name."],
    ["accountName", { householdName: "Household", accountName: " ", currencyCode: "NOK" }, "Enter an account name."],
    ["currencyCode", { householdName: "Household", accountName: "Checking", currencyCode: "N!" }, "Enter a three-letter currency code, such as NOK."],
    ["accountName", { householdName: "Household", accountName: "A".repeat(101), currencyCode: "NOK" }, "Use 100 characters or fewer for the account name."],
  ])("identifies %s so setup can associate the error with its field", (field, input, message) => {
    let thrown: unknown;
    try {
      normalizeHouseholdSetupInput(input);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ field, message });
  });
});
