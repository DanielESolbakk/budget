import { describe, expect, it } from "vitest";
import {
  validateManualEntry,
  type ManualEntryPayload,
} from "../../../src/domain/import/validateManualEntry.js";

// AC-1: A valid manual transaction is accepted and preserves entered fields.

describe("validateManualEntry", () => {
  const validPayload: ManualEntryPayload = {
    accountId: "acc-1",
    bookedAtIso: "2026-05-23T00:00:00Z",
    amountMinor: -5590,
    merchantRaw: "Rema 1000",
  };

  it("AC-1: accepts a valid manual transaction payload and preserves all fields", () => {
    const result = validateManualEntry(validPayload);

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.payload.accountId).toBe("acc-1");
    expect(result.payload.bookedAtIso).toBe("2026-05-23T00:00:00Z");
    expect(result.payload.amountMinor).toBe(-5590);
    expect(result.payload.merchantRaw).toBe("Rema 1000");
  });

  it("AC-1: accepts a date-only bookedAtIso (YYYY-MM-DD)", () => {
    const result = validateManualEntry({ ...validPayload, bookedAtIso: "2026-05-23" });
    expect(result.valid).toBe(true);
  });

  it("AC-1: trims whitespace from accountId and bookedAtIso in output payload", () => {
    const result = validateManualEntry({
      ...validPayload,
      accountId: "  acc-1 ",
      bookedAtIso: " 2026-05-23T00:00:00Z ",
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.payload.accountId).toBe("acc-1");
    expect(result.payload.bookedAtIso).toBe("2026-05-23T00:00:00Z");
  });

  it("AC-1: rejects null input", () => {
    const result = validateManualEntry(null);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors).toHaveLength(1);
  });

  it("AC-1: rejects missing accountId", () => {
    const { accountId: _omit, ...rest } = validPayload;
    const result = validateManualEntry(rest);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.includes("accountId"))).toBe(true);
  });

  it("AC-1: rejects empty accountId", () => {
    const result = validateManualEntry({ ...validPayload, accountId: "   " });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.includes("accountId"))).toBe(true);
  });

  it("AC-1: rejects invalid bookedAtIso", () => {
    const result = validateManualEntry({ ...validPayload, bookedAtIso: "not-a-date" });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.includes("bookedAtIso"))).toBe(true);
  });

  it("AC-1: rejects non-integer amountMinor", () => {
    const result = validateManualEntry({ ...validPayload, amountMinor: 12.5 });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.includes("amountMinor"))).toBe(true);
  });

  it("AC-1: rejects empty merchantRaw", () => {
    const result = validateManualEntry({ ...validPayload, merchantRaw: "  " });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.includes("merchantRaw"))).toBe(true);
  });

  it("AC-1: rejects structurally valid but impossible date (2026-99-99)", () => {
    const result = validateManualEntry({ ...validPayload, bookedAtIso: "2026-99-99" });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.includes("bookedAtIso"))).toBe(true);
  });

  it("AC-1: trims whitespace from merchantRaw in output payload", () => {
    const result = validateManualEntry({ ...validPayload, merchantRaw: "  Rema 1000  " });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.payload.merchantRaw).toBe("Rema 1000");
  });

  it("AC-1: collects all errors when multiple fields are invalid", () => {
    const result = validateManualEntry({
      accountId: "",
      bookedAtIso: "bad",
      amountMinor: "not a number",
      merchantRaw: "",
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});
