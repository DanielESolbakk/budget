import {
  createPerformanceHarness,
  type PerformanceHarnessOptions,
} from "./createPerformanceHarness.js";
import type { BackupRestoreBenchmarkResult } from "./benchmarkOutputContract.js";

export type RunBackupRestoreBenchmarkOptions = PerformanceHarnessOptions;

export function runBackupRestoreBenchmark(
  options: RunBackupRestoreBenchmarkOptions
): BackupRestoreBenchmarkResult {
  return createPerformanceHarness(options);
}
