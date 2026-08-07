import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

type SkillStatus = "keep" | "prune-candidate" | "warn" | "fail";

interface SkillEntry {
  skillId: string;
  status: SkillStatus;
  reason: string;
  referenceCount: number;
  references: string[];
}

interface SkillPruningReport {
  generatedAtIso: string;
  overallStatus: "pass" | "warn" | "fail";
  keepCount: number;
  pruneCandidateCount: number;
  warningCount: number;
  failureCount: number;
  entries: SkillEntry[];
  recommendedActions: string[];
}

interface SkillsLockFile {
  version?: number;
  skills?: Record<string, { source?: string; sourceType?: string; skillPath?: string; computedHash?: string }>;
}

const PROJECT_ROOT = process.cwd();
const SKILLS_ROOT = resolve(PROJECT_ROOT, ".agents/skills");
const SKILLS_LOCK_PATH = resolve(PROJECT_ROOT, "skills-lock.json");
const SEARCH_INCLUDE_EXTENSIONS = [".md", ".yml", ".yaml", ".json", ".ts", ".tsx"];

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

function listFilesRecursively(rootPath: string): string[] {
  if (!existsSync(rootPath)) {
    return [];
  }

  const files: string[] = [];
  const stack: string[] = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "coverage") {
          continue;
        }
        stack.push(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }

  return files;
}

function listTopLevelSkills(): string[] {
  if (!existsSync(SKILLS_ROOT)) {
    return [];
  }

  return readdirSync(SKILLS_ROOT)
    .filter((name) => {
      const absolute = join(SKILLS_ROOT, name);
      return statSync(absolute).isDirectory();
    })
    .sort();
}

function listPlaywrightPacks(): string[] {
  const playwrightRoot = join(SKILLS_ROOT, "playwright-skill");
  if (!existsSync(playwrightRoot)) {
    return [];
  }

  return readdirSync(playwrightRoot)
    .filter((name) => {
      const absolute = join(playwrightRoot, name);
      if (!statSync(absolute).isDirectory()) {
        return false;
      }
      return existsSync(join(absolute, "SKILL.md"));
    })
    .sort();
}

function collectSearchCorpus(): Array<{ filePath: string; content: string }> {
  const allFiles = listFilesRecursively(PROJECT_ROOT);
  const included = allFiles.filter((filePath) => {
    if (filePath.startsWith(SKILLS_ROOT)) {
      return false;
    }
    if (filePath.includes(`${join("scripts", "ai-skill-pruning-loop.ts")}`)) {
      return false;
    }
    if (filePath.includes(`${join("reports", "ai-skill-pruning")}`)) {
      return false;
    }
    return SEARCH_INCLUDE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
  });

  const corpus: Array<{ filePath: string; content: string }> = [];
  for (const filePath of included) {
    try {
      corpus.push({
        filePath,
        content: readFileSync(filePath, "utf8"),
      });
    } catch {
      // Ignore unreadable files.
    }
  }

  return corpus;
}

function findReferences(term: string, corpus: Array<{ filePath: string; content: string }>): string[] {
  const references: string[] = [];

  for (const item of corpus) {
    if (item.content.includes(term)) {
      references.push(relative(PROJECT_ROOT, item.filePath).replaceAll("\\", "/"));
    }
  }

  return references.sort();
}

function findReferencesAny(
  terms: string[],
  corpus: Array<{ filePath: string; content: string }>
): string[] {
  const references: string[] = [];

  for (const item of corpus) {
    if (terms.some((term) => item.content.includes(term))) {
      references.push(relative(PROJECT_ROOT, item.filePath).replaceAll("\\", "/"));
    }
  }

  return references.sort();
}

