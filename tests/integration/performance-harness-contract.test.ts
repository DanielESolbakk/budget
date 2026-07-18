import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPerformanceHarness } from "../../src/tooling/performance/createPerformanceHarness.js";
import { PERFORMANCE_HARNESS_METRIC_KEYS, type PerformanceHarnessResult } from "../../src/tooling/performance/performanceHarnessContract.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";
const SNAPSHOT_PATH = "tests/fixtures/synthetic/backup-restore-performance-contract.json";

function readExpectedSnapshot(): PerformanceHarnessResult {
  const snapshotPath = join(process.cwd(), SNAPSHOT_PATH);
  return JSON.parse(readFileSync(snapshotPath, "utf8")) as PerformanceHarnessResult;
}

describe("performance harness contract", () => {
  it("AC-1: emits deterministic output for repeated equivalent fixture runs", () => {
    const first = createPerformanceHarness({ fixturePath: FIXTURE_PATH, iterationCount: 2 });
    const second = createPerformanceHarness({ fixturePath: FIXTURE_PATH, iterationCount: 2 });

    expect(first).toEqual(second);
    expect(first).toEqual(readExpectedSnapshot());
  });

  it("keeps stable metric keys and metadata fields for the contract snapshot", () => {
    const result = createPerformanceHarness({ fixturePath: FIXTURE_PATH, iterationCount: 2 });

    expect(result.metadata.metricKeys).toEqual([...PERFORMANCE_HARNESS_METRIC_KEYS]);
    expect(Object.keys(result.metrics)).toEqual([...PERFORMANCE_HARNESS_METRIC_KEYS]);
    expect(result.metadata.noNetworkByDefault).toBe(true);
  });
});
