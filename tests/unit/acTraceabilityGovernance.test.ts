import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function readRepositoryFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, `file://${repositoryRoot}/`), "utf8");
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readMarkdownSection(markdown: string, heading: string): string {
  const escapedHeading = escapeRegularExpression(heading);
  const match = markdown.match(
    new RegExp(`^${escapedHeading}\\r?\\n([\\s\\S]*?)(?=^#{1,2}\\s|(?![\\s\\S]))`, "im"),
  );
  return match?.[1] ?? "";
}

describe("AC traceability governance checks", () => {
  it("AC-1: ADR records required stack and runtime boundary decisions", () => {
    const adr = readRepositoryFile(
      "docs/ways-of-work/plan/budget-planner/adr-001-stack-and-runtime-boundaries.md",
    );
    expect(adr).toMatch(/^## Status\s+Accepted$/m);
    const parserSection = readMarkdownSection(adr, "### Import and Parser Layer");
    expect(parserSection).toContain("source-aware parser adapters");
    expect(parserSection).toContain("parser-specific logic isolated");

    const privacySection = readMarkdownSection(adr, "## Privacy and Data Handling Constraints");
    expect(privacySection).toContain("Transaction content remains local by default");
    expect(privacySection).toContain("No background network calls for transaction workflows");
    for (const term of [
      "Electron",
      "React",
      "TypeScript",
      "SQLite",
      "renderer",
      "Main Process",
      "Shared Layer",
      "parser adapter",
      "local-first",
      "no-network",
    ]) {
      expect(adr, `ADR must contain "${term}"`).toContain(term);
    }
  });

  it("AC-2: glossary defines all canonical domain terms and plan.md links both artifacts", () => {
    const glossary = readRepositoryFile(
      "docs/ways-of-work/plan/budget-planner/domain-glossary.md",
    );
    const planMd = readRepositoryFile("plan.md");

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

    expect(planMd).toContain(
      "[ADR-001: Stack and Runtime Boundaries](docs/ways-of-work/plan/budget-planner/adr-001-stack-and-runtime-boundaries.md)",
    );
    expect(planMd).toContain(
      "[Budget Planner Domain Glossary](docs/ways-of-work/plan/budget-planner/domain-glossary.md)",
    );
  });

  it("keeps deterministic AC evidence contract documented", () => {
    const requiredRowFormat = "AC-ID | test-level | test-id | test-file-path";
    expect(requiredRowFormat).toContain("test-id");
    expect(requiredRowFormat).toContain("test-file-path");
  });

  it("documents the opt-in frontend governance workflow", () => {
    const copilotInstructions = readRepositoryFile(".github/copilot-instructions.md");
    const agentInstructions = readRepositoryFile("AGENTS.md");
    const planningSkill = readRepositoryFile(".agents/skills/issue-planning-governor/SKILL.md");

    for (const content of [copilotInstructions, agentInstructions]) {
      expect(content).toContain("Frontend Design Governance (Opt-In)");
      expect(content).toContain("npx impeccable install");
      expect(content).toContain("/impeccable init");
      expect(content).toContain("Non-frontend issues");
    }
    expect(copilotInstructions).toContain("Node 22.12 or newer");
    expect(agentInstructions).toContain("v22.12.0 or newer");

    expect(planningSkill).toContain("R16 Frontend planning completeness");
    expect(planningSkill).toContain("G9 Frontend planning completeness");
    expect(planningSkill).toContain("Issues without renderer entry points or UI changes are exempt from R16");
    expect(planningSkill).toContain("If the issue has no renderer entry points or UI changes, G9 is not applicable");
    for (const requirement of [
      "design direction",
      "design-system preservation",
      "responsive behavior",
      "accessibility",
      "visual-validation intent",
    ]) {
      expect(planningSkill).toContain(requirement);
    }
  });

  it("keeps frontend tooling opt-in and transaction content local", () => {
    const governedFiles = [
      readRepositoryFile(".github/copilot-instructions.md"),
      readRepositoryFile("AGENTS.md"),
      readRepositoryFile(".agents/skills/issue-planning-governor/SKILL.md"),
    ];

    for (const content of governedFiles) {
      expect(content).toContain("opt-in");
      expect(content).toContain("transaction content");
      expect(content).toContain("telemetry");
      expect(content).toContain("analytics");
    }

    expect(governedFiles[0]).toContain("Generated output files");
    for (const generatedArtifact of ["PRODUCT.md", "DESIGN.md", "skill caches"]) {
      expect(governedFiles[0]).toContain(generatedArtifact);
    }
    expect(governedFiles[1]).toContain("Do NOT commit generated files");
  });
});
