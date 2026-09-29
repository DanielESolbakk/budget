import { describe, expect, it } from "vitest";
import { normalizeMerchantName } from "../../src/domain/merchant/normalizeMerchantName.js";
import type { Transaction } from "../../src/domain/types.js";
import { importFixtureCsv } from "../../src/tooling/fixtures/fixtureTransactions.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";

describe("merchant normalization across the CSV import boundary", () => {
  it("AC-1: trims, uppercases, collapses whitespace, and removes each legal suffix", () => {
    const result = importFixtureCsv(FIXTURE_PATH);
    expect(result.skipped).toEqual([]);
    expect(result.transactions.map((transaction) => transaction.merchantRaw)).toEqual(
      expect.arrayContaining(["MERCHANT-005", "MERCHANT_005"])
    );

    for (const [merchantRaw, expectedAlias] of [
      ["Rema   1000  AS", "REMA 1000"],
      ["NorgesGruppen asa", "NORGESGRUPPEN"],
      ["Coop  SA", "COOP"],
      ["Stavanger   Taxi ANS", "STAVANGER TAXI"],
    ]) {
      const transaction = result.transactions.find((item) => item.merchantRaw === merchantRaw);
      expect(transaction, `Missing imported merchant: ${merchantRaw}`).toBeDefined();
      expect(normalizeMerchantName(transaction!.merchantRaw)).toBe(expectedAlias);
    }
  });

  it("AC-2: retains meaningful text and returns an empty string for suffix-only input", () => {
    const result = importFixtureCsv(FIXTURE_PATH);
    expect(result.skipped).toEqual([]);

    const meaningful = result.transactions.find((item) => item.merchantRaw === "Vy Gruppen");
    const suffixOnly = result.transactions.find((item) => item.merchantRaw === "ASA");
    expect(meaningful).toBeDefined();
    expect(suffixOnly).toBeDefined();
    expect(normalizeMerchantName(meaningful!.merchantRaw)).toBe("VY GRUPPEN");
    expect(normalizeMerchantName(suffixOnly!.merchantRaw)).toBe("");
  });

  it("AC-3: normalized imported merchants fit the optional Transaction.merchantAlias contract", () => {
    const result = importFixtureCsv(FIXTURE_PATH);
    expect(result.skipped).toEqual([]);

    for (const [merchantRaw, expectedAlias] of [
      ["Rema   1000  AS", "REMA 1000"],
      ["ASA", ""],
    ]) {
      const imported = result.transactions.find((item) => item.merchantRaw === merchantRaw);
      expect(imported).toBeDefined();
      expect(imported).not.toHaveProperty("merchantAlias");
      const transactionWithAlias: Transaction = {
        ...imported!,
        merchantAlias: normalizeMerchantName(imported!.merchantRaw),
      };
      expect(transactionWithAlias.merchantAlias).toBe(expectedAlias);
      expect(typeof transactionWithAlias.merchantAlias).toBe("string");
    }
  });
});
