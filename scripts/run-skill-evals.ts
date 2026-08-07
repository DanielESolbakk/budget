import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPerformanceHarness } from "../src/tooling/performance/createPerformanceHarness.js";
import type { PerformanceHarnessResult } from "../src/tooling/performance/performanceHarnessContract.js";

interface SkillEvalOptions {
  inputPath: string;
  iterationCount: number;
  jsonOutput: boolean;
  snapshotPath?: string;
}

function getOptionValue(args: string[], optionName: string): string | undefined {
  const index = args.indexOf(optionName);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function hasFlag(args: string[], optionName: string): boolean {
  return args.includes(optionName);
}

function parseOptions(args: string[]): SkillEvalOptions {
  const inputPath = getOptionValue(args, "--input") ?? "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";
  const iterationsRaw = getOptionValue(args, "--iterations");
  const snapshotPath = hasFlag(args, "--no-snapshot")
    ? undefined
    : getOptionValue(args, "--snapshot") ?? "tests/fixtures/synthetic/backup-restore-performance-contract.json";
  const jsonOutput = hasFlag(args, "--json");
  const iterationCount = iterationsRaw === undefined ? 2 : Number.parseInt(iterationsRaw, 10);

  if (!Number.isInteger(iterationCount) || iterationCount <= 0) {
    console.error(`Invalid --iterations value: ${iterationsRaw}. Must be a positive integer.`);
    console.error(
      "Usage: npm run eval:skill -- [--input <csv-path>] [--iterations <positive-integer>] [--snapshot <json-path>] [--no-snapshot] [--json]"
    );
    process.exit(1);
  }

  return {
    inputPath,
    iterationCount,
    jsonOutput,
    ...(snapshotPath !== undefined ? { snapshotPath } : {}),
  };
}

function readSnapshot(snapshotPath: string): PerformanceHarnessResult {
  const resolvedSnapshotPath = resolve(snapshotPath);
  return JSON.parse(readFileSync(resolvedSnapshotPath, "utf8")) as PerformanceHarnessResult;
}

function hasDrift(
  current: PerformanceHarnessResult,
  expected: PerformanceHarnessResult
): boolean {
  return JSON.stringify(current) !== JSON.stringify(expected);
}

function printSummary(result: PerformanceHarnessResult, snapshotChecked: boolean): void {
  const baselineText = snapshotChecked ? "checked" : "skipped";
  console.log("PASS eval:skill");
  console.log(`- baseline snapshot: ${baselineText}`);
  console.log(`- fixture path: ${result.metadata.fixturePath}`);
  console.log(`- fixture digest: ${result.metadata.fixtureDigest}`);
  console.log(`- rows mapped/skipped: ${result.metrics.mappedTransactionCount}/${result.metrics.skippedRowCount}`);
  console.log(`- round-trip stable: ${result.metrics.roundTripStable}`);
  console.log(`- net minor total: ${result.metrics.netMinorTotal}`);
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));

  const result = createPerformanceHarness({
    fixturePath: resolve(options.inputPath),
    iterationCount: options.iterationCount,
    projectRoot: process.cwd(),
  });

  if (!result.metrics.roundTripStable || result.metrics.skippedRowCount !== 0) {
    console.error("FAIL eval:skill - harness integrity checks failed.");
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  let snapshotChecked = false;
  if (options.snapshotPath !== undefined) {
    const expected = readSnapshot(options.snapshotPath);
    snapshotChecked = true;
    if (hasDrift(result, expected)) {
      console.error(`Skill eval drift detected against snapshot: ${options.snapshotPath}`);
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
  }

  if (options.jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printSummary(result, snapshotChecked);
}

main();
