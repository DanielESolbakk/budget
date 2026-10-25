import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const workflowYaml = readFileSync(
  new URL("../../.github/workflows/planning-validation.yml", import.meta.url),
  "utf8",
);
const scriptLines = workflowYaml.split(/\r?\n/);
const scriptStart = scriptLines.findIndex((line) => line === "          script: |");
if (scriptStart === -1) {
  throw new Error("Planning validation workflow script is missing.");
}
const workflowScript = scriptLines.slice(scriptStart + 1)
  .map((line) => line.replace(/^ {12}/, ""))
  .join("\n");
const runWorkflow = new Function(
  "require", "github", "context", "core",
  `return (async () => {\n${workflowScript}\n})();`,
) as (...inputs: unknown[]) => Promise<void>;

interface PlanningIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  pull_request?: Record<string, never>;
}

async function validateStory(enablers: string, options: {
  enabler?: Partial<PlanningIssue>;
  linkedTests?: string;
  includeEnablerHeading?: boolean;
  dryRun?: boolean;
} = {}) {
  const story: PlanningIssue = {
    number: 3,
    title: "[S1.1.1] Synthetic self-contained Story",
    labels: ["user-story", "planning-invalid", "needs-grooming", "validate-planning"],
    body: [
      "### Parent Epic Issue", "- #1",
      "### Parent Feature Issue", "- #2",
      "### Linked Test Issues", options.linkedTests ?? "- #4",
      ...(options.includeEnablerHeading === false
        ? [] : ["### Linked Enabler Issues", enablers]),
      "### Out Of Scope", "Network access and unrelated implementation.",
    ].join("\n"),
  };
  const issues = new Map<number, PlanningIssue>([
    [1, { number: 1, title: "Epic", body: "", labels: ["epic"] }],
    [2, { number: 2, title: "Feature", body: "", labels: ["feature"] }],
    [3, story],
    [4, { number: 4, title: "Test", body: "", labels: ["test"] }],
    [5, {
      number: 5, title: "Enabler", labels: ["enabler"],
      body: "### Parent Feature Issue\n- #2",
      ...options.enabler,
    }],
  ]);
  const comments: string[] = [];
  const failures: string[] = [];
  const github = { rest: { issues: {
    get: vi.fn(async ({ issue_number }: { issue_number: number }) => {
      const issue = issues.get(issue_number);
      if (!issue) throw new Error(`Synthetic issue #${issue_number} does not exist.`);
      return { data: issue };
    }),
    addLabels: vi.fn(async ({ labels }: { labels: string[] }) => {
      story.labels.push(...labels.filter((label) => !story.labels.includes(label)));
    }),
    removeLabel: vi.fn(async ({ name }: { name: string }) => {
      story.labels = story.labels.filter((label) => label !== name);
    }),
    listComments: vi.fn(async () => ({ data: [] })),
    createComment: vi.fn(async ({ body }: { body: string }) => { comments.push(body); }),
  } } };
  const context = {
    repo: { owner: "synthetic-owner", repo: "synthetic-planning" },
    eventName: "workflow_dispatch",
    payload: { inputs: { issue_numbers: "3", dry_run: String(options.dryRun ?? false) } },
  };
  const core = {
    info: vi.fn(), warning: vi.fn(),
    setFailed: vi.fn((message: string) => { failures.push(message); }),
  };
  const workflowRequire = (path: string) => require(
    fileURLToPath(new URL(`../../${path}`, import.meta.url)),
  );

  await runWorkflow(workflowRequire, github, context, core);
  return { story, comments, failures };
}

describe("planning validation workflow", () => {
  it.each([
    "- None - This Story owns its allocation implementation; no shared infrastructure is required.",
    "- None \u2014 This Story owns its allocation implementation; no shared infrastructure is required.",
    "- #5",
  ])("accepts an explicit Enabler decision while preserving semantic grooming: %s", async (declaration) => {
    const result = await validateStory(declaration);

    expect(result.comments).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.story.labels).not.toContain("planning-invalid");
    expect(result.story.labels).not.toContain("validate-planning");
    expect(result.story.labels).toContain("needs-grooming");
  });

  it.each([
    "", "_No response_", "- None", "- None -", "- None - N/A",
    "No Enabler.", "- None - This Story owns implementation.\n- #5",
  ])("rejects missing, unexplained, or contradictory Enabler declarations: %s", async (declaration) => {
    const result = await validateStory(declaration);

    expect(result.story.labels).toContain("planning-invalid");
    expect(result.comments.join("\n")).toContain("Linked Enabler Issues");
  });

  it("does not borrow a no-Enabler declaration from a different section", async () => {
    const result = await validateStory("", { includeEnablerHeading: false });

    expect(result.story.labels).toContain("planning-invalid");
    expect(result.comments.join("\n")).toContain("Linked Enabler Issues");
  });

  it.each([
    { declaration: "- #5", enabler: { labels: ["test"] }, error: "instead of enabler" },
    { declaration: "- #5", enabler: { pull_request: {} }, error: "not pull requests" },
    { declaration: "- #999", enabler: {}, error: "could not be loaded" },
  ])("still validates real Enabler references: $error", async ({ declaration, enabler, error }) => {
    const result = await validateStory(declaration, { enabler });

    expect(result.story.labels).toContain("planning-invalid");
    expect(result.comments.join("\n")).toContain(error);
  });

  it("still requires linked Tests for a self-contained Story", async () => {
    const result = await validateStory(
      "- None - This Story owns its implementation.", { linkedTests: "" },
    );

    expect(result.story.labels).toContain("planning-invalid");
    expect(result.comments.join("\n")).toContain("Linked Test Issues");
  });

  it("does not mutate issue records during a dry run", async () => {
    const result = await validateStory(
      "- None - This Story owns its implementation.", { dryRun: true },
    );

    expect(result.story.labels).toEqual([
      "user-story", "planning-invalid", "needs-grooming", "validate-planning",
    ]);
    expect(result.comments).toEqual([]);
    expect(result.failures).toEqual([]);
  });
});
