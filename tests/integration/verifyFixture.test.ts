import { describe, expect, it } from "vitest";
import { verifyFixture } from "../../src/tooling/fixtures/verifyFixture.js";

describe("verifyFixture", () => {
  it("accepts the committed synthetic fixture", () => {
    const report = verifyFixture({
      inputPath: "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv"
    });

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.stats.rowCount).toBeGreaterThan(0);
    expect(report.stats.nonNokRowCount).toBeGreaterThan(0);
  });

  it("flags near-duplicate merchant variants as warnings", () => {
    const report = verifyFixture({
      inputPath: "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv"
    });

    expect(
      report.warnings.some((warning) => warning.includes("Near-duplicate merchant variants"))
    ).toBe(true);
  });
});