import { describe, expect, it } from "vitest";
import { formatCurrencyAmount, formatCurrencySymbolAmount } from "../../src/renderer/formatCurrencyAmount.js";

describe("recorded currency presentation", () => {
  it.each([
    [Number.MAX_SAFE_INTEGER, "90 071 992 547 409,91 EUR"],
    [-Number.MAX_SAFE_INTEGER, "\u221290 071 992 547 409,91 EUR"],
    [-5, "\u22120,05 EUR"],
  ])("retains exact minor units in %s", (minor, expected) => {
    expect(formatCurrencyAmount(minor, "EUR").replace(/\s/g, " ")).toBe(expected);
  });

  it.each([NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid minor-unit numbers: %s", (minor) => {
      expect(() => formatCurrencyAmount(minor, "NOK")).toThrow(RangeError);
    }
  );
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

  it.each([
    ["NOK", "12,51 kr"],
    ["EUR", "12,51 \u20ac"],
    ["GBP", "12,51 \u00a3"],
    ["USD", "12,51 USD"],
  ])("keeps forecast symbol presentation distinct for %s", (code, expected) => {
    expect(formatCurrencySymbolAmount(1251, code).replace(/\s/g, " ")).toBe(expected);
  });

  it("retains symbol-mode precision and recorded negative zero", () => {
    expect(formatCurrencySymbolAmount(Number.MAX_SAFE_INTEGER, "EUR").replace(/\s/g, " "))
      .toBe("90 071 992 547 409,91 \u20ac");
    expect(formatCurrencyAmount(-0, "NOK").replace(/\s/g, " ")).toBe("\u22120,00 kr");
  });
});
