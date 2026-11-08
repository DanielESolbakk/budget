import { describe, expect, it } from "vitest";
import {
  formatMinorUnits,
  minorUnitsToDecimal,
  parseDecimalMinorUnits,
} from "../../src/domain/money/minorUnits.js";
import {
  parseSignedAmountMinor,
  parseReserveMinor,
  parseScenarioAmountMinor,
} from "../../src/renderer/amountInputs.js";
import { parseNokAmountMinor } from "../../src/renderer/parseNokAmountMinor.js";
import { parseNokAmountToMinor } from "../../src/domain/ledger/filterTransactions.js";
import { parseCurrencyAmountMinor } from "../../src/renderer/workspaces/parseCurrencyAmountMinor.js";

describe("exact two-decimal minor units", () => {
  it.each([
    [Number.MAX_SAFE_INTEGER - 1, "90071992547409.90"],
    [Number.MAX_SAFE_INTEGER, "90071992547409.91"],
    [-Number.MAX_SAFE_INTEGER, "-90071992547409.91"],
    [-5, "-0.05"],
    [0, "0.00"],
    [123456, "1234.56"],
  ])("serializes %s without rounding or grouping", (minor, decimal) => {
    expect(minorUnitsToDecimal(minor)).toBe(decimal);
    expect(parseDecimalMinorUnits(decimal)).toBe(minor);
    expect(parseSignedAmountMinor(decimal)).toBe(minor);
  });

  it.each(["90071992547409.92", "-90071992547409.92", "1.234", "+1", "1,2", "1e2", "1 000"])(
    "rejects values outside the decimal core: %s", (input) => {
      expect(parseDecimalMinorUnits(input)).toBeNull();
    }
  );

  it.each([
    ["-0,05", -5], ["1234.56", 123456], ["0", 0],
    ["-90071992547409.90", -Number.MAX_SAFE_INTEGER + 1],
    ["-90071992547409.91", -Number.MAX_SAFE_INTEGER],
    ["-90071992547409.92", null],
    ["1 000", null], ["+1", null], ["1.2.3", null], ["1,2,3", null],
  ])("preserves signed ungrouped policy: %s", (input, expected) => {
    expect(parseSignedAmountMinor(input)).toBe(expected);
  });

  it("preserves distinct grouping and sign policies", () => {
    for (const space of [" ", "\u00a0", "\u202f"]) {
      expect(parseNokAmountMinor(`1${space}234,56`)).toBe(123456);
      expect(parseNokAmountToMinor(`1${space}234,56`)).toBe(123456);
      expect(parseCurrencyAmountMinor(`1${space}234,56`)).toBeNull();
      expect(parseSignedAmountMinor(`1${space}234,56`)).toBeNull();
      expect(parseNokAmountMinor(`12${space}34,56`)).toBe(123456);
      expect(parseNokAmountToMinor(`12${space}34,56`)).toBeNull();
    }
    expect(parseCurrencyAmountMinor("-0.05")).toBeNull();
    expect(parseSignedAmountMinor("-0.05")).toBe(-5);
    expect(parseCurrencyAmountMinor("12,34")).toBe(1234);
  });

  it("preserves formatter-specific code, sign and grouping presentation", () => {
    const decimal = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const symbol = new Intl.NumberFormat("nb-NO", {
      style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
    });

    expect(formatMinorUnits(Number.MAX_SAFE_INTEGER, decimal).replace(/\s/g, " "))
      .toBe("90 071 992 547 409,91");
    expect(formatMinorUnits(-5, symbol).replace(/\s/g, " ")).toBe("\u22120,05 USD");
    expect(formatMinorUnits(0, decimal)).toBe("0,00");
  });

  it("formats internal allocation draft totals beyond the public number range exactly", () => {
    const formatter = new Intl.NumberFormat("nb-NO", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    expect(formatMinorUnits(-18_014_398_509_481_982n, formatter).replace(/\s/g, " "))
      .toBe("\u2212180 143 985 094 819,82");
  });

  it.each([NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid public minor-unit numbers: %s", (minor) => {
      expect(() => minorUnitsToDecimal(minor)).toThrow(RangeError);
      expect(() => formatMinorUnits(minor, new Intl.NumberFormat("nb-NO"))).toThrow(RangeError);
    }
  );
});

describe("reserve and scenario Number-input compatibility", () => {
  it.each([
    ["+12.50", 1250], ["1.25e2", 12500], [".5", 50], ["1.", 100],
    ["0x10", 1600], ["0b10", 200], ["0o10", 800],
    ["1.000000001", 100], ["0.000000001", 0],
    ["90071992547409.90", Number.MAX_SAFE_INTEGER - 1],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
    ["9.007199254740990e13", Number.MAX_SAFE_INTEGER - 1],
  ])("retains Number syntax while preserving decimal digits: %s", (input, expected) => {
    expect(parseReserveMinor(input)).toBe(expected);
    expect(parseScenarioAmountMinor(input)).toBe(expected);
  });

  it.each(["", "NaN", "Infinity", "-1", "1,2", "1 000", "1.001", "90071992547409.92"])(
    "rejects invalid reserve/scenario inputs: %s", (input) => {
      expect(() => parseReserveMinor(input)).toThrow("Reserve must be");
      expect(() => parseScenarioAmountMinor(input)).toThrow("Enter a positive amount");
    }
  );

  it("keeps reserve zero and scenario positive-source policies", () => {
    expect(parseReserveMinor("0")).toBe(0);
    expect(Object.is(parseReserveMinor("-0"), -0)).toBe(true);
    expect(() => parseScenarioAmountMinor("0")).toThrow();
    expect(parseReserveMinor("1e-10000")).toBe(0);
    expect(() => parseScenarioAmountMinor("1e-10000")).toThrow();
  });
});
