import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preserveFailedRunDatabase } from "../playwright/fixtures/preserveFailedRunDatabase.js";

describe("preserveFailedRunDatabase", () => {
  it("copies the failed-run database and records its temporary source path", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-playwright-database-artifact-"));
    const databasePath = join(directory, "ledger.sqlite");
    const artifactDirectory = join(directory, "artifacts");
    const databaseBytes = Buffer.from("synthetic SQLite database");

    try {
      writeFileSync(databasePath, databaseBytes);

      const artifacts = preserveFailedRunDatabase({
        databasePath,
        artifactDirectory,
        status: "failed",
        expectedStatus: "passed",
      });

      expect(artifacts).toEqual({
        databaseFile: join(artifactDirectory, "ledger.sqlite"),
        sourcePathFile: join(artifactDirectory, "database-path.txt"),
      });
      expect(readFileSync(join(artifactDirectory, "ledger.sqlite"))).toEqual(databaseBytes);
      expect(readFileSync(join(artifactDirectory, "database-path.txt"), "utf8")).toBe(databasePath);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not create diagnostic artifacts when the test passes", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-playwright-database-success-"));
    const databasePath = join(directory, "ledger.sqlite");
    const artifactDirectory = join(directory, "artifacts");

    try {
      writeFileSync(databasePath, "synthetic SQLite database");

      expect(preserveFailedRunDatabase({
        databasePath,
        artifactDirectory,
        status: "passed",
        expectedStatus: "passed",
      })).toBeUndefined();
      expect(existsSync(artifactDirectory)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not retain diagnostics before a test status is available", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-playwright-database-pending-"));
    const databasePath = join(directory, "ledger.sqlite");
    const artifactDirectory = join(directory, "artifacts");

    try {
      writeFileSync(databasePath, "synthetic SQLite database");

      expect(preserveFailedRunDatabase({
        databasePath,
        artifactDirectory,
        status: undefined,
        expectedStatus: "passed",
      })).toBeUndefined();
      expect(existsSync(artifactDirectory)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
