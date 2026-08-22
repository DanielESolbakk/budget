import { describe, expect, it } from "vitest";
import { detectDuplicate } from "../../../src/domain/import/detectDuplicate.js";
import type { Transaction } from "../../../src/domain/types.js";

const baseTx: Transaction = {
  id: "tx-1",
  householdId: "hh-1",
  accountId: "acc-1",
  bookedAtIso: "2026-05-23T00:00:00Z",
  amountMinor: -1250,
  merchantRaw: "Kiwi Stavanger",
};

const candidate = {
  accountId: "acc-1",
  bookedAtIso: "2026-05-23T00:00:00Z",
  amountMinor: -1250,
  merchantRaw: "Kiwi Stavanger",
};

describe("detectDuplicate", () => {
  it("returns isDuplicate false when the ledger is empty", () => {
    const result = detectDuplicate(candidate, []);
    expect(result.isDuplicate).toBe(false);
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns isDuplicate false when no fingerprint matches", () => {
    const result = detectDuplicate(candidate, [
      { ...baseTx, id: "tx-other", merchantRaw: "Rema 1000" },
    ]);
    expect(result.isDuplicate).toBe(false);
  });

  it("returns isDuplicate true with matchingTransactionId for an exact match", () => {
    const result = detectDuplicate(candidate, [baseTx]);
    expect(result.isDuplicate).toBe(true);
    if (!result.isDuplicate) return;
    expect(result.matchingTransactionId).toBe("tx-1");
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("detects duplicate when merchant casing differs", () => {
    const result = detectDuplicate(
      { ...candidate, merchantRaw: "kiwi stavanger" },
      [baseTx]
    );
    expect(result.isDuplicate).toBe(true);
  });

  it("detects duplicate when merchant has extra whitespace", () => {
    const result = detectDuplicate(
      { ...candidate, merchantRaw: "  Kiwi   Stavanger  " },
      [baseTx]
    );
    expect(result.isDuplicate).toBe(true);
  });

  it("detects duplicate when date-only and midnight UTC representations are equivalent", () => {
    const result = detectDuplicate(
      { ...candidate, bookedAtIso: "2026-05-23" },
      [baseTx]
    );
    expect(result.isDuplicate).toBe(true);
  });

  it("does not detect duplicate when amount sign differs (AC-3 explainability)", () => {
    const result = detectDuplicate(
      { ...candidate, amountMinor: 1250 },
      [baseTx]
    );
    expect(result.isDuplicate).toBe(false);
  });

  it("result fingerprint is deterministic for the same candidate", () => {
    const a = detectDuplicate(candidate, []);
    const b = detectDuplicate(candidate, []);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("returns explainable comparison data even on duplicate (AC-3)", () => {
    const result = detectDuplicate(candidate, [baseTx]);
    expect(result.isDuplicate).toBe(true);
    if (!result.isDuplicate) return;
    // fingerprint and matchingTransactionId allow audit of why the entry was rejected
    expect(result.fingerprint).toBeTruthy();
    expect(result.matchingTransactionId).toBeTruthy();
  });
});