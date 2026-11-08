import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({
  cwd: fileURLToPath(new URL("../../", import.meta.url)),
});

describe("QA lint ownership", () => {
  it.each([
    'import { buildDashboardData } from "../app/dashboardApi.js";',
    'export { normalizeHouseholdSetupInput } from "../../app/onboarding/householdSetup.js";',
  ])("rejects renderer runtime application imports: %s", async (source) => {
    const results = await eslint.lintText(source, { filePath: "src/renderer/synthetic-boundary.ts" });
    expect(results.flatMap((result) => result.messages.map((message) => message.ruleId)))
      .toContain("@typescript-eslint/no-restricted-imports");
  });

  it("rejects dynamic renderer application imports", async () => {
    const results = await eslint.lintText('await import("../app/dashboardApi.js");', {
      filePath: "src/renderer/synthetic-boundary.ts",
    });
    expect(results.flatMap((result) => result.messages.map((message) => message.ruleId)))
      .toContain("no-restricted-syntax");
  });

  it.each([
    'import type { DashboardData } from "../app/dashboardApi.js"; export type { DashboardData };',
    'import { type DashboardData } from "../app/dashboardApi.js"; export type { DashboardData };',
    'export type { DashboardData } from "../app/dashboardApi.js";',
    'import { buildDashboardData } from "../shared/dashboard.js"; export { buildDashboardData };',
  ])("allows type-only application contracts and shared composition: %s", async (source) => {
    const results = await eslint.lintText(source, { filePath: "src/renderer/synthetic-boundary.ts" });
    expect(results.flatMap((result) => result.messages.map((message) => message.ruleId)))
      .not.toContain("@typescript-eslint/no-restricted-imports");
  });

  it.each([
    'import { readFile } from "node:fs/promises";',
    'import { app } from "electron";',
    'import { createLocalLedgerDatabase } from "../app/backup/localLedgerSqlite.js";',
  ])("rejects desktop dependencies in shared modules: %s", async (source) => {
    const results = await eslint.lintText(source, { filePath: "src/shared/synthetic-boundary.ts" });
    expect(results.flatMap((result) => result.messages.map((message) => message.ruleId)))
      .toContain("@typescript-eslint/no-restricted-imports");
  });

  it.each([
    ".agents/skills/impeccable/scripts/live-browser.js",
    ".github/skills/impeccable/scripts/live-browser.js",
    ".impeccable/review/synthetic-review.mjs",
  ])("ignores installed or generated tooling at %s", async (filePath) => {
    expect(await eslint.isPathIgnored(filePath)).toBe(true);
  });

  it.each([
    ".github/scripts/planningChecks.cjs",
    ".agents/skills/synthetic-owned-tool/script.mjs",
    "src/domain/synthetic-lint-target.ts",
    "tests/unit/synthetic-lint-target.test.ts",
  ])("continues reporting lint errors in owned code at %s", async (filePath) => {
    expect(await eslint.isPathIgnored(filePath)).toBe(false);
    const results = await eslint.lintText("debugger;\n", { filePath });
    expect(results.flatMap((result) => result.messages.map((message) => message.ruleId)))
      .toContain("no-debugger");
  });
});
