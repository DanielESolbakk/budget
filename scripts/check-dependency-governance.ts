import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type Severity = "info" | "low" | "moderate" | "high" | "critical";
type FailureThreshold = Severity | "none";

interface VulnerabilityTotals {
  info?: number;
  low?: number;
  moderate?: number;
  high?: number;
  critical?: number;
  total?: number;
}

interface NpmAuditReport {
  metadata?: {
    vulnerabilities?: VulnerabilityTotals;
  };
  vulnerabilities?: Record<string, { severity?: Severity }>;
}

interface DependencyGovernanceResult {
  generatedAtIso: string;
  policy: {
    failOnOrAbove: FailureThreshold;
  };
  npmAuditExitCode: number;
  npmAuditErrorOutput: string;
  totals: Required<VulnerabilityTotals>;
  breach: boolean;
}

const FAILURE_ORDER: Record<Exclude<FailureThreshold, "none">, number> = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

function getOptionValue(args: string[], optionName: string): string | undefined {
  const index = args.indexOf(optionName);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function parseThreshold(value: string | undefined): FailureThreshold {
  const normalized = (value ?? "high").toLowerCase();
  if (normalized === "none") return "none";
  if (normalized === "info") return "info";
  if (normalized === "low") return "low";
  if (normalized === "moderate") return "moderate";
  if (normalized === "high") return "high";
  if (normalized === "critical") return "critical";

  console.error(
    `Invalid --fail-on value: ${value}. Expected one of: none, info, low, moderate, high, critical.`
  );
  process.exit(1);
}

function parseAuditJson(stdout: string): NpmAuditReport {
  try {
    return JSON.parse(stdout) as NpmAuditReport;
  } catch {
    console.error("Failed to parse npm audit JSON output.");
    process.exit(1);
  }
}

function toTotals(report: NpmAuditReport): Required<VulnerabilityTotals> {
  const fromMetadata = report.metadata?.vulnerabilities;
  if (fromMetadata) {
    return {
      info: fromMetadata.info ?? 0,
      low: fromMetadata.low ?? 0,
      moderate: fromMetadata.moderate ?? 0,
      high: fromMetadata.high ?? 0,
      critical: fromMetadata.critical ?? 0,
      total:
        fromMetadata.total ??
        (fromMetadata.info ?? 0) +
          (fromMetadata.low ?? 0) +
          (fromMetadata.moderate ?? 0) +
          (fromMetadata.high ?? 0) +
          (fromMetadata.critical ?? 0),
    };
  }

  const counts: Required<VulnerabilityTotals> = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  };

  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    const severity = vulnerability.severity;
    if (!severity || !(severity in counts)) continue;
    counts[severity] += 1;
    counts.total += 1;
  }

  return counts;
}

function hasBreach(totals: Required<VulnerabilityTotals>, threshold: FailureThreshold): boolean {
  if (threshold === "none") {
    return false;
  }

  const thresholdRank = FAILURE_ORDER[threshold];
  return (Object.keys(FAILURE_ORDER) as Array<keyof typeof FAILURE_ORDER>).some((severity) => {
    const severityRank = FAILURE_ORDER[severity];
    return severityRank >= thresholdRank && totals[severity] > 0;
  });
}

function runNpmAudit(): { report: NpmAuditReport; npmAuditExitCode: number; npmAuditErrorOutput: string } {
  const npmResult = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "npm audit --json"], {
      encoding: "utf8",
    })
    : spawnSync("npm", ["audit", "--json"], {
      encoding: "utf8",
    });

  const stdout = String(npmResult.stdout ?? "").trim();
  const stderr = String(npmResult.stderr ?? "").trim();
  const candidateOutput = stdout || stderr;

  if (!candidateOutput) {
    console.error("npm audit produced no JSON output.");
    if (stderr) {
      console.error(stderr);
    }
    process.exit(1);
  }

  return {
    report: parseAuditJson(candidateOutput),
    npmAuditExitCode: npmResult.status ?? 1,
    npmAuditErrorOutput: stderr,
  };
}

function writeReport(reportPath: string, result: DependencyGovernanceResult): void {
  const resolved = resolve(reportPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function main(): void {
  const args = process.argv.slice(2);
  const threshold = parseThreshold(getOptionValue(args, "--fail-on"));
  const reportPath =
    getOptionValue(args, "--report") ?? "reports/dependency-audit/dependency-governance.json";

  const { report, npmAuditExitCode, npmAuditErrorOutput } = runNpmAudit();
  const totals = toTotals(report);
  const breach = hasBreach(totals, threshold);

  const result: DependencyGovernanceResult = {
    generatedAtIso: new Date().toISOString(),
    policy: {
      failOnOrAbove: threshold,
    },
    npmAuditExitCode,
    npmAuditErrorOutput,
    totals,
    breach,
  };

  writeReport(reportPath, result);

  console.log("Dependency governance summary");
  console.log(`- policy fail-on: ${threshold}`);
  console.log(`- vulnerabilities total: ${totals.total}`);
  console.log(
    `- by severity: critical=${totals.critical}, high=${totals.high}, moderate=${totals.moderate}, low=${totals.low}, info=${totals.info}`
  );
  console.log(`- npm audit exit code: ${npmAuditExitCode}`);
  console.log(`- policy breach: ${breach ? "yes" : "no"}`);
  console.log(`- report: ${reportPath}`);

  if (breach) {
    process.exit(1);
  }
}

main();
