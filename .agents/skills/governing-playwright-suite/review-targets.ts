import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type Status = "in-progress" | "complete" | "partial" | "blocked" | "interrupted";
type Outcome = "pending" | "no-change" | "findings" | "unknown";
interface Scope { label: string; startLine: number; endLine: number }
interface Review {
  id: string;
  file: string;
  scope: Scope;
  fileHash: string;
  startedAt: string;
  finishedAt: string | null;
  status: Status;
  outcome: Outcome;
  summary: string;
  dependencies: Record<string, string>;
  validation: string[];
}
interface History { version: 1; runs: Review[] }
const statuses = new Set(["in-progress", "complete", "partial", "blocked", "interrupted"]);
const outcomes = new Set(["pending", "no-change", "findings", "unknown"]);
const historyFile = "local/playwright-review-history.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value), "Expected an object");
  return value;
}
function text(value: unknown): string {
  assert.ok(typeof value === "string" && value.trim(), "Expected non-empty text");
  return value;
}
function strings(value: unknown): string[] {
  assert.ok(Array.isArray(value) && value.every(item => typeof item === "string" && item.trim()),
    "Expected an array of non-empty strings");
  return value;
}
function isScope(value: unknown): value is Scope {
  return isRecord(value) && typeof value.label === "string" && value.label.trim().length > 0
    && typeof value.startLine === "number" && Number.isInteger(value.startLine) && value.startLine > 0
    && typeof value.endLine === "number" && Number.isInteger(value.endLine) && value.endLine >= value.startLine;
}
function isReview(value: unknown): value is Review {
  if (!isRecord(value) || !isRecord(value.dependencies)) return false;
  return ["id", "file", "fileHash", "startedAt", "summary"].every(key => typeof value[key] === "string" && value[key])
    && /^[a-f0-9]{64}$/.test(String(value.fileHash)) && isScope(value.scope)
    && Number.isFinite(Date.parse(String(value.startedAt)))
    && (value.finishedAt === null || (typeof value.finishedAt === "string" && Number.isFinite(Date.parse(value.finishedAt))))
    && typeof value.status === "string" && statuses.has(value.status)
    && typeof value.outcome === "string" && outcomes.has(value.outcome)
    && Object.values(value.dependencies).every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash))
    && Array.isArray(value.validation) && value.validation.every(item => typeof item === "string")
    && (value.status === "in-progress"
      ? value.finishedAt === null && value.outcome === "pending"
      : value.finishedAt !== null && value.outcome !== "pending")
    && (value.status !== "complete" || value.outcome === "no-change" || value.outcome === "findings");
}
function filePath(root: string, file: string): string {
  assert.ok(!isAbsolute(file) && /^(tests|src|electron)[\\/]/.test(file), "Expected repository source path");
  const full = resolve(root, file);
  assert.ok(/^(tests|src|electron)\//.test(relative(root, full).split(sep).join("/")), "Expected repository source path");
  const inside = (target: string) => {
    const rel = relative(realpathSync(root), target);
    assert.ok(rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "Path escapes repository");
  };
  inside(full);
  if (existsSync(full)) inside(realpathSync(full));
  return full;
}
function hashFile(root: string, file: string): string {
  return createHash("sha256").update(readFileSync(filePath(root, file))).digest("hex");
}
function readHistory(root: string): History {
  const target = resolve(root, historyFile);
  if (!existsSync(target)) return { version: 1, runs: [] };
  const value: unknown = JSON.parse(readFileSync(target, "utf8"));
  assert.ok(isRecord(value) && value.version === 1 && Array.isArray(value.runs)
    && value.runs.every(isReview), "Invalid review history; preserve and repair it, do not reset");
  const runs: Review[] = value.runs;
  assert.equal(new Set(runs.map(run => run.id)).size, runs.length, "Duplicate history IDs");
  return { version: 1, runs };
}
function updateHistory(root: string, update: (history: History) => Review): Review {
  const target = resolve(root, historyFile);
  mkdirSync(dirname(target), { recursive: true });
  const lockPath = `${target}.lock`;
  const lock = openSync(lockPath, "wx");
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const history = readHistory(root);
    const result = update(history);
    writeFileSync(temporary, `${JSON.stringify(history, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, target);
    return result;
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

export function startReview(input: unknown, root = process.cwd()): Review {
  const request = object(input);
  const requestedFile = text(request.file).replaceAll("\\", "/");
  const file = relative(root, filePath(root, requestedFile)).split(sep).join("/");
  assert.ok(file.startsWith("tests/playwright/") && file.endsWith(".spec.ts"), "Expected a Playwright spec path");
  const source = readFileSync(filePath(root, file), "utf8");
  assert.ok(isScope(request.scope) && request.scope.endLine <= source.split(/\r?\n/).length, "Invalid review scope");
  const fixture = "tests/playwright/fixtures/electron.ts";
  const review: Review = {
    id: randomUUID(), file, scope: request.scope, fileHash: hashFile(root, file),
    startedAt: new Date().toISOString(), finishedAt: null, status: "in-progress", outcome: "pending",
    summary: "Review started; not completed.",
    dependencies: existsSync(filePath(root, fixture)) ? { [fixture]: hashFile(root, fixture) } : {},
    validation: []
  };
  return updateHistory(root, history => { history.runs.push(review); return review; });
}

export function finishReview(input: unknown, root = process.cwd()): Review {
  const request = object(input);
  const id = text(request.id);
  const status = text(request.status);
  const outcome = text(request.outcome);
  const summary = text(request.summary);
  const dependencies = strings(request.dependencies);
  const validation = strings(request.validation);
  assert.ok(statuses.has(status) && status !== "in-progress", "Invalid final status");
  assert.ok(outcomes.has(outcome) && outcome !== "pending", "Invalid final outcome");
  assert.ok(status !== "complete" || outcome === "no-change" || outcome === "findings", "Complete review needs an outcome");
  return updateHistory(root, history => {
    const review = history.runs.find(run => run.id === id);
    assert.ok(review && review.status === "in-progress", "Unknown or already finalized review");
    if (status === "complete") {
      assert.equal(hashFile(root, review.file), review.fileHash, "Target changed during review");
      for (const [file, hash] of Object.entries(review.dependencies)) {
        assert.equal(hashFile(root, file), hash, "Fixture changed during review");
      }
    }
    for (const file of dependencies) review.dependencies[file.replaceAll("\\", "/")] = hashFile(root, file);
    review.status = status as Exclude<Status, "in-progress">;
    review.outcome = outcome as Exclude<Outcome, "pending">;
    review.finishedAt = new Date().toISOString();
    review.summary = summary;
    review.validation = validation;
    return review;
  });
}

function specFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = resolve(directory, entry.name);
    return entry.isDirectory() ? specFiles(file) : entry.isFile() && entry.name.endsWith(".spec.ts") ? [file] : [];
  });
}

function dependenciesUnchanged(root: string, review: Review): boolean {
  return Object.entries(review.dependencies).every(([dependency, hash]) => {
    const target = filePath(root, dependency);
    return existsSync(target) && hashFile(root, dependency) === hash;
  });
}

export function suggestTargets(root = process.cwd()) {
  const history = readHistory(root);
  const files = specFiles(resolve(root, "tests/playwright"));
  const limitations: { file: string; scope: Scope; reason: string }[] = [];
  const knownFindings = history.runs.flatMap((review, index) => {
    if (review.status !== "complete" || review.outcome !== "findings"
      || !existsSync(filePath(root, review.file)) || hashFile(root, review.file) !== review.fileHash
      || !dependenciesUnchanged(root, review)) return [];
    const newer = history.runs.slice(index + 1).filter(run => run.file === review.file && run.status === "complete"
      && run.scope.startLine <= review.scope.endLine && run.scope.endLine >= review.scope.startLine);
    let uncoveredLine = review.scope.startLine;
    for (const run of newer.sort((a, b) => a.scope.startLine - b.scope.startLine)) {
      if (run.scope.startLine > uncoveredLine) break;
      uncoveredLine = Math.max(uncoveredLine, run.scope.endLine + 1);
    }
    if (uncoveredLine > review.scope.endLine) return [];
    if (newer.length) {
      limitations.push({
        file: review.file, scope: review.scope,
        reason: "Recorded findings are partially superseded; confirm whether any actions remain before recommending them."
      });
      return [];
    }
    return [{ file: review.file, scope: review.scope, finishedAt: review.finishedAt, summary: review.summary }];
  }).slice(-3).reverse();
  const candidates = files.flatMap(full => {
    const file = relative(root, full).split(sep).join("/");
    const source = readFileSync(filePath(root, file), "utf8");
    const fileHash = hashFile(root, file);
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const cases: { title: string; start: number; end: number; waits: number; styles: number; short: number }[] = [];
    function inspect(node: ts.Node) {
      if (ts.isCallExpression(node) && /^test(?:\.(?:only|skip|fixme|fail))?$/.test(node.expression.getText(parsed))) {
        const title = node.arguments[0];
        const callback = node.arguments.at(-1);
        if (title && callback
          && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          let waits = 0, styles = 0;
          function signals(part: ts.Node) {
            if (ts.isCallExpression(part) && ts.isPropertyAccessExpression(part.expression)) {
              const name = part.expression.name.text;
              if (name === "waitForTimeout") waits++;
              if (name === "toHaveCSS" || name === "boundingBox") styles++;
            }
            ts.forEachChild(part, signals);
          }
          signals(callback);
          cases.push({
            title: ts.isStringLiteralLike(title) ? title.text : title.getText(parsed),
            start: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
            end: parsed.getLineAndCharacterOfPosition(node.getEnd()).line + 1, waits, styles,
            short: ts.isBlock(callback.body) && callback.body.statements.length <= 2 ? 1 : 0
          });
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(parsed);
    const prior = history.runs.filter(run => run.file === file);
    const completed = prior.filter(run => run.status === "complete").reverse();
    const remaining = cases.filter(item => {
      for (const run of completed) {
        if (run.scope.startLine > item.end || run.scope.endLine < item.start) continue;
        if (run.fileHash !== fileHash || !dependenciesUnchanged(root, run)) return true;
        if (run.scope.startLine <= item.start && run.scope.endLine >= item.end) return false;
      }
      return true;
    });
    if (!remaining.length) return [];
    const scored = remaining.map(item => {
      const repeats = cases.filter(other => other.title === item.title).length > 1 ? 1 : 0;
      return { ...item, repeats, weight: 4 * item.waits + item.styles + repeats + item.short };
    });
    for (const item of scored.filter(item => item.weight > 0 && item.end - item.start + 1 > 200)) {
      limitations.push({
        file, scope: { label: "oversized source case", startLine: item.start, endLine: item.end },
        reason: "Source case exceeds the 200-line automatic scope limit; choose an explicit bounded assertion section."
      });
    }
    const eligible = scored.filter(item => item.weight > 0 && item.end - item.start + 1 <= 200);
    const anchor = [...eligible].sort((a, b) =>
      b.weight / (b.end - b.start + 1) - a.weight / (a.end - a.start + 1) || a.start - b.start)[0];
    if (!anchor) return [];
    const lineCount = source.split(/\r?\n/).length;
    const whole = cases.length <= 10 && remaining.length === cases.length && lineCount <= 200;
    const selected = whole ? scored : [];
    if (!whole) {
      const anchorIndex = scored.indexOf(anchor);
      for (const item of scored.slice(anchorIndex, anchorIndex + (cases.length > 10 ? 5 : 10))) {
        if (!item.weight || item.end - anchor.start + 1 > 200) break;
        selected.push(item);
      }
    }
    const first = selected[0], last = selected.at(-1);
    assert.ok(first && last);
    const startLine = whole ? 1 : first.start;
    const endLine = whole ? lineCount : last.end;
    const waits = selected.reduce((sum, item) => sum + item.waits, 0);
    const styles = selected.reduce((sum, item) => sum + item.styles, 0);
    const short = selected.reduce((sum, item) => sum + item.short, 0);
    const repeats = selected.reduce((sum, item) => sum + item.repeats, 0);
    const reasons: string[] = [];
    if (waits) reasons.push(`${waits} fixed-wait calls: possible reliability amendment.`);
    if (styles) reasons.push(`${styles} CSS/geometry calls: inspect assertion value.`);
    if (repeats) reasons.push(`${repeats} repeated titles: variants or overlap, not proven duplicates.`);
    if (short) reasons.push(`${short} short cases: inspect whether repeated setup is justified.`);
    const lastReview = prior.at(-1);
    return [{
      file, fileHash, declaredCases: cases.length, remainingCases: remaining.length,
      confidence: "heuristic-only", reasons, score: (4 * waits + styles + repeats + short) / (endLine - startLine + 1),
      scope: {
        label: whole ? "whole file" : `source cases ${first.start}-${last.end}; include enclosing setup`,
        startLine, endLine
      },
      lastReview: lastReview ? {
        startedAt: lastReview.startedAt, finishedAt: lastReview.finishedAt,
        status: lastReview.status, outcome: lastReview.outcome, scope: lastReview.scope, summary: lastReview.summary
      } : null
    }];
  });
  candidates.sort((a, b) => b.score - a.score || a.remainingCases - b.remainingCases || a.file.localeCompare(b.file));
  return {
    scannedFiles: files.length, candidates: candidates.slice(0, 3), knownFindings,
    limitedScopes: limitations.length, limitations: limitations.slice(0, 3),
    note: "Static triage only, not a review or a promise of culls/savings. Report limitations explicitly; no candidates with unresolved limitations is not a no-findings result."
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, requestPath, ...extra] = process.argv.slice(2);
  assert.ok(extra.length === 0, "Too many arguments");
  if (command === "suggest") {
    assert.ok(!requestPath, "suggest takes no request file");
    console.log(JSON.stringify(suggestTargets(), null, 2));
  } else {
    assert.ok((command === "start" || command === "finish") && requestPath,
      "Usage: npx --no-install tsx review-targets.ts suggest | start <request.json> | finish <request.json>");
    const input: unknown = JSON.parse(readFileSync(requestPath, "utf8"));
    console.log(JSON.stringify(command === "start" ? startReview(input) : finishReview(input), null, 2));
  }
}
