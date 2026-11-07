import { describe, expect, it } from "vitest";
import { parseNokAmountMinor } from "../../src/renderer/parseNokAmountMinor.js";

describe("shared NOK amount parsing", () => {
  it.each([
    ["12,50", 1_250],
    ["12.50", 1_250],
    ["-12,50", -1_250],
    ["0", 0],
    ["12.5", 1_250],
    [" 1 250,05 ", 125_005],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
    ["-90071992547409.91", -Number.MAX_SAFE_INTEGER],
  ])("converts NOK amount %s to signed minor units", (input, expected) => {
    expect(parseNokAmountMinor(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "--1", "90071992547410.00", "90071992547409.92", "-90071992547409.92"])(
    "rejects malformed or unsafe NOK amount %s",
    (input) => {
      expect(parseNokAmountMinor(input)).toBeNull();
    }
  );
});
