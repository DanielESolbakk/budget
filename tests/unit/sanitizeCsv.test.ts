import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeFixtureCsv } from "../../src/tooling/fixtures/sanitizeCsv.js";

describe("sanitizeFixtureCsv", () => {
  it("is deterministic for the same input and seed", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-sanitize-"));
    const outputPath = join(tempDir, "sanitized.csv");
    const mapPath = join(tempDir, "sanitization-map.json");
    const inputPath = join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-05-synthetic.csv");

    const firstRun = sanitizeFixtureCsv({
      inputPath,
      outputPath,
      mapPath,
      seed: "budget-test",
      dryRun: false
    });

    const secondRun = sanitizeFixtureCsv({
      inputPath,
      outputPath,
      mapPath,
      seed: "budget-test",
      dryRun: false
    });

    expect(firstRun.outputText).toBe(secondRun.outputText);
    expect(firstRun.mapEntries).toEqual(secondRun.mapEntries);
  });

  it("preserves empty fields and CSV shape", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-sanitize-"));
    const outputPath = join(tempDir, "sanitized.csv");
    const mapPath = join(tempDir, "sanitization-map.json");
    const inputPath = join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-05-synthetic.csv");

    sanitizeFixtureCsv({
      inputPath,
      outputPath,
      mapPath,
      seed: "budget-test",
      dryRun: false
    });

    const sanitizedText = readFileSync(outputPath, "utf8");
    const inputText = readFileSync(inputPath, "utf8");

    expect(sanitizedText.split(/\r?\n/)[0]).toBe(inputText.split(/\r?\n/)[0]);
    expect(sanitizedText).toContain(";;");
  });
});