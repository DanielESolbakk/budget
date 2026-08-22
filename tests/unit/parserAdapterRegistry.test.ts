import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getPdfParserAdapters,
  parsePdfStatementWithRegisteredAdapter,
} from "../../src/domain/import/parserAdapterRegistry.js";
import {
  ROGALAND_ADAPTER_ID,
  ROGALAND_SOURCE_ID,
} from "../../src/domain/import/pdfTextParser.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-statement.txt";

const OPTIONS = {
  householdId: "hh-registry",
  accountId: "acc-registry",
};

describe("parser adapter registry", () => {
  it("registers the Rogaland parser adapter with stable identities", () => {
    const adapters = getPdfParserAdapters();

    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.adapterId).toBe(ROGALAND_ADAPTER_ID);
    expect(adapters[0]?.sourceIdentity).toBe(ROGALAND_SOURCE_ID);
  });

  it("selects the registered source-aware adapter for supported statement text", () => {
    const text = readFileSync(FIXTURE_PATH, "utf8");
    const result = parsePdfStatementWithRegisteredAdapter(text, OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.adapterId).toBe(ROGALAND_ADAPTER_ID);
    expect(result.sourceIdentity).toBe(ROGALAND_SOURCE_ID);
    expect(result.transactions.length).toBeGreaterThan(0);
  });

  it("returns explicit UNSUPPORTED_LAYOUT when no adapter supports the statement", () => {
    const result = parsePdfStatementWithRegisteredAdapter("UNKNOWN BANK", OPTIONS);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors[0]?.code).toBe("UNSUPPORTED_LAYOUT");
  });

  it("rejects date-like rows with an unsupported date format instead of silently skipping them", () => {
    const text = [
      "ROGALAND SPAREBANK",
      "Dato         Beskrivelse                              Beløp          Saldo",
      "27.05.2026   VALID                                  +1,00       1,00",
      "2026-05-27   MALFORMED DATE                         +2,00       3,00",
    ].join("\n");
    const result = parsePdfStatementWithRegisteredAdapter(text, OPTIONS);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors[0]?.code).toBe("INVALID_DATE_FORMAT");
  });
});
