import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({
  cwd: fileURLToPath(new URL("../../", import.meta.url)),
});

describe("QA lint ownership", () => {
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
