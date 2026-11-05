import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const helper = resolve(".agents/skills/governing-playwright-suite/review-targets.ts");
const loader = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
const caseSource = (title: string) =>
  `test("${title}", async ({ page }) => { await page.waitForTimeout(10); });`;

describe("bounded Playwright target selection and history", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "budget-review-targets-"));
    put("tests/playwright/small.spec.ts", caseSource("opens correction"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function put(file: string, content: string) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  function run(command: string, input?: unknown) {
    const args = ["--import", loader, helper, command];
    if (input !== undefined) {
      const request = join(root, "request.json");
      writeFileSync(request, JSON.stringify(input));
      args.push(request);
    }
    return spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  }

  function ok(command: string, input?: unknown) {
    const result = run(command, input);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    return JSON.parse(result.stdout);
  }

  function start(startLine = 1, endLine = 1) {
    return ok("start", {
      file: "tests/playwright/small.spec.ts",
      scope: { label: "selected source cases", startLine, endLine }
    });
  }

  function finish(id: string, status = "complete", dependencies: string[] = []) {
    return run("finish", {
      id, status, outcome: status === "complete" ? "no-change" : "unknown",
      summary: "Inspected the selected assertions; no reduction justified.",
      dependencies, validation: ["Source review only; tests not executed."]
    });
  }

  it("recommends a bounded signal-bearing target rather than the largest file", () => {
    put("tests/playwright/large.spec.ts",
      Array.from({ length: 20 }, (_, i) =>
        `test("journey ${i}", async () => { prepare(); act(); check(); cleanup(); });`).join("\n"));

    const result = ok("suggest");

    expect(result.candidates[0]).toMatchObject({
      file: "tests/playwright/small.spec.ts",
      declaredCases: 1,
      remainingCases: 1,
      confidence: "heuristic-only"
    });
    expect(result.candidates[0].reasons.join(" ")).toMatch(/fixed.wait/i);
    expect(existsSync(join(root, "local/playwright-review-history.json"))).toBe(false);
  });

  it("does not claim every file has a plausible cull candidate", () => {
    put("tests/playwright/small.spec.ts",
      'test("durable import", async () => { prepare(); act(); reload(); check(); cleanup(); });');

    expect(ok("suggest").candidates).toEqual([]);
  });

  it("counts dynamic source declarations without mistaking parameter values for separate cases", () => {
    put("tests/playwright/small.spec.ts",
      'for (const width of [390, 1440]) { test(`layout ${width}`, async ({ page }) => { await page.waitForTimeout(10); }); }');

    expect(ok("suggest").candidates[0]).toMatchObject({ declaredCases: 1, remainingCases: 1 });
  });

  it("bounds a large file instead of presenting it as an inexpensive whole-file review", () => {
    put("tests/playwright/small.spec.ts",
      `${Array.from({ length: 220 }, (_, i) => `const setup${i} = ${i};`).join("\n")}\n${caseSource("one")}`);

    expect(ok("suggest").candidates[0].scope).toMatchObject({ startLine: 221, endLine: 221 });
  });

  it("selects the signal-bearing section and reports only signals inside that scope", () => {
    put("tests/playwright/small.spec.ts",
      Array.from({ length: 10 }, (_, i) =>
        `test("style ${i}", async ({ page }) => { await expect(page.getByRole("button")).toHaveCSS("color", "red"); prepare(); act(); cleanup(); });`
      ).join("\n") + `\n${caseSource("late fixed wait")}`);

    const candidate = ok("suggest").candidates[0];

    expect(candidate.scope).toMatchObject({ startLine: 11, endLine: 11 });
    expect(candidate.reasons.join(" ")).toMatch(/1 fixed.wait/i);
    expect(candidate.reasons.join(" ")).not.toMatch(/CSS|geometry/);
  });

  it("does not bridge distant cases into an oversized section", () => {
    put("tests/playwright/small.spec.ts",
      `${caseSource("first")}\n${Array.from({ length: 220 }, (_, i) => `const gap${i} = ${i};`).join("\n")}\n${caseSource("last")}`);

    const candidate = ok("suggest").candidates[0];

    expect(candidate.scope).toMatchObject({ startLine: 1, endLine: 1 });
    expect(candidate.reasons.join(" ")).toMatch(/1 fixed.wait/i);
  });

  it.each([199, 200])("allows a %i-line case within the automatic review bound", lines => {
    put("tests/playwright/small.spec.ts",
      `test("large case", async ({ page }) => {\n${Array.from({ length: lines - 3 }, () => "prepare();").join("\n")}\nawait page.waitForTimeout(10);\n});`);

    expect(ok("suggest").candidates[0].scope).toMatchObject({ startLine: 1, endLine: lines });
  });

  it.each([201, 253])("reports a %i-line case as a limitation rather than an automatic scope", lines => {
    put("tests/playwright/small.spec.ts",
      `test("large case", async ({ page }) => {\n${Array.from({ length: lines - 3 }, () => "prepare();").join("\n")}\nawait page.waitForTimeout(10);\n});`);

    const result = ok("suggest");

    expect(result.candidates).toEqual([]);
    expect(result.limitations).toEqual(expect.arrayContaining([expect.objectContaining({
      file: "tests/playwright/small.spec.ts",
      scope: expect.objectContaining({ startLine: 1, endLine: lines }),
      reason: expect.stringMatching(/200.line.*bounded/i)
    })]));
  });

  it("leaves an unfinished start pending instead of treating cancellation as completion", () => {
    const record = start();
    const result = ok("suggest");

    expect(record.status).toBe("in-progress");
    expect(record.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.candidates[0].lastReview.status).toBe("in-progress");
    expect(result.candidates[0].remainingCases).toBe(1);
  });

  it("does not recommend an unchanged completed scope again", () => {
    const record = start();

    expect(finish(record.id).status).toBe(0);
    expect(ok("suggest").candidates).toEqual([]);
    const history = JSON.parse(readFileSync(join(root, "local/playwright-review-history.json"), "utf8"));
    expect(history.runs[0]).toMatchObject({ status: "complete", outcome: "no-change" });
    expect(history.runs[0].finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("normalizes equivalent spec paths so completed reviews are not forgotten", () => {
    const record = ok("start", {
      file: "tests/playwright/../playwright/small.spec.ts",
      scope: { label: "whole file", startLine: 1, endLine: 1 }
    });
    expect(record.file).toBe("tests/playwright/small.spec.ts");
    expect(finish(record.id).status).toBe(0);
    expect(ok("suggest").candidates).toEqual([]);
  });

  it("exposes already recorded findings without sending the same scope through another review", () => {
    const record = start();
    ok("finish", {
      id: record.id, status: "complete", outcome: "findings",
      summary: "Replace the fixed wait with an observable readiness assertion.",
      dependencies: [], validation: ["Source review only."]
    });

    const result = ok("suggest");

    expect(result.candidates).toEqual([]);
    expect(result.knownFindings).toEqual(expect.arrayContaining([expect.objectContaining({
      file: "tests/playwright/small.spec.ts",
      summary: "Replace the fixed wait with an observable readiness assertion."
    })]));
  });

  it("does not resurrect an old finding after a newer no-change review of the same scope", () => {
    const first = start();
    ok("finish", {
      id: first.id, status: "complete", outcome: "findings",
      summary: "Old proposal to retire the selected case.",
      dependencies: [], validation: ["Source review only."]
    });
    const second = start();
    expect(finish(second.id).status).toBe(0);

    const result = ok("suggest");

    expect(result.knownFindings).toEqual([]);
    expect(result.candidates).toEqual([]);
    const history = JSON.parse(readFileSync(join(root, "local/playwright-review-history.json"), "utf8"));
    expect(history.runs[0].outcome).toBe("findings");
    expect(history.runs).toHaveLength(2);
  });

  it("preserves findings in a disjoint scope when another scope is reviewed", () => {
    put("tests/playwright/small.spec.ts", `${caseSource("one")}\n${caseSource("two")}`);
    const first = start(1, 1);
    ok("finish", {
      id: first.id, status: "complete", outcome: "findings",
      summary: "Replace the first case's fixed wait.",
      dependencies: [], validation: ["Source review only."]
    });
    const second = start(2, 2);
    expect(finish(second.id).status).toBe(0);

    const result = ok("suggest");

    expect(result.candidates).toEqual([]);
    expect(result.knownFindings).toHaveLength(1);
    expect(result.knownFindings[0].scope).toMatchObject({ startLine: 1, endLine: 1 });
  });

  it("reports partially superseded findings as unresolved rather than repeating the old action", () => {
    put("tests/playwright/small.spec.ts", `${caseSource("one")}\n${caseSource("two")}`);
    const first = start(1, 2);
    ok("finish", {
      id: first.id, status: "complete", outcome: "findings",
      summary: "Review the two original retirement proposals.",
      dependencies: [], validation: ["Source review only."]
    });
    const second = start(1, 1);
    expect(finish(second.id).status).toBe(0);

    const result = ok("suggest");

    expect(result.knownFindings).toEqual([]);
    expect(result.limitations).toEqual(expect.arrayContaining([expect.objectContaining({
      file: "tests/playwright/small.spec.ts",
      scope: expect.objectContaining({ startLine: 1, endLine: 2 }),
      reason: expect.stringMatching(/partially superseded/i)
    })]));
  });

  it("clears an old finding when newer completed sections collectively replace its entire scope", () => {
    put("tests/playwright/small.spec.ts", `${caseSource("one")}\n${caseSource("two")}`);
    const first = start(1, 2);
    ok("finish", {
      id: first.id, status: "complete", outcome: "findings",
      summary: "Old proposals for both cases.",
      dependencies: [], validation: ["Source review only."]
    });
    for (const line of [1, 2]) {
      const record = start(line, line);
      expect(finish(record.id).status).toBe(0);
    }

    const result = ok("suggest");

    expect(result.knownFindings).toEqual([]);
    expect(result.limitations).toEqual([]);
    expect(result.candidates).toEqual([]);
  });

  it("does not mark an entire file reviewed when only one source case was inspected", () => {
    put("tests/playwright/small.spec.ts", `${caseSource("one")}\n${caseSource("two")}`);
    const record = start(1, 1);
    expect(finish(record.id).status).toBe(0);

    expect(ok("suggest").candidates[0]).toMatchObject({
      remainingCases: 1,
      scope: { startLine: 2, endLine: 2 }
    });
  });

  it.each(["partial", "blocked", "interrupted"])("does not hide %s work", status => {
    const record = start();
    expect(finish(record.id, status).status).toBe(0);
    expect(ok("suggest").candidates[0].remainingCases).toBe(1);
  });

  it("reconsiders a reviewed scope when an inspected dependency changes", () => {
    put("src/app/synthetic.ts", "export const version = 1;");
    const record = start();
    expect(finish(record.id, "complete", ["src/app/synthetic.ts"]).status).toBe(0);
    expect(ok("suggest").candidates).toEqual([]);

    put("src/app/synthetic.ts", "export const version = 2;");

    expect(ok("suggest").candidates[0].remainingCases).toBe(1);
  });

  it("does not use an older review to hide a changed dependency captured by a newer review", () => {
    put("src/app/synthetic.ts", "export const version = 1;");
    const first = start();
    expect(finish(first.id).status).toBe(0);
    const second = start();
    expect(finish(second.id, "complete", ["src/app/synthetic.ts"]).status).toBe(0);
    expect(ok("suggest").candidates).toEqual([]);

    put("src/app/synthetic.ts", "export const version = 2;");

    const result = ok("suggest");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].remainingCases).toBe(1);
  });

  it("reopens a case when a newer overlapping subsection has stale dependencies", () => {
    put("tests/playwright/small.spec.ts",
      'test("one", async ({ page }) => {\nawait page.waitForTimeout(10);\n});');
    put("src/app/synthetic.ts", "export const version = 1;");
    const first = start(1, 3);
    expect(finish(first.id).status).toBe(0);
    const second = start(2, 2);
    expect(finish(second.id, "complete", ["src/app/synthetic.ts"]).status).toBe(0);

    put("src/app/synthetic.ts", "export const version = 2;");

    const result = ok("suggest");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].scope).toMatchObject({ startLine: 1, endLine: 3 });
  });

  it("preserves a fresh full-case review when a newer unchanged subsection is reviewed", () => {
    put("tests/playwright/small.spec.ts",
      'test("one", async ({ page }) => {\nawait page.waitForTimeout(10);\n});');
    const first = start(1, 3);
    expect(finish(first.id).status).toBe(0);
    const second = start(2, 2);
    expect(finish(second.id).status).toBe(0);

    expect(ok("suggest").candidates).toEqual([]);
  });

  it("does not revive an older finding when a newer finding becomes stale", () => {
    put("src/app/synthetic.ts", "export const version = 1;");
    for (const dependencies of [[], ["src/app/synthetic.ts"]]) {
      const record = start();
      ok("finish", {
        id: record.id, status: "complete", outcome: "findings",
        summary: "Replace the fixed wait.", dependencies, validation: ["Source review only."]
      });
    }
    put("src/app/synthetic.ts", "export const version = 2;");

    const result = ok("suggest");

    expect(result.knownFindings).toEqual([]);
    expect(result.candidates[0].remainingCases).toBe(1);
  });

  it("reconsiders changed specs without relying on a commit or a date alone", () => {
    const record = start();
    expect(finish(record.id).status).toBe(0);
    put("tests/playwright/small.spec.ts", caseSource("changed correction"));

    expect(ok("suggest").candidates[0].remainingCases).toBe(1);
  });

  it("rejects completion if the target or initially captured fixture changed during review", () => {
    put("tests/playwright/fixtures/electron.ts", "export const fixture = 1;");
    const record = start();
    put("tests/playwright/fixtures/electron.ts", "export const fixture = 2;");

    const result = finish(record.id);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/changed during review/i);
    expect(ok("suggest").candidates[0].lastReview.status).toBe("in-progress");
  });

  it("does not silently reset corrupt history", () => {
    put("local/playwright-review-history.json", '{"version":99,"runs":[]}');

    const result = run("suggest");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/history/i);
    expect(readFileSync(join(root, "local/playwright-review-history.json"), "utf8")).toContain('"version":99');
  });

  it.each([
    { file: "../outside.spec.ts", scope: { label: "invalid", startLine: 1, endLine: 1 } },
    { file: "tests/playwright/small.spec.ts", scope: { label: "invalid", startLine: 2, endLine: 1 } }
  ])("rejects invalid scope without creating a history record", input => {
    expect(run("start", input).status).toBe(1);
    expect(existsSync(join(root, "local/playwright-review-history.json"))).toBe(false);
  });

  it("rejects repeated finalization instead of overwriting an earlier result", () => {
    const record = start();
    expect(finish(record.id).status).toBe(0);
    expect(finish(record.id, "interrupted").status).toBe(1);
  });
});