function evaluateTopLevelSkills(
  installedSkills: string[],
  lockedSkills: Set<string>,
  corpus: Array<{ filePath: string; content: string }>
): SkillEntry[] {
  const entries: SkillEntry[] = [];
  const requiredRootSkills = new Set(["playwright-skill", "issue-planning-governor", "reviewing-pr-delivery"]);

  for (const skillId of installedSkills) {
    const references = findReferencesAny([skillId, `.agents/skills/${skillId}/SKILL.md`], corpus);
    const inLock = lockedSkills.has(skillId);

    if (requiredRootSkills.has(skillId)) {
      entries.push({
        skillId,
        status: "keep",
        reason: inLock
          ? "Required repository skill and tracked in lock or local policy."
          : "Required repository skill; keep even if unmanaged in skills-lock.json.",
        referenceCount: references.length,
        references,
      });
      continue;
    }

    if (references.length === 0 && !inLock) {
      entries.push({
        skillId,
        status: "prune-candidate",
        reason: "No repository references and not tracked in skills-lock.json.",
        referenceCount: references.length,
        references,
      });
      continue;
    }

    if (!inLock) {
      entries.push({
        skillId,
        status: "warn",
        reason: "Skill is referenced but not tracked in skills-lock.json.",
        referenceCount: references.length,
        references,
      });
      continue;
    }

    entries.push({
      skillId,
      status: "keep",
      reason: "Tracked in skills-lock.json.",
      referenceCount: references.length,
      references,
    });
  }

  return entries;
}

function evaluatePlaywrightPacks(
  installedPacks: string[],
  corpus: Array<{ filePath: string; content: string }>
): SkillEntry[] {
  const entries: SkillEntry[] = [];
  const requiredPacks = ["core", "ci", "pom"];

  for (const requiredPack of requiredPacks) {
    const skillId = `playwright-skill/${requiredPack}`;
    const references = findReferences(requiredPack, corpus).filter((path) =>
      path === "AGENTS.md" || path === ".github/copilot-instructions.md"
    );

    if (!installedPacks.includes(requiredPack)) {
      entries.push({
        skillId,
        status: "fail",
        reason: "Required Playwright pack is missing.",
        referenceCount: references.length,
        references,
      });
      continue;
    }

    entries.push({
      skillId,
      status: "keep",
      reason: "Required Playwright pack is installed.",
      referenceCount: references.length,
      references,
    });
  }

  for (const pack of installedPacks) {
    if (requiredPacks.includes(pack)) {
      continue;
    }

    const skillId = `playwright-skill/${pack}`;
    const references = findReferencesAny([skillId, `.agents/skills/playwright-skill/${pack}/SKILL.md`], corpus);

    if (pack === "migration") {
      entries.push({
        skillId,
        status: "prune-candidate",
        reason: "Migration pack is out of scope unless a dedicated migration issue exists.",
        referenceCount: references.length,
        references,
      });
      continue;
    }

    if (pack === "playwright-cli") {
      entries.push({
        skillId,
        status: "prune-candidate",
        reason: "CLI pack is optional and currently not required for default implementation flows.",
        referenceCount: references.length,
        references,
      });
      continue;
    }

    entries.push({
      skillId,
      status: references.length > 0 ? "warn" : "prune-candidate",
      reason:
        references.length > 0
          ? "Optional pack is referenced; verify whether continued maintenance is worth the cost."
          : "Optional pack has no references; candidate for pruning.",
      referenceCount: references.length,
      references,
    });
  }

  return entries;
}

function buildRecommendedActions(entries: SkillEntry[], lockedSkills: Set<string>, installedSkills: string[]): string[] {
  const actions: string[] = [];

  const missingRequiredPack = entries.find((entry) => entry.status === "fail");
  if (missingRequiredPack) {
    actions.push("Restore missing required Playwright packs (core, ci, pom) before accepting CI skill pruning output.");
  }

  const pruneCandidates = entries.filter((entry) => entry.status === "prune-candidate");
  if (pruneCandidates.length > 0) {
    actions.push(
      `Review prune candidates and remove unneeded skills to reduce agent prompt noise: ${pruneCandidates
        .map((entry) => entry.skillId)
        .join(", ")}.`
    );
  }

  const unmanagedInstalled = installedSkills.filter((skill) => !lockedSkills.has(skill));
  if (unmanagedInstalled.length > 0) {
    actions.push(
      `For unmanaged but required local skills, either add lock entries or document why lock management is intentionally skipped: ${unmanagedInstalled.join(", ")}.`
    );
  }

  if (actions.length === 0) {
    actions.push("No skill pruning action required right now. Keep running this loop to prevent stale skill bloat.");
  }

  return actions;
}

