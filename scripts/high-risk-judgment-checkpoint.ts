import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type RiskLevel = "low" | "medium" | "high";

interface AiFeedbackReport {
  overallStatus?: "pass" | "warn" | "fail";
  unresolvedFailureCount?: number;
  unresolvedWarningCount?: number;
}

interface DependencyReport {
  breach?: boolean;
  totals?: {
    critical?: number;
    high?: number;
    moderate?: number;
  };
}

interface MutationReport {
  files?: Record<string, { mutants?: Array<{ status?: string }> }>;
}

interface RiskCheckpointReport {
  generatedAtIso: string;
  riskLevel: RiskLevel;
  judgmentRequired: boolean;
  signals: {
    aiFeedbackStatus: string;
    aiFeedbackFailures: number;
    aiFeedbackWarnings: number;
    dependencyBreach: boolean;
    dependencyCritical: number;
    dependencyHigh: number;
    mutationSurvived: number;
    mutationTimeout: number;
  };
  rationale: string[];
  recommendedActions: string[];
}

function readJson<T>(filePath: string): T | undefined {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(resolved, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function summarizeMutation(report: MutationReport | undefined): { survived: number; timeout: number } {
  let survived = 0;
  let timeout = 0;

  for (const file of Object.values(report?.files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      if (mutant.status === "Survived") survived += 1;
      if (mutant.status === "Timeout") timeout += 1;
    }
  }

  return { survived, timeout };
}

function classifyRisk(input: {
  aiFeedbackStatus: string;
  aiFeedbackFailures: number;
  dependencyCritical: number;
  dependencyHigh: number;
  dependencyBreach: boolean;
  mutationSurvived: number;
  mutationTimeout: number;
}): { riskLevel: RiskLevel; rationale: string[] } {
  const rationale: string[] = [];

  if (input.dependencyCritical > 0) {
    rationale.push("Critical dependency vulnerabilities detected.");
  }
  if (input.dependencyHigh > 0) {
    rationale.push("High dependency vulnerabilities detected.");
  }
  if (input.dependencyBreach) {
    rationale.push("Dependency governance policy is currently breached.");
  }
  if (input.aiFeedbackFailures > 0 || input.aiFeedbackStatus === "fail") {
    rationale.push("AI quality feedback loop reports unresolved failures.");
  }
  if (input.mutationSurvived > 25) {
    rationale.push("High count of surviving mutants indicates weak behavior assertions.");
  }
  if (input.mutationTimeout > 0) {
    rationale.push("Mutation test timeouts indicate potential non-determinism or expensive tests.");
  }

  if (input.dependencyCritical > 0 || input.aiFeedbackFailures >= 2) {
    return { riskLevel: "high", rationale };
  }

  if (input.dependencyHigh > 0 || input.dependencyBreach || input.mutationSurvived > 0) {
    return { riskLevel: "medium", rationale };
  }

  return {
    riskLevel: "low",
    rationale: rationale.length > 0 ? rationale : ["No elevated risk signals detected from current artifacts."],
  };
}

function buildRecommendedActions(report: RiskCheckpointReport): string[] {
  const actions: string[] = [];

  if (report.riskLevel === "high") {
    actions.push("Require explicit PR rationale in the High-Risk Judgment Checkpoint section before merge.");
    actions.push("Document rollback plan and compensating controls for unresolved failures.");
  }

  if (report.signals.dependencyBreach) {
    actions.push("Address high/critical vulnerabilities and re-run dependency governance signal.");
  }

  if (report.signals.mutationSurvived > 0) {
    actions.push("Prioritize survived mutants in deterministic domain modules before expanding scope.");
  }

  if (report.signals.aiFeedbackFailures > 0) {
    actions.push("Resolve failing coverage/dependency findings from AI feedback report before release cut.");
  }

  if (actions.length === 0) {
    actions.push("No additional checkpoint action required for current risk posture.");
  }

  return actions;
}

function writeReports(payload: RiskCheckpointReport): void {
  const jsonPath = resolve("reports/high-risk-checkpoint/high-risk-checkpoint.json");
  const mdPath = resolve("reports/high-risk-checkpoint/high-risk-checkpoint.md");

  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const lines: string[] = [];
  lines.push("# High-Risk Judgment Checkpoint");
  lines.push("");
  lines.push(`Generated at: ${payload.generatedAtIso}`);
  lines.push(`Risk level: ${payload.riskLevel}`);
  lines.push(`Judgment required: ${payload.judgmentRequired ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Signals");
  lines.push("");
  lines.push(`- AI feedback status: ${payload.signals.aiFeedbackStatus}`);
  lines.push(`- AI unresolved failures: ${payload.signals.aiFeedbackFailures}`);
  lines.push(`- AI unresolved warnings: ${payload.signals.aiFeedbackWarnings}`);
  lines.push(`- Dependency breach: ${payload.signals.dependencyBreach ? "yes" : "no"}`);
  lines.push(`- Dependency critical/high: ${payload.signals.dependencyCritical}/${payload.signals.dependencyHigh}`);
  lines.push(`- Mutation survived/timeout: ${payload.signals.mutationSurvived}/${payload.signals.mutationTimeout}`);
  lines.push("");
  lines.push("## Rationale");
  lines.push("");
  for (const reason of payload.rationale) {
    lines.push(`- ${reason}`);
  }
  lines.push("");
  lines.push("## Recommended Actions");
  lines.push("");
  for (const action of payload.recommendedActions) {
    lines.push(`- ${action}`);
  }

  writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
}

function main(): void {
  const aiFeedback = readJson<AiFeedbackReport>("reports/ai-feedback/ai-failure-feedback.json");
  const dependency = readJson<DependencyReport>("reports/dependency-audit/dependency-governance.json");
  const mutation = readJson<MutationReport>("reports/mutation/mutation.json");

  const mutationSummary = summarizeMutation(mutation);

  const signalSummary = {
    aiFeedbackStatus: aiFeedback?.overallStatus ?? "missing",
    aiFeedbackFailures: aiFeedback?.unresolvedFailureCount ?? 0,
    aiFeedbackWarnings: aiFeedback?.unresolvedWarningCount ?? 0,
    dependencyBreach: dependency?.breach ?? false,
    dependencyCritical: dependency?.totals?.critical ?? 0,
    dependencyHigh: dependency?.totals?.high ?? 0,
    mutationSurvived: mutationSummary.survived,
    mutationTimeout: mutationSummary.timeout,
  };

  const risk = classifyRisk({
    aiFeedbackStatus: signalSummary.aiFeedbackStatus,
    aiFeedbackFailures: signalSummary.aiFeedbackFailures,
    dependencyCritical: signalSummary.dependencyCritical,
    dependencyHigh: signalSummary.dependencyHigh,
    dependencyBreach: signalSummary.dependencyBreach,
    mutationSurvived: signalSummary.mutationSurvived,
    mutationTimeout: signalSummary.mutationTimeout,
  });

  const report: RiskCheckpointReport = {
    generatedAtIso: new Date().toISOString(),
    riskLevel: risk.riskLevel,
    judgmentRequired: risk.riskLevel !== "low",
    signals: signalSummary,
    rationale: risk.rationale,
    recommendedActions: [],
  };

  report.recommendedActions = buildRecommendedActions(report);

  writeReports(report);

  console.log("High-risk judgment checkpoint summary");
  console.log(`- risk level: ${report.riskLevel}`);
  console.log(`- judgment required: ${report.judgmentRequired ? "yes" : "no"}`);
  console.log("- json report: reports/high-risk-checkpoint/high-risk-checkpoint.json");
  console.log("- markdown report: reports/high-risk-checkpoint/high-risk-checkpoint.md");

  if (report.riskLevel === "high") {
    process.exit(1);
  }
}

main();
