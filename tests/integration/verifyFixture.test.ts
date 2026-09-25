import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { verifyFixture } from "../../src/tooling/fixtures/verifyFixture.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const expectedFixtureReportPath =
  "tests/fixtures/verification-reports/rogaland-2026-05-synthetic.verification-report.json";
const expectedHeaders = [
  "Utført dato",
  "Bokført dato",
  "Rentedato",
  "Beskrivelse",
  "Type",
  "Undertype",
  "Fra konto",
  "Avsender",
  "Til konto",
  "Mottakernavn",
  "Beløp inn",
  "Beløp ut",
  "Valuta",
  "Status",
  "Melding/KID/Fakt.nr"
];
const temporaryDirectories = new Set<string>();

function readRepositoryFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, `file://${repositoryRoot}/`), "utf8");
}

function writeTemporaryFixtureFile(fileName: string, content: string): string {
  const directory = mkdtempSync(join(tmpdir(), "budget-verify-fixture-"));
  temporaryDirectories.add(directory);
  const filePath = join(directory, fileName);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

function readMarkdownSection(markdown: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(`^${escapedHeading}\\r?\\n([\\s\\S]*?)(?=^#{1,2}\\s|(?![\\s\\S]))`, "im"),
  );
  return match?.[1] ?? "";
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe("verifyFixture", () => {
  it("emits the documented machine-readable report for the committed synthetic fixture", () => {
    const reportPath = writeTemporaryFixtureFile("verification-report.json", "");
    const report = verifyFixture({
      inputPath: "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv",
      reportPath
    });
    const expectedReport = JSON.parse(readRepositoryFile(expectedFixtureReportPath));
    const writtenReport = JSON.parse(readFileSync(reportPath, "utf8"));

    expect(report).toEqual(expectedReport);
    expect(writtenReport).toEqual(expectedReport);
  });

  it("returns deterministic structural errors for comma-delimited fixture input", () => {
    const invalidFixturePath = writeTemporaryFixtureFile(
      "invalid-delimiter.csv",
      [
        expectedHeaders.join(","),
        [
          "29.05.2026",
          "",
          "29.05.2026",
          "MERCHANT_001",
          "Varekjøp",
          "Debetkort",
          "ACCT-001",
          "",
          "",
          "USER_1",
          "",
          "-45.00",
          "NOK",
          "Reservert",
          "TXN-001"
        ].join(",")
      ].join("\n")
    );

    const report = verifyFixture({
      inputPath: invalidFixturePath
    });

    expect(report).toEqual({
      ok: false,
      errors: [
        "CSV must use semicolon delimiters.",
        "CSV header does not match the expected import fixture schema."
      ],
      warnings: [],
      stats: {
        rowCount: 1,
        nonNokRowCount: 0,
        reservedRowCount: 0,
        holdRowCount: 0,
        transferRowCount: 0,
        fxRowCount: 0,
        kidReferenceCount: 0,
        uniqueMerchantCount: 0,
        merchantTokenDistribution: {}
      }
    });
  });

  it("returns deterministic data errors for mojibake, invalid dates, and non-numeric amounts", () => {
    const invalidFixturePath = writeTemporaryFixtureFile(
      "invalid-data.csv",
      [
        expectedHeaders.join(";"),
        [
          "32.05.2026",
          "",
          "29.05.2026",
          "KJÃP UTLAND",
          "Varekjøp",
          "Debetkort",
          "ACCT-001",
          "",
          "",
          "USER_1",
          "",
          "-45,00",
          "NOK",
          "Bokført",
          "TXN-001"
        ].join(";")
      ].join("\n")
    );

    const report = verifyFixture({
      inputPath: invalidFixturePath
    });

    expect(report).toEqual({
      ok: false,
      errors: [
        "Fixture text is not valid UTF-8 or contains replacement characters.",
        "Fixture text contains mojibake sequences that should be re-sanitized.",
        "Row 2: Utført dato is not a valid dd.MM.yyyy date.",
        "Row 2: Beløp ut is not numeric.",
        "Fixture must contain at least one non-NOK row for FX coverage."
      ],
      warnings: [],
      stats: {
        rowCount: 1,
        nonNokRowCount: 0,
        reservedRowCount: 0,
        holdRowCount: 0,
        transferRowCount: 0,
        fxRowCount: 0,
        kidReferenceCount: 0,
        uniqueMerchantCount: 1,
        merchantTokenDistribution: {
          KJØP: 1,
          UTLAND: 1
        }
      }
    });
  });

  it("returns a non-successful report instead of throwing when a row has the wrong cell count", () => {
    const malformedFixturePath = writeTemporaryFixtureFile(
      "wrong-cell-count.csv",
      [
        expectedHeaders.join(";"),
        "29.05.2026;;29.05.2026;MERCHANT_001;Varekjøp"
      ].join("\n")
    );

    expect(() =>
      verifyFixture({
        inputPath: malformedFixturePath
      })
    ).not.toThrow();

    expect(
      verifyFixture({
        inputPath: malformedFixturePath
      })
    ).toEqual({
      ok: false,
      errors: ["Row 2 has 5 cells, expected 15."],
      warnings: [],
      stats: {
        rowCount: 0,
        nonNokRowCount: 0,
        reservedRowCount: 0,
        holdRowCount: 0,
        transferRowCount: 0,
        fxRowCount: 0,
        kidReferenceCount: 0,
        uniqueMerchantCount: 0,
        merchantTokenDistribution: {}
      }
    });
  });

  it("tracks reserved and hold coverage separately", () => {
    const fixturePath = writeTemporaryFixtureFile(
      "reserved-and-hold.csv",
      [
        expectedHeaders.join(";"),
        [
          "29.05.2026",
          "29.05.2026",
          "29.05.2026",
          "MERCHANT_001",
          "Varekjøp",
          "Debetkort",
          "ACCT-001",
          "",
          "",
          "USER_1",
          "",
          "-45.00",
          "NOK",
          "Reservert",
          "TXN-001"
        ].join(";"),
        [
          "28.05.2026",
          "28.05.2026",
          "28.05.2026",
          "MERCHANT_002",
          "Varekjøp",
          "Holdt kortkjøp",
          "ACCT-001",
          "",
          "",
          "USER_1",
          "",
          "-15.00",
          "GBP",
          "Bokført",
          "FX-001"
        ].join(";")
      ].join("\n")
    );

    const report = verifyFixture({
      inputPath: fixturePath
    });

    expect(report.stats.reservedRowCount).toBe(1);
    expect(report.stats.holdRowCount).toBe(1);
  });

  it("verifies ADR and glossary artifacts are present and linked from plan.md", () => {
    const adr = readRepositoryFile(
      "docs/ways-of-work/plan/budget-planner/adr-001-stack-and-runtime-boundaries.md",
    );
    const glossary = readRepositoryFile(
      "docs/ways-of-work/plan/budget-planner/domain-glossary.md",
    );
    const planMd = readRepositoryFile("plan.md");

    expect(adr).toMatch(/^## Status\s+Accepted$/m);
    const parserSection = readMarkdownSection(adr, "### Import and Parser Layer");
    expect(parserSection).toContain("source-aware parser adapters");
    expect(parserSection).toContain("parser-specific logic isolated");

    const privacySection = readMarkdownSection(adr, "## Privacy and Data Handling Constraints");
    expect(privacySection).toContain("Transaction content remains local by default");
    expect(privacySection).toContain("No background network calls for transaction workflows");
    expect(planMd).toContain(
      "[ADR-001: Stack and Runtime Boundaries](docs/ways-of-work/plan/budget-planner/adr-001-stack-and-runtime-boundaries.md)",
    );
    expect(planMd).toContain(
      "[Budget Planner Domain Glossary](docs/ways-of-work/plan/budget-planner/domain-glossary.md)",
    );

    const definitionFragments: Record<string, string> = {
      household: "The local budgeting context managed by one user",
      account: "A source or destination ledger account",
      transaction: "A dated financial record with amount",
      category: "A user-visible spending or income classification",
      "merchant alias": "A normalized merchant representation",
      "categorization rule": "A deterministic rule that maps transaction signals",
      "import job": "A tracked import execution",
      "budget target": "A planned amount for a category",
      "forecast assumption": "An explicit input used by forecasting logic",
      "backup snapshot": "A user-initiated exportable backup",
    };
    const glossaryRows = glossary.split(/\r?\n/);
    for (const [term, fragment] of Object.entries(definitionFragments)) {
      const row = glossaryRows.find((line) => line.startsWith(`| ${term} |`)) ?? "";
      expect(row, `Glossary must define "${term}"`).not.toBe("");
      expect(row).toContain(`| ${term} | ${fragment}`);
    }
  });
});