function toOverallStatus(entries: SkillEntry[]): "pass" | "warn" | "fail" {
  if (entries.some((entry) => entry.status === "fail")) {
    return "fail";
  }
  if (entries.some((entry) => entry.status === "warn" || entry.status === "prune-candidate")) {
    return "warn";
  }
  return "pass";
}

function writeReport(report: SkillPruningReport): void {
  const jsonPath = resolve(PROJECT_ROOT, "reports/ai-skill-pruning/ai-skill-pruning.json");
  const markdownPath = resolve(PROJECT_ROOT, "reports/ai-skill-pruning/ai-skill-pruning.md");

  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const lines: string[] = [];
  lines.push("# AI Skill Pruning Loop Report");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAtIso}`);
  lines.push(`Overall status: ${report.overallStatus}`);
  lines.push(`Keep entries: ${report.keepCount}`);
  lines.push(`Prune candidates: ${report.pruneCandidateCount}`);
  lines.push(`Warnings: ${report.warningCount}`);
  lines.push(`Failures: ${report.failureCount}`);
  lines.push("");
  lines.push("## Entries");
  lines.push("");

  for (const entry of report.entries) {
    lines.push(`- ${entry.skillId}: ${entry.status} - ${entry.reason}`);
    lines.push(`  - references: ${entry.referenceCount}`);
    if (entry.references.length > 0) {
      lines.push(`  - files: ${entry.references.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("## Recommended Actions");
  lines.push("");
  for (const action of report.recommendedActions) {
    lines.push(`- ${action}`);
  }

  writeFileSync(markdownPath, `${lines.join("\n")}\n`, "utf8");
}

function main(): void {
  const lock = readJson<SkillsLockFile>(SKILLS_LOCK_PATH);
  const lockedSkills = new Set(Object.keys(lock?.skills ?? {}));

  const installedTopLevelSkills = listTopLevelSkills();
  const installedPlaywrightPacks = listPlaywrightPacks();
  const corpus = collectSearchCorpus();

  const topLevelEntries = evaluateTopLevelSkills(installedTopLevelSkills, lockedSkills, corpus);
  const packEntries = evaluatePlaywrightPacks(installedPlaywrightPacks, corpus);
  const entries = [...topLevelEntries, ...packEntries].sort((a, b) => a.skillId.localeCompare(b.skillId));

  const keepCount = entries.filter((entry) => entry.status === "keep").length;
  const pruneCandidateCount = entries.filter((entry) => entry.status === "prune-candidate").length;
  const warningCount = entries.filter((entry) => entry.status === "warn").length;
  const failureCount = entries.filter((entry) => entry.status === "fail").length;

  const report: SkillPruningReport = {
    generatedAtIso: new Date().toISOString(),
    overallStatus: toOverallStatus(entries),
    keepCount,
    pruneCandidateCount,
    warningCount,
    failureCount,
    entries,
    recommendedActions: buildRecommendedActions(entries, lockedSkills, installedTopLevelSkills),
  };

  writeReport(report);

  console.log("AI skill pruning loop summary");
  console.log(`- overall status: ${report.overallStatus}`);
  console.log(`- keep: ${keepCount}`);
  console.log(`- prune candidates: ${pruneCandidateCount}`);
  console.log(`- warnings: ${warningCount}`);
  console.log(`- failures: ${failureCount}`);
  console.log("- json report: reports/ai-skill-pruning/ai-skill-pruning.json");
  console.log("- markdown report: reports/ai-skill-pruning/ai-skill-pruning.md");

  if (report.overallStatus === "fail") {
    process.exit(1);
  }
}

main();
