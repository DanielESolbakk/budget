import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type SignalStatus = "pass" | "warn" | "fail" | "missing";

interface SignalResult {
  name: string;
  status: SignalStatus;
  summary: string;
  details: string[];
}

interface FeedbackReport {
  generatedAtIso: string;
  overallStatus: Exclude<SignalStatus, "missing">;
  unresolvedFailureCount: number;
  unresolvedWarningCount: number;
  signals: SignalResult[];
  recommendedActions: string[];
}

interface CoverageSummaryFile {
  total?: {
    lines?: { pct?: number };
    statements?: { pct?: number };
    functions?: { pct?: number };
    branches?: { pct?: number };
  };
}

interface MutationFileSummary {
  mutants?: Array<{ status?: string }>;
}

interface MutationReport {
  files?: Record<string, MutationFileSummary>;
}

interface DependencyReport {
  totals?: {
    total?: number;
    info?: number;
    low?: number;
    moderate?: number;
    high?: number;
    critical?: number;
  };
  breach?: boolean;
  policy?: {
    failOnOrAbove?: string;
  };
}

function readJson<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function evaluateCoverageSignal(filePath: string): SignalResult {
  const coverage = readJson<CoverageSummaryFile>(filePath);
  if (!coverage?.total) {
    return {
      name: "coverage-signal",
      status: "missing",
      summary: "Coverage summary not found.",
      details: [
        "Expected coverage summary at coverage/unit/coverage-summary.json.",
        "Run npm run test:coverage:signal before feedback aggregation.",
      ],
    };
  }

  const lines = coverage.total.lines?.pct ?? 0;
  const statements = coverage.total.statements?.pct ?? 0;
  const functions = coverage.total.functions?.pct ?? 0;
  const branches = coverage.total.branches?.pct ?? 0;

  const thresholds = {
    lines: 70,
    statements: 70,
    functions: 70,
    branches: 60,
  };

  const breaches: string[] = [];
  if (lines < thresholds.lines) breaches.push(`lines ${lines.toFixed(2)}% < ${thresholds.lines}%`);
  if (statements < thresholds.statements) {
    breaches.push(`statements ${statements.toFixed(2)}% < ${thresholds.statements}%`);
  }
  if (functions < thresholds.functions) {
    breaches.push(`functions ${functions.toFixed(2)}% < ${thresholds.functions}%`);
  }
  if (branches < thresholds.branches) breaches.push(`branches ${branches.toFixed(2)}% < ${thresholds.branches}%`);

  if (breaches.length > 0) {
    return {
      name: "coverage-signal",
      status: "fail",
      summary: "Coverage thresholds not met.",
      details: breaches,
    };
  }

  return {
    name: "coverage-signal",
    status: "pass",
    summary: "Coverage thresholds met.",
    details: [
      `lines=${lines.toFixed(2)}%`,
      `statements=${statements.toFixed(2)}%`,
      `functions=${functions.toFixed(2)}%`,
      `branches=${branches.toFixed(2)}%`,
    ],
  };
}

function evaluateMutationSignal(filePath: string): SignalResult {
  const mutation = readJson<MutationReport>(filePath);
  if (!mutation?.files) {
    return {
      name: "mutation-signal",
      status: "missing",
      summary: "Mutation report not found.",
      details: [
        "Expected mutation report at reports/mutation/mutation.json.",
        "Run npm run test:mutation:signal before feedback aggregation.",
      ],
    };
  }

  let total = 0;
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  let timeout = 0;

  for (const file of Object.values(mutation.files)) {
    for (const mutant of file.mutants ?? []) {
      total += 1;
      if (mutant.status === "Killed") killed += 1;
      if (mutant.status === "Survived") survived += 1;
      if (mutant.status === "NoCoverage") noCoverage += 1;
      if (mutant.status === "Timeout") timeout += 1;
    }
  }

  if (total === 0) {
    return {
      name: "mutation-signal",
      status: "warn",
      summary: "Mutation run produced no mutants.",
      details: ["Verify mutate globs in stryker.config.json."],
    };
  }

  const score = (killed / total) * 100;
  const details = [
    `score=${score.toFixed(2)}%`,
    `killed=${killed}`,
    `survived=${survived}`,
    `noCoverage=${noCoverage}`,
    `timeout=${timeout}`,
    `total=${total}`,
  ];

  if (survived > 0 || timeout > 0) {
    return {
      name: "mutation-signal",
      status: "warn",
      summary: "Mutation analysis found surviving or timeout mutants.",
      details,
    };
  }

  return {
    name: "mutation-signal",
    status: "pass",
    summary: "All generated mutants were killed.",
    details,
  };
}

