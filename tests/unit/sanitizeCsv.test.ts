import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeFixtureCsv } from "../../src/tooling/fixtures/sanitizeCsv.js";

const syntheticFixture = join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-05-synthetic.csv");

describe("sanitizeFixtureCsv", () => {
  it("is deterministic: identical input and seed produce identical output text and sorted map entries", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-sanitize-"));
    const outputPath = join(tempDir, "sanitized.csv");
    const mapPath = join(tempDir, "sanitization-map.json");

    const firstRun = sanitizeFixtureCsv({
      inputPath: syntheticFixture,
      outputPath,
      mapPath,
      seed: "42",
      dryRun: false
    });

    const secondRun = sanitizeFixtureCsv({
      inputPath: syntheticFixture,
      outputPath,
      mapPath,
      seed: "42",
      dryRun: false
    });

    expect(firstRun.outputText).toBe(secondRun.outputText);
    expect(firstRun.mapEntries).toEqual(secondRun.mapEntries);
    const firstTokens = firstRun.mapEntries.map((e) => e.token);
    expect(firstTokens).toEqual([...firstTokens].sort());
  });

  it("repeated source values receive exactly one stable token per value and kind", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-sanitize-"));

    const result = sanitizeFixtureCsv({
      inputPath: syntheticFixture,
      outputPath: join(tempDir, "sanitized.csv"),
      mapPath: join(tempDir, "map.json"),
      seed: "42",
      dryRun: false
    });

    const byOriginal = new Map<string, string>();
    for (const entry of result.mapEntries) {
      const key = `${entry.kind}:${entry.original}`;
      if (byOriginal.has(key)) {
        expect(byOriginal.get(key)).toBe(entry.token);
      } else {
        byOriginal.set(key, entry.token);
      }
    }

    const inputText = readFileSync(syntheticFixture, "utf8");
    for (const entry of result.mapEntries) {
      expect(result.outputText).not.toContain(entry.original);
      expect(inputText).toContain(entry.original);
    }
  });

  it("preserves header, semicolon delimiter, adjacent empty fields, UTF-8 encoding, and row count", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-sanitize-"));
    const outputPath = join(tempDir, "sanitized.csv");
    const mapPath = join(tempDir, "sanitization-map.json");

    const result = sanitizeFixtureCsv({
      inputPath: syntheticFixture,
      outputPath,
      mapPath,
      seed: "42",
      dryRun: false
    });

    const sanitizedText = readFileSync(outputPath, "utf8");
    const inputText = readFileSync(syntheticFixture, "utf8");

    expect(sanitizedText.split(/\r?\n/)[0]).toBe(inputText.split(/\r?\n/)[0]);

    expect(sanitizedText).toContain(";;");

    const inputLines = inputText.trim().split(/\r?\n/);
    const outputLines = sanitizedText.trim().split(/\r?\n/);
    expect(outputLines.length).toBe(inputLines.length);

    const inputRowCount = inputLines.length - 1;
    expect(result.rowCount).toBe(inputRowCount);

    expect(Buffer.from(sanitizedText, "utf8")).toEqual(readFileSync(outputPath));
  });

  it("dry-run emits summary counts and writes no files", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-sanitize-"));
    const outputPath = join(tempDir, "dry-sanitized.csv");
    const mapPath = join(tempDir, "dry-map.json");

    const result = sanitizeFixtureCsv({
      inputPath: syntheticFixture,
      outputPath,
      mapPath,
      seed: "42",
      dryRun: true
    });

    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.mapEntries.length).toBeGreaterThan(0);
    expect(result.outputText.length).toBeGreaterThan(0);

    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(mapPath)).toBe(false);
  });

});