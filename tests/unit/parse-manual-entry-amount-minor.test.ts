import { describe, expect, it } from "vitest";
import { parseManualEntryAmountMinor } from "../../src/renderer/import/manualEntryAmount.js";

describe("manual entry amount parsing", () => {
  it.each([
    ["12,50", 1_250],
    ["12.50", 1_250],
    ["-12,50", -1_250],
    ["0", 0],
  ])("converts NOK amount %s to signed minor units", (input, expected) => {
    expect(parseManualEntryAmountMinor(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "--1", "90071992547410.00"])(
    "rejects malformed or unsafe NOK amount %s",
    (input) => {
      expect(parseManualEntryAmountMinor(input)).toBeNull();
    }
  );
});
