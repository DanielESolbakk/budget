import { describe, expect, it } from "vitest";
import { parseCurrencyAmountMinor } from "../../src/renderer/workspaces/parseCurrencyAmountMinor.js";

describe("currency amount input parsing", () => {
  it.each([
    ["90071992547409.90", Number.MAX_SAFE_INTEGER - 1],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
    ["90071992547409.92", null],
  ])("retains exact boundary digits in %s", (input, expected) => {
    expect(parseCurrencyAmountMinor(input)).toBe(expected);
  });

  it.each(["-0.05", "+1", "1 000", "1\u00a0000", "1.2.3", "1,2,3", "1e2"])(
    "preserves unsigned ungrouped input policy for %s", (input) => {
      expect(parseCurrencyAmountMinor(input)).toBeNull();
    }
  );
  it("converts whole amounts and decimal comma or point to minor units", () => {
    expect(parseCurrencyAmountMinor("3000000")).toBe(300_000_000);
    expect(parseCurrencyAmountMinor("123.45")).toBe(12_345);
    expect(parseCurrencyAmountMinor("123,45")).toBe(12_345);
  });

  it.each(["", "abc", "-1", "1.234", "90071992547410"])(
    "rejects invalid or unsafe amount input %s",
    (value) => {
      expect(parseCurrencyAmountMinor(value)).toBeNull();
    }
  );
});
