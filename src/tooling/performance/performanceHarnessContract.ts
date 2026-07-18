export const PERFORMANCE_HARNESS_CONTRACT_VERSION = 1 as const;
export const PERFORMANCE_HARNESS_NAME = "backup-restore-baseline" as const;
export const PERFORMANCE_HARNESS_WORKFLOW = "backup-restore" as const;
export const PERFORMANCE_HARNESS_SOURCE_KIND = "synthetic-fixture-csv" as const;

export const PERFORMANCE_HARNESS_METRIC_KEYS = [
  "fixtureRowCount",
  "mappedTransactionCount",
  "restoredTransactionCount",
  "skippedRowCount",
  "serializedByteLength",
  "incomeMinorTotal",
  "expenseMinorTotal",
  "netMinorTotal",
  "roundTripStable",
] as const;

export type PerformanceHarnessMetricKey = typeof PERFORMANCE_HARNESS_METRIC_KEYS[number];

export interface PerformanceHarnessMetadata {
  contractVersion: typeof PERFORMANCE_HARNESS_CONTRACT_VERSION;
  harnessName: typeof PERFORMANCE_HARNESS_NAME;
  workflowName: typeof PERFORMANCE_HARNESS_WORKFLOW;
  sourceKind: typeof PERFORMANCE_HARNESS_SOURCE_KIND;
  fixturePath: string;
  fixtureDigest: string;
  iterationCount: number;
  noNetworkByDefault: true;
  metricKeys: PerformanceHarnessMetricKey[];
}

export interface PerformanceHarnessMetrics {
  fixtureRowCount: number;
  mappedTransactionCount: number;
  restoredTransactionCount: number;
  skippedRowCount: number;
  serializedByteLength: number;
  incomeMinorTotal: number;
  expenseMinorTotal: number;
  netMinorTotal: number;
  roundTripStable: boolean;
}

export interface PerformanceHarnessResult {
  metadata: PerformanceHarnessMetadata;
  metrics: PerformanceHarnessMetrics;
}