function evaluateDependencySignal(filePath: string): SignalResult {
  const dependency = readJson<DependencyReport>(filePath);
  if (!dependency?.totals) {
    return {
      name: "dependency-governance",
      status: "missing",
      summary: "Dependency governance report not found.",
      details: [
        "Expected report at reports/dependency-audit/dependency-governance.json.",
        "Run npm run deps:audit:signal before feedback aggregation.",
      ],
    };
  }

  const totals = dependency.totals;
  const details = [
    `policyFailOn=${dependency.policy?.failOnOrAbove ?? "unknown"}`,
    `critical=${totals.critical ?? 0}`,
    `high=${totals.high ?? 0}`,
    `moderate=${totals.moderate ?? 0}`,
    `low=${totals.low ?? 0}`,
    `info=${totals.info ?? 0}`,
    `total=${totals.total ?? 0}`,
  ];

  if (dependency.breach) {
    return {
      name: "dependency-governance",
      status: "fail",
      summary: "Dependency governance threshold breached.",
      details,
    };
  }

  return {
    name: "dependency-governance",
    status: "pass",
    summary: "Dependency governance policy is satisfied.",
    details,
  };
}

function toOverallStatus(signals: SignalResult[]): Exclude<SignalStatus, "missing"> {
  const statuses = signals.map((signal) => signal.status);
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn") || statuses.includes("missing")) return "warn";
  return "pass";
}

function buildRecommendedActions(signals: SignalResult[]): string[] {
  const actions: string[] = [];

  const coverage = signals.find((signal) => signal.name === "coverage-signal");
  if (coverage?.status === "fail") {
    actions.push("Add targeted unit tests for deterministic import, forecast, and aggregation branches that remain below configured thresholds.");
  }
  if (coverage?.status === "missing") {
    actions.push("Run npm run test:coverage:signal and attach coverage summary before requesting review.");
  }

  const mutation = signals.find((signal) => signal.name === "mutation-signal");
  if (mutation?.status === "warn") {
    actions.push("Prioritize survived and timeout mutants by strengthening assertions on behavior, not implementation details.");
  }
  if (mutation?.status === "missing") {
    actions.push("Run npm run test:mutation:signal and review reports/mutation/mutation.html for weakly asserted logic.");
  }

  const dependency = signals.find((signal) => signal.name === "dependency-governance");
  if (dependency?.status === "fail") {
    actions.push("Address high and critical vulnerabilities first, then re-run npm run deps:audit:signal to verify policy recovery.");
  }
  if (dependency?.status === "missing") {
    actions.push("Run npm run deps:audit:signal and attach dependency-governance artifact for visibility.");
  }

  if (actions.length === 0) {
    actions.push("No immediate AI feedback-loop actions required. Keep signal artifacts attached for reviewer traceability.");
  }

  return actions;
}

function writeJson(filePath: string, payload: FeedbackReport): void {
  const targetPath = resolve(filePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeMarkdown(filePath: string, payload: FeedbackReport): void {
  const lines: string[] = [];
  lines.push("# AI Failure Feedback Loop Report");
  lines.push("");
  lines.push(`Generated at: ${payload.generatedAtIso}`);
  lines.push(`Overall status: ${payload.overallStatus}`);
  lines.push(`Unresolved failures: ${payload.unresolvedFailureCount}`);
  lines.push(`Unresolved warnings: ${payload.unresolvedWarningCount}`);
  lines.push("");
  lines.push("## Signal Summary");
  lines.push("");

  for (const signal of payload.signals) {
    lines.push(`- ${signal.name}: ${signal.status} - ${signal.summary}`);
    for (const detail of signal.details) {
      lines.push(`  - ${detail}`);
    }
  }

  lines.push("");
  lines.push("## Recommended Actions");
  lines.push("");
  for (const action of payload.recommendedActions) {
    lines.push(`- ${action}`);
  }

  const targetPath = resolve(filePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, `${lines.join("\n")}\n`, "utf8");
}

function main(): void {
  const coveragePath = "coverage/unit/coverage-summary.json";
  const mutationPath = "reports/mutation/mutation.json";
  const dependencyPath = "reports/dependency-audit/dependency-governance.json";

  const signals = [
    evaluateCoverageSignal(coveragePath),
    evaluateMutationSignal(mutationPath),
    evaluateDependencySignal(dependencyPath),
  ];

  const unresolvedFailureCount = signals.filter((signal) => signal.status === "fail").length;
  const unresolvedWarningCount = signals.filter(
    (signal) => signal.status === "warn" || signal.status === "missing"
  ).length;

  const report: FeedbackReport = {
    generatedAtIso: new Date().toISOString(),
    overallStatus: toOverallStatus(signals),
    unresolvedFailureCount,
    unresolvedWarningCount,
    signals,
    recommendedActions: buildRecommendedActions(signals),
  };

  writeJson("reports/ai-feedback/ai-failure-feedback.json", report);
  writeMarkdown("reports/ai-feedback/ai-failure-feedback.md", report);

  console.log("AI failure feedback loop summary");
  console.log(`- overall status: ${report.overallStatus}`);
  console.log(`- unresolved failures: ${report.unresolvedFailureCount}`);
  console.log(`- unresolved warnings: ${report.unresolvedWarningCount}`);
  console.log("- json report: reports/ai-feedback/ai-failure-feedback.json");
  console.log("- markdown report: reports/ai-feedback/ai-failure-feedback.md");
}

main();
