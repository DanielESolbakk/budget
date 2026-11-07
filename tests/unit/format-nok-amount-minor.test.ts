import { describe, expect, it } from "vitest";
import { formatNokAmountMinor } from "../../src/renderer/formatNokAmountMinor.js";

describe("exact NOK display", () => {
  it.each([
    [0, "0,00 kr"],
    [1, "0,01 kr"],
    [-1, "\u22120,01 kr"],
    [1_250, "12,50 kr"],
    [-1_250, "\u221212,50 kr"],
    [Number.MAX_SAFE_INTEGER, "90 071 992 547 409,91 kr"],
    [-Number.MAX_SAFE_INTEGER, "\u221290 071 992 547 409,91 kr"],
  ])("formats %s minor units without losing precision", (minor, expected) => {
    expect(formatNokAmountMinor(minor).replace(/\s/g, " ")).toBe(expected);
  });
});
