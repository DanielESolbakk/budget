import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BENCHMARK_OUTPUT_METRIC_KEYS,
  type BackupRestoreBenchmarkResult,
} from "../../src/tooling/performance/benchmarkOutputContract.js";
import { runBackupRestoreBenchmark } from "../../src/tooling/performance/runBackupRestoreBenchmark.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";
const SNAPSHOT_PATH = "tests/fixtures/synthetic/backup-restore-performance-contract.json";

function readExpectedSnapshot(): BackupRestoreBenchmarkResult {
  const snapshotPath = join(process.cwd(), SNAPSHOT_PATH);
  return JSON.parse(readFileSync(snapshotPath, "utf8")) as BackupRestoreBenchmarkResult;
}

describe("performance harness contract", () => {
  it("AC-1: emits deterministic output for repeated equivalent fixture runs", () => {
    const first = runBackupRestoreBenchmark({ fixturePath: FIXTURE_PATH, iterationCount: 2 });
    const second = runBackupRestoreBenchmark({ fixturePath: FIXTURE_PATH, iterationCount: 2 });

    expect(first).toEqual(second);
    expect(first).toEqual(readExpectedSnapshot());
  });

  it("keeps stable metric keys and metadata fields for the contract snapshot", () => {
    const result = runBackupRestoreBenchmark({ fixturePath: FIXTURE_PATH, iterationCount: 2 });

    expect(result.metadata.metricKeys).toEqual([...BENCHMARK_OUTPUT_METRIC_KEYS]);
    expect(Object.keys(result.metrics)).toEqual([...BENCHMARK_OUTPUT_METRIC_KEYS]);
    expect(result.metadata.noNetworkByDefault).toBe(true);
  });
});
