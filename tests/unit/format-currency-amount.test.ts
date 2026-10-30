import { describe, expect, it } from "vitest";
import { formatCurrencyAmount } from "../../src/renderer/formatCurrencyAmount.js";

describe("recorded currency presentation", () => {
  it.each([
    { amountMinor: -7800, currencyCode: "GBP", expected: "\u221278,00 GBP" },
    { amountMinor: 1251, currencyCode: "EUR", expected: "12,51 EUR" },
    { amountMinor: -5000, currencyCode: "SEK", expected: "\u221250,00 SEK" },
    { amountMinor: -5000, currencyCode: "DKK", expected: "\u221250,00 DKK" },
    { amountMinor: 0, currencyCode: "USD", expected: "0,00 USD" },
    { amountMinor: -4200, currencyCode: "NOK", expected: "\u221242,00 kr" },
    { amountMinor: 0, currencyCode: "NOK", expected: "0,00 kr" },
    { amountMinor: 123456789, currencyCode: "GBP", expected: "1 234 567,89 GBP" },
  ])("formats $currencyCode $amountMinor without converting the recorded amount", ({
    amountMinor, currencyCode, expected,
  }) => {
    expect(formatCurrencyAmount(amountMinor, currencyCode).replace(/\s/g, " ")).toBe(expected);
  });

  it("does not substitute NOK for an invalid currency", () => {
    expect(() => formatCurrencyAmount(100, "invalid-currency")).toThrow(RangeError);
  });
});
