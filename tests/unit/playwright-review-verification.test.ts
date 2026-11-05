import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const verifier = resolve(".agents/skills/governing-playwright-suite/verify-review.ts");
const manifest = {
  snapshot: "synthetic-revision-a",
  groups: [
    { group_id: "G1", expanded_ids: ["desktop-case", "compact-case"] },
    { group_id: "G2", expanded_ids: ["persistence-case"] }
  ]
};

function acceptedRow(group_id: string) {
  return {
    group_id,
    decision: "keep",
    regression: "Saved category disappears after restart.",
    assertion: "Reloaded category control has the saved value.",
    test: "tests/playwright/synthetic.spec.ts:20",
    production: "src/app/synthetic.ts:30",
    alternative: "Parser unit assertions do not exercise renderer reload.",
    confidence: 8
  };
}

describe("Playwright accepted-review verification", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "budget-playwright-review-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function run(accepted_reviews: unknown, sourceManifest: unknown = manifest, snapshot = manifest.snapshot) {
    const manifestPath = join(directory, "manifest.json");
    const reviewsPath = join(directory, "accepted-reviews.json");
    writeFileSync(manifestPath, JSON.stringify(sourceManifest));
    writeFileSync(reviewsPath, JSON.stringify({ snapshot, accepted_reviews }));
    return spawnSync(process.execPath, ["--import", "tsx", verifier, manifestPath, reviewsPath], {
      encoding: "utf8"
    });
  }

  it("reports all accepted groups and their expanded variants as source-reviewed", () => {
    const result = run([acceptedRow("G1"), acceptedRow("G2")]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      sourceReviewComplete: true,
      reviewedGroups: 2,
      totalGroups: 2,
      reviewedIds: 3,
      totalIds: 3,
      pendingGroups: [],
      unresolvedGroups: []
    });
  });

  it("does not mistake complete assignments for complete accepted reviews", () => {
    const result = run([acceptedRow("G1")]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      sourceReviewComplete: false,
      reviewedGroups: 1,
      reviewedIds: 2,
      pendingGroups: ["G2"]
    });
  });

  it("keeps all groups pending when no review has been accepted", () => {
    const result = run([]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      reviewedGroups: 0,
      reviewedIds: 0,
      pendingGroups: ["G1", "G2"]
    });
  });

  it.each([
    ["duplicate review", [acceptedRow("G1"), acceptedRow("G1")], /Duplicate review/],
    ["unknown group", [acceptedRow("G3")], /Unknown group/],
    ["missing assertion", [{ ...acceptedRow("G1"), assertion: " " }], /assertion/],
    ["invalid decision", [{ ...acceptedRow("G1"), decision: "done" }], /decision/],
    ["invalid confidence", [{ ...acceptedRow("G1"), confidence: 11 }], /confidence/]
  ])("rejects %s instead of counting it as reviewed", (_name, rows, diagnostic) => {
    const result = run(rows);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(diagnostic);
    expect(result.stdout).toBe("");
  });

  it("rejects reviews from a different snapshot", () => {
    const result = run([acceptedRow("G1")], manifest, "synthetic-revision-b");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/snapshot/);
  });

  it("rejects expanded IDs assigned to more than one group", () => {
    const result = run([], {
      ...manifest,
      groups: [
        { group_id: "G1", expanded_ids: ["desktop-case"] },
        { group_id: "G2", expanded_ids: ["desktop-case"] }
      ]
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Duplicate expanded ID/);
  });

  it("rejects duplicated group IDs and empty manifests", () => {
    for (const groups of [[manifest.groups[0], manifest.groups[0]], []]) {
      const result = run([], { ...manifest, groups });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Duplicate group|non-empty/);
    }
  });

  it("distinguishes reviewed unresolved decisions from requirement sign-off", () => {
    const result = run([
      { ...acceptedRow("G1"), decision: "unresolved" },
      acceptedRow("G2")
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      sourceReviewComplete: true,
      unresolvedGroups: ["G1"]
    });
  });
});
