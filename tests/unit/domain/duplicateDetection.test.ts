import { describe, expect, it } from "vitest";
import {
  buildTransactionFingerprint,
  type TransactionFingerprintInput,
} from "../../../src/domain/import/buildTransactionFingerprint.js";

// AC-2 & AC-3: Duplicate fingerprint contract, signed amount handling, and merchant canonicalization.

describe("duplicate detection via buildTransactionFingerprint", () => {
  const base: TransactionFingerprintInput = {
    accountId: "acc-1",
    bookedAtIso: "2026-05-23T00:00:00Z",
    amountMinor: -5590,
    merchantRaw: "Rema 1000",
  };

  // AC-2: Equivalent inputs produce one stable SHA-256 fingerprint.

  it("AC-2: identical inputs produce the same fingerprint (stability)", () => {
    expect(buildTransactionFingerprint(base)).toBe(
      buildTransactionFingerprint({ ...base })
    );
  });

  it("AC-2: produces a 64-character hex SHA-256 fingerprint", () => {
    expect(buildTransactionFingerprint(base)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("AC-2: same canonical fields from different object instances produce the same fingerprint", () => {
    const a: TransactionFingerprintInput = {
      accountId: "acc-1",
      bookedAtIso: "2026-05-23T00:00:00Z",
      amountMinor: -5590,
      merchantRaw: "Rema 1000",
    };
    const b: TransactionFingerprintInput = {
      accountId: "acc-1",
      bookedAtIso: "2026-05-23T00:00:00Z",
      amountMinor: -5590,
      merchantRaw: "Rema 1000",
    };
    expect(buildTransactionFingerprint(a)).toBe(buildTransactionFingerprint(b));
  });

  // AC-3: Signed amount handling.

  it("AC-3: negating amountMinor produces a different fingerprint", () => {
    const debit = buildTransactionFingerprint({ ...base, amountMinor: -5590 });
    const credit = buildTransactionFingerprint({ ...base, amountMinor: 5590 });
    expect(debit).not.toBe(credit);
  });

  it("AC-3: zero amount is distinct from any non-zero amount", () => {
    const zero = buildTransactionFingerprint({ ...base, amountMinor: 0 });
    const nonZero = buildTransactionFingerprint({ ...base, amountMinor: -1 });
    expect(zero).not.toBe(nonZero);
  });

  // AC-3: Merchant canonicalization — surrounding whitespace, repeated internal whitespace, case differences.

  it("AC-3: surrounding whitespace on merchantRaw produces the same fingerprint", () => {
    const clean = buildTransactionFingerprint(base);
    const padded = buildTransactionFingerprint({ ...base, merchantRaw: "  Rema 1000  " });
    expect(padded).toBe(clean);
  });

  it("AC-3: repeated internal whitespace in merchantRaw produces the same fingerprint", () => {
    const clean = buildTransactionFingerprint(base);
    const multiSpace = buildTransactionFingerprint({ ...base, merchantRaw: "Rema   1000" });
    expect(multiSpace).toBe(clean);
  });

  it("AC-3: case differences in merchantRaw produce the same fingerprint", () => {
    const clean = buildTransactionFingerprint(base);
    const lower = buildTransactionFingerprint({ ...base, merchantRaw: "rema 1000" });
    const upper = buildTransactionFingerprint({ ...base, merchantRaw: "REMA 1000" });
    const mixed = buildTransactionFingerprint({ ...base, merchantRaw: "rEmA 1000" });
    expect(lower).toBe(clean);
    expect(upper).toBe(clean);
    expect(mixed).toBe(clean);
  });

  it("AC-3: tabs and newlines in merchantRaw are treated as whitespace", () => {
    const clean = buildTransactionFingerprint(base);
    const tabbed = buildTransactionFingerprint({ ...base, merchantRaw: "Rema\t1000" });
    const newlined = buildTransactionFingerprint({ ...base, merchantRaw: "Rema\n1000" });
    expect(tabbed).toBe(clean);
    expect(newlined).toBe(clean);
  });

  it("AC-3: combined whitespace and case variant produces the same fingerprint", () => {
    const clean = buildTransactionFingerprint(base);
    const combined = buildTransactionFingerprint({
      ...base,
      merchantRaw: "  rema   1000  ",
    });
    expect(combined).toBe(clean);
  });

  it("AC-3: different merchants after canonicalization produce different fingerprints", () => {
    const rema = buildTransactionFingerprint(base);
    const kiwi = buildTransactionFingerprint({ ...base, merchantRaw: "Kiwi" });
    expect(rema).not.toBe(kiwi);
  });
});
