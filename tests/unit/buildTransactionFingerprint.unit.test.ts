import { describe, expect, it } from "vitest";
import { buildTransactionFingerprint } from "../../src/domain/import/buildTransactionFingerprint.js";

describe("buildTransactionFingerprint unit coverage", () => {
  const baseInput = {
    accountId: "acc-1",
    bookedAtIso: "2026-05-23T00:00:00Z",
    amountMinor: -5590,
    merchantRaw: "Rema 1000",
  };

  it("returns a deterministic sha256 hash with expected shape", () => {
    const fingerprint = buildTransactionFingerprint(baseInput);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(buildTransactionFingerprint(baseInput)).toBe(fingerprint);
  });

  it("normalizes merchant spacing and casing before hashing", () => {
    const normalizedA = buildTransactionFingerprint(baseInput);
    const normalizedB = buildTransactionFingerprint({
      ...baseInput,
      merchantRaw: "  rema   1000  ",
    });

    expect(normalizedB).toBe(normalizedA);
  });

  it("normalizes tabs and newlines in merchant names as whitespace", () => {
    const normalizedA = buildTransactionFingerprint(baseInput);
    const normalizedB = buildTransactionFingerprint({
      ...baseInput,
      merchantRaw: "\tRema\n1000\t",
    });

    expect(normalizedB).toBe(normalizedA);
  });

  it("normalizes legal suffixes before hashing", () => {
    expect(buildTransactionFingerprint({
      ...baseInput,
      merchantRaw: "Rema 1000 AS",
    })).toBe(buildTransactionFingerprint(baseInput));
  });

  it("trims account and bookedAtIso inputs before hashing", () => {
    const clean = buildTransactionFingerprint(baseInput);
    const padded = buildTransactionFingerprint({
      ...baseInput,
      accountId: "  acc-1 ",
      bookedAtIso: " 2026-05-23T00:00:00Z ",
    });

    expect(padded).toBe(clean);
  });

  it("changes fingerprint when any canonical field changes", () => {
    const original = buildTransactionFingerprint(baseInput);

    expect(buildTransactionFingerprint({ ...baseInput, amountMinor: -5591 })).not.toBe(original);
    expect(buildTransactionFingerprint({ ...baseInput, accountId: "acc-2" })).not.toBe(original);
    expect(buildTransactionFingerprint({ ...baseInput, bookedAtIso: "2026-05-24T00:00:00Z" })).not.toBe(original);
    expect(buildTransactionFingerprint({ ...baseInput, merchantRaw: "Kiwi" })).not.toBe(original);
  });

  it("keeps same fingerprint when only extra outer whitespace changes canonical fields", () => {
    const original = buildTransactionFingerprint(baseInput);
    const padded = buildTransactionFingerprint({
      ...baseInput,
      accountId: "  acc-1  ",
      bookedAtIso: " 2026-05-23T00:00:00Z ",
      merchantRaw: "  REMA 1000  ",
    });

    expect(padded).toBe(original);
  });
});
