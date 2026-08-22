/**
 * Unit tests for the ImportJob schema (AC-1 from issue #32).
 *
 * Verifies that the ImportJob type carries source identity, adapter identity,
 * transaction candidate count, and explicit validation failure count through
 * the shared domain contract.
 */

import { describe, expect, it } from "vitest";
import type { ImportJob } from "../../src/domain/types.js";

describe("ImportJob schema", () => {
  describe("AC-1: required fields", () => {
    it("accepts a minimal import job with required fields only", () => {
      const job: ImportJob = {
        id: "job-1",
        householdId: "hh-1",
        sourceType: "pdf",
        sourceName: "statement.txt",
        startedAtIso: "2026-05-01T10:00:00Z",
      };

      expect(job.id).toBe("job-1");
      expect(job.householdId).toBe("hh-1");
      expect(job.sourceType).toBe("pdf");
      expect(job.sourceName).toBe("statement.txt");
      expect(job.startedAtIso).toBe("2026-05-01T10:00:00Z");
    });

    it("accepts source types: csv, pdf, and manual", () => {
      const types: ImportJob["sourceType"][] = ["csv", "pdf", "manual"];
      for (const sourceType of types) {
        const job: ImportJob = {
          id: `job-${sourceType}`,
          householdId: "hh-1",
          sourceType,
          sourceName: "file",
          startedAtIso: "2026-05-01T10:00:00Z",
        };
        expect(job.sourceType).toBe(sourceType);
      }
    });
  });

  describe("AC-1: adapter identity", () => {
    it("carries adapter identity when present", () => {
      const job: ImportJob = {
        id: "job-2",
        householdId: "hh-1",
        sourceType: "pdf",
        sourceName: "statement.txt",
        adapterId: "rogaland-sparebank-text-v1",
        startedAtIso: "2026-05-01T10:00:00Z",
        provenance: {
          sourceIdentity: "no.rogaland-sparebank.statement-text",
          adapterId: "rogaland-sparebank-text-v1",
          storyAnchor: {
            enablerIssueId: "32",
            featureIssueId: "15",
          },
        },
      };

      expect(job.adapterId).toBe("rogaland-sparebank-text-v1");
      expect(job.provenance?.sourceIdentity).toBe("no.rogaland-sparebank.statement-text");
      expect(job.provenance?.storyAnchor).toEqual({
        enablerIssueId: "32",
        featureIssueId: "15",
      });
    });

    it("adapterId is optional for non-adapter imports", () => {
      const job: ImportJob = {
        id: "job-3",
        householdId: "hh-1",
        sourceType: "manual",
        sourceName: "manual",
        startedAtIso: "2026-05-01T10:00:00Z",
      };

      expect(job.adapterId).toBeUndefined();
    });
  });

  describe("AC-1: transaction candidate count", () => {
    it("carries candidateCount when present", () => {
      const job: ImportJob = {
        id: "job-4",
        householdId: "hh-1",
        sourceType: "pdf",
        sourceName: "statement.txt",
        adapterId: "rogaland-sparebank-text-v1",
        candidateCount: 12,
        startedAtIso: "2026-05-01T10:00:00Z",
      };

      expect(job.candidateCount).toBe(12);
    });
  });

  describe("AC-1: validation failure count", () => {
    it("carries validationFailureCount when present", () => {
      const job: ImportJob = {
        id: "job-5",
        householdId: "hh-1",
        sourceType: "pdf",
        sourceName: "statement.txt",
        adapterId: "rogaland-sparebank-text-v1",
        candidateCount: 0,
        validationFailureCount: 3,
        startedAtIso: "2026-05-01T10:00:00Z",
      };

      expect(job.validationFailureCount).toBe(3);
    });

    it("validationFailureCount of zero is distinct from undefined", () => {
      const job: ImportJob = {
        id: "job-6",
        householdId: "hh-1",
        sourceType: "pdf",
        sourceName: "statement.txt",
        candidateCount: 5,
        validationFailureCount: 0,
        startedAtIso: "2026-05-01T10:00:00Z",
      };

      expect(job.validationFailureCount).toBe(0);
      expect(job.validationFailureCount).not.toBeUndefined();
    });
  });

  describe("AC-1: provenance fields", () => {
    it("carries finishedAtIso when import completes", () => {
      const job: ImportJob = {
        id: "job-7",
        householdId: "hh-1",
        sourceType: "pdf",
        sourceName: "statement.txt",
        startedAtIso: "2026-05-01T10:00:00Z",
        finishedAtIso: "2026-05-01T10:00:01Z",
      };

      expect(job.finishedAtIso).toBe("2026-05-01T10:00:01Z");
    });

    it("finishedAtIso is optional for in-progress jobs", () => {
      const job: ImportJob = {
        id: "job-8",
        householdId: "hh-1",
        sourceType: "pdf",
        sourceName: "statement.txt",
        startedAtIso: "2026-05-01T10:00:00Z",
      };

      expect(job.finishedAtIso).toBeUndefined();
    });
  });
});
