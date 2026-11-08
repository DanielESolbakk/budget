import { describe, expect, it } from "vitest";
import { addMinorUnits } from "../../src/domain/money/minorUnits.js";

describe("safe minor-unit sum", () => {
  it("guards the sum rather than introducing stricter operand validation", () => {
    expect(addMinorUnits(0.25, 0.75, "synthetic range error")).toBe(1);
    expect(Object.is(addMinorUnits(-0, -0, "synthetic range error"), -0)).toBe(true);
  });
  it.each([[100, -75, 25], [Number.MAX_SAFE_INTEGER - 1, 1, Number.MAX_SAFE_INTEGER],
    [-Number.MAX_SAFE_INTEGER + 1, -1, -Number.MAX_SAFE_INTEGER]])(
    "adds %s and %s without changing supported sums",
    (left, right, expected) => expect(addMinorUnits(left, right, "synthetic range error")).toBe(expected)
  );
  it.each([[Number.MAX_SAFE_INTEGER, 1], [-Number.MAX_SAFE_INTEGER, -1], [0.25, 0], [Infinity, 0]])(
    "rejects unsupported sum of %s and %s with the caller's error",
    (left, right) => expect(() => addMinorUnits(left, right, "Spendable cash exceeds the safe integer range."))
      .toThrow(new RangeError("Spendable cash exceeds the safe integer range."))
  );
});
