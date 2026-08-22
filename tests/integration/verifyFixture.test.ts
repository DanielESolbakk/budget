import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyFixture } from "../../src/tooling/fixtures/verifyFixture.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function readRepositoryFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, `file://${repositoryRoot}/`), "utf8");
}

function readMarkdownSection(markdown: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(`^${escapedHeading}\\r?\\n([\\s\\S]*?)(?=^#{1,2}\\s|(?![\\s\\S]))`, "im"),
  );
  return match?.[1] ?? "";
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

    expect(adr).toMatch(/^## Status\\s+Accepted$/m);
    const parserSection = readMarkdownSection(adr, "### Import and Parser Layer");
    expect(parserSection).toContain("source-aware parser adapters");
    expect(parserSection).toContain("parser-specific logic isolated");

    const privacySection = readMarkdownSection(adr, "## Privacy and Data Handling Constraints");
    expect(privacySection).toContain("Transaction content remains local by default");
    expect(privacySection).toContain("No background network calls for transaction workflows");
    expect(planMd).toContain(
      "[ADR-001: Stack and Runtime Boundaries](docs/ways-of-work/plan/budget-planner/adr-001-stack-and-runtime-boundaries.md)",
    );
    expect(planMd).toContain(
      "[Budget Planner Domain Glossary](docs/ways-of-work/plan/budget-planner/domain-glossary.md)",
    );

    const definitionFragments: Record<string, string> = {
      household: "The local budgeting context managed by one user",
      account: "A source or destination ledger account",
      transaction: "A dated financial record with amount",
      category: "A user-visible spending or income classification",
      "merchant alias": "A normalized merchant representation",
      "categorization rule": "A deterministic rule that maps transaction signals",
      "import job": "A tracked import execution",
      "budget target": "A planned amount for a category",
      "forecast assumption": "An explicit input used by forecasting logic",
      "backup snapshot": "A user-initiated exportable backup",
    };
    const glossaryRows = glossary.split(/\r?\n/);
    for (const [term, fragment] of Object.entries(definitionFragments)) {
      const row = glossaryRows.find((line) => line.startsWith(`| ${term} |`)) ?? "";
      expect(row, `Glossary must define "${term}"`).not.toBe("");
      expect(row).toContain(`| ${term} | ${fragment}`);
    }
  });
});
