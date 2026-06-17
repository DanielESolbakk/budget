import fs from "node:fs";
import path from "node:path";

type MappingRow = {
  acId: string;
  testLevel: string;
  testId: string;
  testFilePath: string;
};

function normalizeAcId(value: string): string | null {
  const match = String(value || "").toUpperCase().match(/AC[-_\s]?(\d+)/i);
  if (!match) return null;
  return `AC-${match[1]}`;
}

function parseIssueReferences(value: string): number[] {
  const refs = new Set<number>();
  const regex = /(?:^|[\s,(])(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d+)\b/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(String(value || ""))) !== null) {
    refs.add(Number(match[1]));
  }

  return [...refs];
}

function extractSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
  const match = String(markdown || "").match(regex);
  return match ? String(match[2] || "").trim() : "";
}

function parseStrictRows(sectionBody: string): { rows: MappingRow[]; invalidLines: string[] } {
  const rows: MappingRow[] = [];
  const invalidLines: string[] = [];
  const lines = String(sectionBody || "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\|\s*AC\s*ID\b/i.test(line)) continue;
    if (/^\|\s*---/i.test(line)) continue;

    const bulletMatch = line.match(/^[-*]\s*(.+)$/);
    if (!bulletMatch) {
      invalidLines.push(rawLine);
      continue;
    }

    const payload = bulletMatch[1]!.trim();
    const parts = payload.split("|").map((part) => part.trim());
    if (parts.length !== 4) {
      invalidLines.push(rawLine);
      continue;
    }

    const [acRaw, levelRaw, testIdRaw, filePathRaw] = parts as [string, string, string, string];
    const acId = normalizeAcId(acRaw);
    if (!acId) {
      invalidLines.push(rawLine);
      continue;
    }

    rows.push({
      acId,
      testLevel: levelRaw,
      testId: testIdRaw,
      testFilePath: filePathRaw.replace(/^`|`$/g, ""),
    });
  }

  return { rows, invalidLines };
}

function failWith(messages: string[]): never {
  for (const message of messages) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

async function fetchIssueBody(owner: string, repo: string, issueNumber: number, token: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to load issue #${issueNumber}: ${response.status}`);
  }

  const issue = (await response.json()) as { body?: string; pull_request?: unknown };
  if (issue.pull_request) {
    throw new Error(`Primary planning reference #${issueNumber} is a pull request, not an issue.`);
  }

  return issue.body || "";
}

async function main(): Promise<void> {
  const eventName = process.env.GITHUB_EVENT_NAME || "";
  if (eventName !== "pull_request") {
    console.log("verify-ac-traceability: skipping non-pull_request event.");
    return;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    failWith(["GITHUB_EVENT_PATH not found for pull_request validation."]);
  }

  const payload = JSON.parse(fs.readFileSync(eventPath, "utf8")) as {
    pull_request?: { body?: string };
    repository?: { full_name?: string };
  };

  const prBody = payload.pull_request?.body || "";
  const linkedPlanning = extractSection(prBody, "Linked Planning Issue");
  if (!linkedPlanning) {
    failWith(["Missing 'Linked Planning Issue' section in PR body."]);
  }

  const primaryMatch = linkedPlanning.match(/Primary planning issue:\s*(.+)$/im);
  const primaryRefs = parseIssueReferences(primaryMatch ? primaryMatch[1]! : "");
  if (primaryRefs.length !== 1) {
    failWith(["Primary planning issue must include exactly one issue reference like #123."]);
  }

  const fullName = payload.repository?.full_name || "";
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    failWith(["Could not determine repository owner/name from event payload."]);
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (!token) {
    failWith(["GITHUB_TOKEN (or GH_TOKEN) is required to fetch primary planning issue."]);
  }

  let issueBody = "";
  try {
    issueBody = await fetchIssueBody(owner, repo, primaryRefs[0]!, token);
  } catch (error) {
    failWith([error instanceof Error ? error.message : "Unknown error fetching planning issue."]);
  }

  const acIds = new Set<string>();
  const acRegex = /\bAC[-_\s]?\d+\b/gi;
  let acMatch: RegExpExecArray | null;
  while ((acMatch = acRegex.exec(issueBody)) !== null) {
    const normalized = normalizeAcId(acMatch[0]);
    if (normalized) acIds.add(normalized);
  }

  if (acIds.size === 0) {
    failWith(["Primary planning issue has no AC IDs. Add AC-1, AC-2 style criteria first."]);
  }

  const mappingSection = extractSection(prBody, "Acceptance Criteria to Test Mapping");
  if (!mappingSection) {
    failWith(["Missing 'Acceptance Criteria to Test Mapping' section in PR body."]);
  }

  const { rows, invalidLines } = parseStrictRows(mappingSection);
  const messages: string[] = [];
  if (invalidLines.length > 0) {
    messages.push(
      "Each mapping line must use: '- AC-<n> | <test-level> | <test-id> | <test-file-path>'. Invalid lines: " +
        invalidLines.map((line) => `\"${line.trim()}\"`).join(", ")
    );
  }

  if (rows.length === 0) {
    messages.push("No valid AC mapping rows found.");
  }

  const allowedLevels = new Set(["unit", "integration", "e2e", "end-to-end", "performance", "privacy", "no-network"]);
  const mappedByAc = new Map<string, number>();

  for (const row of rows) {
    mappedByAc.set(row.acId, (mappedByAc.get(row.acId) || 0) + 1);

    if (!allowedLevels.has(row.testLevel.toLowerCase())) {
      messages.push(`Invalid test-level '${row.testLevel}' for ${row.acId}.`);
    }

    if (!row.testId) {
      messages.push(`Missing test-id for ${row.acId}.`);
      continue;
    }

    if (!row.testFilePath.includes("/")) {
      messages.push(`${row.acId} must reference a repository-relative test file path, not a workflow/job name.`);
      continue;
    }

    const resolved = path.resolve(process.cwd(), row.testFilePath);
    if (!fs.existsSync(resolved)) {
      messages.push(`${row.acId} references missing file '${row.testFilePath}'.`);
      continue;
    }

    const contents = fs.readFileSync(resolved, "utf8");
    if (!contents.includes(row.testId)) {
      messages.push(`${row.acId} test-id '${row.testId}' not found in '${row.testFilePath}'.`);
    }

    const hasAcTag = contents.includes(row.acId) || contents.includes(`@ac(${row.acId})`);
    if (!hasAcTag) {
      messages.push(`${row.acId} tag not found in '${row.testFilePath}'. Include '${row.acId}' or '@ac(${row.acId})'.`);
    }
  }

  for (const acId of acIds) {
    if (!mappedByAc.has(acId)) {
      messages.push(`Missing mapping row for ${acId}.`);
    }
  }

  if (messages.length > 0) {
    failWith(messages);
  }

  console.log(`verify-ac-traceability: validated ${acIds.size} AC ID(s) with ${rows.length} mapping row(s).`);
}

main().catch((error) => {
  failWith([error instanceof Error ? error.message : "Unhandled verify-ac-traceability error."]);
});
