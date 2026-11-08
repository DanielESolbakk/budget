import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseFixtureCsv, readFixtureCsv } from "../../src/tooling/fixtures/fixtureCsv.js";
import { sanitizeFixtureCsv, type SanitizationMapEntry } from "../../src/tooling/fixtures/sanitizeCsv.js";

const syntheticFixture = join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-05-synthetic.csv");
const temporaryDirectories = new Set<string>();

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

function tsxCliPath(): string {
  return join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
}

describe("sanitizeFixtureCsv", () => {
  it("rejects normalized input aliases before reading or writing files", () => {
    const directory = createTemporaryDirectory("budget-sanitize-alias-");
    const inputPath = join(directory, "input.csv");
    const outputPath = relative(process.cwd(), inputPath);
    expect(() => sanitizeFixtureCsv({ inputPath, outputPath, mapPath: join(directory, "map.json"), seed: "42", dryRun: false })).toThrow(/distinct/i);
  });
  it.runIf(process.platform === "win32")("rejects differently cased Windows input aliases", () => {
    const directory = createTemporaryDirectory("budget-sanitize-case-");
    const inputPath = join(directory, "input.csv");
    expect(() => sanitizeFixtureCsv({ inputPath, outputPath: inputPath.toUpperCase(), mapPath: join(directory, "map.json"), seed: "42", dryRun: false })).toThrow(/distinct/i);
  });
  it.each(["input-output", "input-map", "output-map"])("rejects colliding %s paths without overwriting input", (collision) => {
    const directory = createTemporaryDirectory("budget-sanitize-paths-");
    const inputPath = join(directory, "input.csv");
    const outputPath = collision === "input-output" ? inputPath : join(directory, "output.csv");
    const mapPath = collision === "input-map" ? inputPath : collision === "output-map" ? outputPath : join(directory, "map.json");
    const source = "Beskrivelse;Extra\nSHOP;retained\n";
    writeFileSync(inputPath, source);
    expect(() => sanitizeFixtureCsv({ inputPath, outputPath, mapPath, seed: "42", dryRun: false })).toThrow(/distinct/i);
    expect(readFileSync(inputPath, "utf8")).toBe(source);
  });
  it("preserves escaped non-tokenized cells and leaves the source unchanged", () => {
    const directory = createTemporaryDirectory("budget-sanitize-escaped-");
    const inputPath = join(directory, "input.csv");
    const outputPath = join(directory, "output.csv");
    const mapPath = join(directory, "map.json");
    const source = 'Beskrivelse;Extra\nSHOP;"retained; ""Øre""\nsecond line "\n';
    writeFileSync(inputPath, source);
    const result = sanitizeFixtureCsv({ inputPath, outputPath, mapPath, seed: "42", dryRun: false });
    expect(parseFixtureCsv(result.outputText)).toEqual({
      header: ["Beskrivelse", "Extra"],
      rows: [[expect.stringMatching(/^MERCHANT-[A-F0-9]{10}$/), 'retained; "Øre"\nsecond line ']],
    });
    expect(readFileSync(inputPath, "utf8")).toBe(source);
    expect(readFileSync(outputPath, "utf8")).toBe(result.outputText);
    expect(JSON.parse(readFileSync(mapPath, "utf8"))).toEqual(result.mapEntries);
    expect(result.mapEntries).toEqual([expect.objectContaining({ kind: "MERCHANT", original: "SHOP" })]);
    const repeated = sanitizeFixtureCsv({ inputPath, outputPath, mapPath, seed: "42", dryRun: true });
    expect(repeated).toEqual(result);
  });
  it("rejects malformed widths before writing outputs", () => {
    const directory = createTemporaryDirectory("budget-sanitize-invalid-");
    const inputPath = join(directory, "input.csv");
    const outputPath = join(directory, "output.csv");
    const mapPath = join(directory, "map.json");
    writeFileSync(inputPath, "Beskrivelse;Extra\nSHOP;one;two\n");
    expect(() => sanitizeFixtureCsv({ inputPath, outputPath, mapPath, seed: "42", dryRun: false })).toThrow(/Row 2.*expected 2/);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(mapPath)).toBe(false);
  });
  it("is deterministic: identical input and seed produce identical output text and sorted map entries", () => {
    const tempDir = createTemporaryDirectory("budget-sanitize-");
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
    expect(firstRun.rowCount).toBe(secondRun.rowCount);
    const firstTokens = firstRun.mapEntries.map((entry) => entry.token);
    expect(firstTokens).toEqual([...firstTokens].sort());
  });

  it("repeated source values receive exactly one stable token per value and kind", () => {
    const tempDir = createTemporaryDirectory("budget-sanitize-");
    const outputPath = join(tempDir, "sanitized.csv");
    const mapPath = join(tempDir, "map.json");

    const result = sanitizeFixtureCsv({
      inputPath: syntheticFixture,
      outputPath,
      mapPath,
      seed: "42",
      dryRun: false
    });

    const input = readFixtureCsv(syntheticFixture);
    const output = parseFixtureCsv(result.outputText);
    const repeatedCells = [
      { columnName: "Mottakernavn", kind: "PARTY", original: "USER_1" },
      { columnName: "Fra konto", kind: "ACCT", original: "ACCT-001" }
    ];

    for (const repeatedCell of repeatedCells) {
      const columnIndex = input.header.indexOf(repeatedCell.columnName);
      const rowIndexes = input.rows.reduce<number[]>((indexes, row, rowIndex) => {
        if (row[columnIndex] === repeatedCell.original) {
          indexes.push(rowIndex);
        }
        return indexes;
      }, []);
      const matchingEntry = result.mapEntries.find((entry) => {
        return entry.kind === repeatedCell.kind && entry.original === repeatedCell.original;
      });

      expect(rowIndexes.length).toBeGreaterThan(1);
      if (!matchingEntry) {
        throw new Error(`Missing sanitization map entry for ${repeatedCell.kind}:${repeatedCell.original}`);
      }

      expect(rowIndexes.map((rowIndex) => output.rows[rowIndex]?.[columnIndex])).toEqual(
        rowIndexes.map(() => matchingEntry.token)
      );
    }

    const inputText = readFileSync(syntheticFixture, "utf8");
    for (const entry of result.mapEntries) {
      expect(result.outputText).not.toContain(entry.original);
      expect(inputText).toContain(entry.original);
    }

    const persistedMap = JSON.parse(readFileSync(mapPath, "utf8")) as SanitizationMapEntry[];
    expect(persistedMap).toEqual(result.mapEntries);
  });

  it("preserves header, semicolon delimiter, adjacent empty fields, UTF-8 encoding, and row count", () => {
    const tempDir = createTemporaryDirectory("budget-sanitize-");
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
    const tempDir = createTemporaryDirectory("budget-sanitize-");
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

  it("CLI dry-run reports counts without writing output or map files", () => {
    const tempDir = createTemporaryDirectory("budget-sanitize-cli-");
    const outputPath = join(tempDir, "sanitized.csv");
    const mapPath = join(tempDir, "map.json");
    const summary = JSON.parse(
      execFileSync(
        process.execPath,
        [
          tsxCliPath(),
          "scripts/sanitize-csv.ts",
          "--input",
          syntheticFixture,
          "--output",
          outputPath,
          "--map",
          mapPath,
          "--seed",
          "42",
          "--dry-run"
        ],
        { cwd: process.cwd(), encoding: "utf8" }
      )
    ) as { rowCount: number; mapEntryCount: number; outputPath: string | null; mapPath: string | null };

    expect(summary).toEqual({
      rowCount: 16,
      mapEntryCount: 38,
      outputPath: null,
      mapPath: null
    });
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(mapPath)).toBe(false);
  });

  it("CLI writes verified synthetic output and map using explicit paths and seed", () => {
    const directory = createTemporaryDirectory("budget-sanitize-cli-write-");
    const inputPath = join(directory, "input.csv");
    const outputPath = join(directory, "sanitized.csv");
    const mapPath = join(directory, "map.json");
    const source = readFileSync(syntheticFixture, "utf8");
    writeFileSync(inputPath, source);
    const summary = JSON.parse(execFileSync(process.execPath, [
      tsxCliPath(), "scripts/sanitize-csv.ts", "--input", inputPath,
      "--output", outputPath, "--map", mapPath, "--seed", "42",
    ], { encoding: "utf8" }));
    expect(summary).toEqual({ rowCount: 16, mapEntryCount: 38, outputPath, mapPath });
    expect(readFixtureCsv(outputPath).rows).toHaveLength(16);
    expect(JSON.parse(readFileSync(mapPath, "utf8"))).toHaveLength(38);
    expect(readFileSync(inputPath, "utf8")).toBe(source);
    expect(JSON.parse(execFileSync(process.execPath, [
      tsxCliPath(), "scripts/verify-fixture.ts", "--input", outputPath,
    ], { encoding: "utf8" }))).toMatchObject({ ok: true, errors: [], stats: { rowCount: 16, nonNokRowCount: 1 } });
  });

});