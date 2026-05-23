import { describe, expect, it } from "vitest";
import { buildTransactionFingerprint } from "../../src/domain/import/buildTransactionFingerprint.js";

describe("buildTransactionFingerprint", () => {
  const baseInput = {
    accountId: "acc-1",
    bookedAtIso: "2026-05-23",
    amountMinor: -5590,
    merchantRaw: "Rema 1000"
  };

  it("is stable for equivalent input", () => {
    const fingerprintA = buildTransactionFingerprint(baseInput);
    const fingerprintB = buildTransactionFingerprint({
      ...baseInput,
      merchantRaw: "  rema   1000 "
    });

    expect(fingerprintA).toBe(fingerprintB);
  });

  it("changes when amount changes", () => {
    const fingerprintA = buildTransactionFingerprint(baseInput);
    const fingerprintB = buildTransactionFingerprint({
      ...baseInput,
      amountMinor: -5591
    });

    expect(fingerprintA).not.toBe(fingerprintB);
  });
});