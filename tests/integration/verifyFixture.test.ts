import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyFixture } from "../../src/tooling/fixtures/verifyFixture.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function readRepositoryFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, `file://${repositoryRoot}/`), "utf8");
}

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

  it("verifies ADR and glossary artifacts are present and linked from plan.md", () => {
    const adr = readRepositoryFile(
      "docs/ways-of-work/plan/budget-planner/adr-001-stack-and-runtime-boundaries.md",
    );
    const glossary = readRepositoryFile(
      "docs/ways-of-work/plan/budget-planner/domain-glossary.md",
    );
    const planMd = readRepositoryFile("plan.md");

    expect(adr).toMatch(/^## Status\s+Accepted$/m);
    expect(adr).toMatch(
      /### Import and Parser Layer[\s\S]*source-aware parser adapters[\s\S]*parser-specific logic isolated/m,
    );
    expect(adr).toMatch(
      /## Privacy and Data Handling Constraints[\s\S]*Transaction content remains local by default[\s\S]*No background network calls for transaction workflows/m,
    );
    expect(planMd).toContain("adr-001-stack-and-runtime-boundaries.md");
    expect(planMd).toContain("domain-glossary.md");

    for (const term of [
      "household",
      "account",
      "transaction",
      "category",
      "merchant alias",
      "categorization rule",
      "import job",
      "budget target",
      "forecast assumption",
      "backup snapshot",
    ]) {
      expect(glossary).toMatch(new RegExp(`^\\| ${term} \\| \\S[^|]* \\|`, "m"));
    }
  });
});
