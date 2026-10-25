import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { checkStoryEnablerLinks }: {
  checkStoryEnablerLinks: (body: string) => string[];
} = createRequire(import.meta.url)("../../.github/scripts/planningChecks.cjs");

describe("Story Enabler declarations", () => {
  it.each([
    "- #87",
    "- #87\n- #86",
    "- None - This Story owns its implementation; no shared enabling work is required.",
    "- none \u2014 The implementation is contained within this Story.",
  ])("accepts an explicit reference or justified None declaration: %s", (declaration) => {
    expect(checkStoryEnablerLinks(`### Linked Enabler Issues\n${declaration}\n`)).toEqual([]);
  });

  it.each([
    "", "_No response_", "- None", "- None -", "- None - N/A",
    "- None - not applicable", "No same-feature Enabler exists.",
    "- None - This Story owns implementation.\nUnexpected extra content.",
    "- None - This Story owns implementation.\n- #87",
  ])("rejects an incomplete or contradictory declaration: %s", (declaration) => {
    expect(checkStoryEnablerLinks(`### Linked Enabler Issues\n${declaration}`)).not.toEqual([]);
  });

  it("requires the decision in the Enabler section, not another section", () => {
    expect(checkStoryEnablerLinks([
      "### Linked Enabler Issues", "_No response_",
      "### Out Of Scope", "- None - This Story owns implementation.",
    ].join("\n"))).not.toEqual([]);
  });
});
