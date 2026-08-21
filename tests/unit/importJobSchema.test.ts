import { describe, expect, it } from "vitest";
import type { ImportJob } from "../../src/domain/types.js";

describe("import job schema", () => {
  it("supports parser provenance with source identity, adapter identity, and story anchor", () => {
    const importJob: ImportJob = {
      id: "import-pdf-1",
      householdId: "hh-1",
      sourceType: "pdf",
      sourceName: "tests/fixtures/synthetic/rogaland-2026-05-statement.txt",
      startedAtIso: "2026-05-31T12:00:00Z",
      finishedAtIso: "2026-05-31T12:00:01Z",
      provenance: {
        sourceIdentity: "no.rogaland-sparebank.statement-text",
        adapterId: "rogaland-sparebank-text-v1",
        storyAnchor: {
          enablerIssueId: "32",
          featureIssueId: "15",
        },
      },
    };

    expect(importJob.provenance?.sourceIdentity).toBe("no.rogaland-sparebank.statement-text");
    expect(importJob.provenance?.adapterId).toBe("rogaland-sparebank-text-v1");
    expect(importJob.provenance?.storyAnchor).toEqual({
      enablerIssueId: "32",
      featureIssueId: "15",
    });
  });

  it("keeps provenance optional for non-adapter import jobs", () => {
    const importJob: ImportJob = {
      id: "import-csv-1",
      householdId: "hh-1",
      sourceType: "csv",
      sourceName: "sample.csv",
      startedAtIso: "2026-05-31T12:00:00Z",
    };

    expect(importJob.provenance).toBeUndefined();
  });
});
