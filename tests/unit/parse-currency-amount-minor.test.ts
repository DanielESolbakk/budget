import { describe, expect, it } from "vitest";
import { parseCurrencyAmountMinor } from "../../src/renderer/workspaces/parseCurrencyAmountMinor.js";

describe("currency amount input parsing", () => {
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
