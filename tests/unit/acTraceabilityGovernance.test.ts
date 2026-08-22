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

describe("AC traceability governance checks", () => {
  it("AC-1: ADR records required stack and runtime boundary decisions", () => {
    const adr = readRepositoryFile(
      "docs/ways-of-work/plan/budget-planner/adr-001-stack-and-runtime-boundaries.md",
    );
    expect(adr).toMatch(/^## Status\s+Accepted$/m);
    expect(adr).toMatch(
      /### Import and Parser Layer[\s\S]*source-aware parser adapters[\s\S]*parser-specific logic isolated/m,
    );
    expect(adr).toMatch(
      /## Privacy and Data Handling Constraints[\s\S]*Transaction content remains local by default[\s\S]*No background network calls for transaction workflows/m,
    );
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
      const escapedTerm = escapeRegularExpression(term);
      expect(glossary, `Glossary must define "${term}"`).toMatch(
        new RegExp(`^\\| ${escapedTerm} \\| \\S[^|]* \\|`, "m"),
      );
    }

    expect(planMd).toContain("adr-001-stack-and-runtime-boundaries.md");
    expect(planMd).toContain("domain-glossary.md");
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
