import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildTransactionsFromFixturePath, buildTransactionsFromFixtureRows, importFixtureCsv } from "../../src/tooling/fixtures/fixtureTransactions.js";

const booked = { "Utført dato": "28.05.2026", Beskrivelse: "SYNTHETIC SHOP", "Beløp ut": "-12.34", Valuta: "NOK", Status: "Bokført" };
const directories: string[] = [];
function fixture(rows: Record<string, string>[]): string {
  const directory = mkdtempSync(join(tmpdir(), "budget-fixture-rows-"));
  directories.push(directory);
  const path = join(directory, "input.csv");
  const header = Object.keys(booked);
  writeFileSync(path, [header.join(";"), ...rows.map((row) => header.map((key) => row[key] ?? "").join(";"))].join("\n"));
  return path;
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("strict fixture transactions", () => {
  it("maps valid booked rows with explicit identities and unchanged amounts", () => {
    expect(buildTransactionsFromFixtureRows([booked], { householdId: "hh-test", accountId: "acc-test", importJobId: "job-test" }))
      .toMatchObject([{ householdId: "hh-test", accountId: "acc-test", importJobId: "job-test", amountMinor: -1234, bookedAtIso: "2026-05-28T00:00:00Z", merchantRaw: "SYNTHETIC SHOP" }]);
  });
  it("maps valid file rows and propagates options through the strict path", () => {
    expect(buildTransactionsFromFixturePath(fixture([booked]), { householdId: "hh-file", accountId: "acc-file" }))
      .toMatchObject([{ householdId: "hh-file", accountId: "acc-file", amountMinor: -1234 }]);
  });
  it.each([
    { name: "mixed valid and invalid", rows: [booked, { ...booked, "Utført dato": "bad" }], index: 1, code: "INVALID_DATE_FORMAT", field: "Utført dato" },
    { name: "all invalid", rows: [{ ...booked, "Utført dato": "" }], index: 0, code: "MISSING_DATE", field: "Utført dato" },
    { name: "empty", rows: [], index: -1, code: "EMPTY_CSV", field: "file" },
  ])("rejects $name rows with mapper index and code/field diagnostics", ({ rows, index, code, field }) => {
    expect(() => buildTransactionsFromFixtureRows(rows)).toThrow(new RegExp(`mapper row ${index}.*${code}.*${field}`));
    expect(() => buildTransactionsFromFixturePath(fixture(rows))).toThrow(new RegExp(`mapper row ${index}.*${code}.*${field}`));
  });
  it("rejects invalid file rows while the full-result helper exposes skipped rows", () => {
    const path = fixture([booked, { ...booked, "Utført dato": "bad" }]);
    expect(() => buildTransactionsFromFixturePath(path)).toThrow(/mapper row 1.*INVALID_DATE_FORMAT/);
    expect(importFixtureCsv(path)).toMatchObject({ transactions: [], skipped: [{ rowIndex: 1, errors: [{ code: "INVALID_DATE_FORMAT" }] }] });
  });
  it.each(["Reservert", "Bekreftet"])("rejects pending-only and mixed %s rows instead of losing observations", (status) => {
    const pending = { ...booked, Status: status };
    for (const rows of [[pending], [booked, pending]]) {
      expect(() => buildTransactionsFromFixtureRows(rows)).toThrow(/pending.*importFixtureCsv/);
      expect(() => buildTransactionsFromFixturePath(fixture(rows))).toThrow(/pending.*importFixtureCsv/);
    }
    expect(importFixtureCsv(fixture([booked, pending]))).toMatchObject({ transactions: [{ amountMinor: -1234 }], pendingObservations: [{ amountMinor: -1234, sourceRowIndex: 1 }], skipped: [] });
  });
  it("bounds diagnostics and never echoes invalid financial content", () => {
    const rows = Array.from({ length: 100 }, () => ({ ...booked, "Utført dato": "PRIVATE-INVALID-VALUE" }));
    let message = "";
    try { buildTransactionsFromFixtureRows(rows); } catch (error) {
      if (!(error instanceof Error)) throw error;
      message = error.message;
    }
    expect(message).toContain("100");
    expect(message).toContain("INVALID_DATE_FORMAT");
    expect(message).not.toContain("PRIVATE-INVALID-VALUE");
    expect(message.length).toBeLessThan(1000);
  });
});
