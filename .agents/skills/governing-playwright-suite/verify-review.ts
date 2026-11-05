import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(isRecord(value), `${label}: expected object`);
  return value;
}

function text(value: unknown, label: string): string {
  assert.ok(typeof value === "string" && value.trim().length > 0, `${label}: expected non-empty text`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), `${label}: expected array`);
  return value;
}

const [manifestPath, reviewsPath] = process.argv.slice(2);
assert.ok(manifestPath && reviewsPath && process.argv.length === 4,
  "Usage: npx --no-install tsx verify-review.ts manifest.json accepted-reviews.json");
const manifest = record(JSON.parse(readFileSync(manifestPath, "utf8")), "manifest");
const reviews = record(JSON.parse(readFileSync(reviewsPath, "utf8")), "reviews");
const snapshot = text(manifest.snapshot, "manifest snapshot");
assert.equal(text(reviews.snapshot, "reviews snapshot"), snapshot, "Review snapshot differs from manifest snapshot");

const groups = array(manifest.groups, "groups");
assert.ok(groups.length > 0, "Manifest groups must be non-empty");
const groupIds = new Map<string, string[]>();
const expandedIds = new Set<string>();
for (const value of groups) {
  const group = record(value, "group");
  const id = text(group.group_id, "group_id");
  assert.ok(!groupIds.has(id), `Duplicate group: ${id}`);
  const ids = array(group.expanded_ids, `${id} expanded_ids`).map(value => text(value, "expanded ID"));
  assert.ok(ids.length > 0, `${id}: expanded_ids must be non-empty`);
  for (const expandedId of ids) {
    assert.ok(!expandedIds.has(expandedId), `Duplicate expanded ID: ${expandedId}`);
    expandedIds.add(expandedId);
  }
  groupIds.set(id, ids);
}

const decisions = new Set(["keep", "fix-streamline", "deduplicate-merge", "move-layer-lane", "retire", "unresolved"]);
const accepted = new Set<string>();
const unresolvedGroups: string[] = [];
let reviewedIds = 0;
for (const value of array(reviews.accepted_reviews, "accepted_reviews")) {
  const review = record(value, "accepted review");
  const id = text(review.group_id, "review group_id");
  const ids = groupIds.get(id);
  assert.ok(ids, `Unknown group: ${id}`);
  assert.ok(!accepted.has(id), `Duplicate review: ${id}`);
  const decision = text(review.decision, `${id} decision`);
  assert.ok(decisions.has(decision), `${id}: invalid decision`);
  for (const field of ["regression", "assertion", "test", "production", "alternative"]) {
    text(review[field], `${id} ${field}`);
  }
  assert.ok(typeof review.confidence === "number" && Number.isInteger(review.confidence)
    && review.confidence >= 1 && review.confidence <= 10, `${id}: confidence must be an integer from 1 to 10`);
  accepted.add(id);
  reviewedIds += ids.length;
  if (decision === "unresolved") unresolvedGroups.push(id);
}

const pendingGroups = [...groupIds.keys()].filter(id => !accepted.has(id));
const sourceReviewComplete = pendingGroups.length === 0;
console.log(JSON.stringify({
  sourceReviewComplete,
  reviewedGroups: accepted.size,
  totalGroups: groupIds.size,
  reviewedIds,
  totalIds: expandedIds.size,
  pendingGroups,
  unresolvedGroups
}, null, 2));
if (!sourceReviewComplete) process.exitCode = 1;
