import { describe, expect, it } from "vitest";
import { CSV_COLUMN_NAMES, mapCsvRows } from "../../src/domain/import/csvRowMapper.js";
import { normalizeMerchantName } from "../../src/domain/merchant/normalizeMerchantName.js";
import type { Transaction } from "../../src/domain/types.js";
import { readFixtureCsv, rowsToObjects } from "../../src/tooling/fixtures/fixtureCsv.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";
const MERCHANT_VARIANT_EXPECTATIONS = [
  { raw: "  Rema   1000  AS ", alias: "REMA 1000" },
  { raw: "NorgesGruppen asa", alias: "NORGESGRUPPEN" },
  { raw: "Coop  SA", alias: "COOP" },
  { raw: "Stavanger   Taxi ANS", alias: "STAVANGER TAXI" },
  { raw: "Vy Gruppen", alias: "VY GRUPPEN" },
  { raw: " ASA ", alias: "" },
] as const;

function importFixtureRows() {
  const rows = rowsToObjects(readFixtureCsv(FIXTURE_PATH));
  const result = mapCsvRows(rows, {
    householdId: "hh-fixture",
    accountId: "acc-fixture",
  });

  return { rows, result };
}

describe("merchant normalization across the CSV import boundary", () => {
  it("AC-1: imports fixture variants and normalizes whitespace and supported legal suffixes", () => {
    const { rows, result } = importFixtureRows();
    expect(result.skipped).toEqual([]);
    expect(result.transactions.map((transaction) => transaction.merchantRaw)).toEqual(
      expect.arrayContaining(["MERCHANT-005", "MERCHANT_005"])
    );

    for (const { raw, alias } of MERCHANT_VARIANT_EXPECTATIONS.slice(0, 4)) {
      const fixtureRow = rows.find((row) => row[CSV_COLUMN_NAMES.description] === raw);
      expect(fixtureRow, `Missing fixture merchant: ${raw}`).toBeDefined();
      expect(normalizeMerchantName(fixtureRow![CSV_COLUMN_NAMES.description] ?? "")).toBe(alias);

      const imported = result.transactions.find((item) => item.merchantRaw === raw.trim());
      expect(imported, `Missing imported merchant: ${raw}`).toBeDefined();
      expect(normalizeMerchantName(imported!.merchantRaw)).toBe(alias);
    }
  });

  it("AC-2: retains meaningful fixture text and removes suffix-only input", () => {
    const { rows, result } = importFixtureRows();
    expect(result.skipped).toEqual([]);

    for (const { raw, alias } of MERCHANT_VARIANT_EXPECTATIONS.slice(4)) {
      const fixtureRow = rows.find((row) => row[CSV_COLUMN_NAMES.description] === raw);
      expect(fixtureRow, `Missing fixture merchant: ${raw}`).toBeDefined();
      expect(normalizeMerchantName(fixtureRow![CSV_COLUMN_NAMES.description] ?? "")).toBe(alias);

      const imported = result.transactions.find((item) => item.merchantRaw === raw.trim());
      expect(imported, `Missing imported merchant: ${raw}`).toBeDefined();
      expect(normalizeMerchantName(imported!.merchantRaw)).toBe(alias);
    }
  });

  it("AC-3: normalized fixture merchants fit the optional Transaction.merchantAlias contract", () => {
    const { rows, result } = importFixtureRows();
    expect(result.skipped).toEqual([]);

    for (const { raw, alias } of [MERCHANT_VARIANT_EXPECTATIONS[0], MERCHANT_VARIANT_EXPECTATIONS[5]]) {
      const fixtureRow = rows.find((row) => row[CSV_COLUMN_NAMES.description] === raw);
      expect(fixtureRow, `Missing fixture merchant: ${raw}`).toBeDefined();
      const imported = result.transactions.find((item) => item.merchantRaw === raw.trim());
      expect(imported).toBeDefined();
      expect(imported).not.toHaveProperty("merchantAlias");

      const transactionWithAlias: Transaction = {
        ...imported!,
        merchantAlias: normalizeMerchantName(fixtureRow![CSV_COLUMN_NAMES.description] ?? ""),
      };
      expect(transactionWithAlias.merchantAlias).toBe(alias);
      expect(typeof transactionWithAlias.merchantAlias).toBe("string");
    }
  });
<<<<<<< Updated upstream
});
=======
});
>>>>>>> Stashed changes
