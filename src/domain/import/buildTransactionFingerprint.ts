import { createHash } from "node:crypto";

export interface TransactionFingerprintInput {
  accountId: string;
  bookedAtIso: string;
  amountMinor: number;
  merchantRaw: string;
}

function canonicalizeBookedAtIso(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00Z`;
  }

  return trimmed;
}

export function buildTransactionFingerprint(input: TransactionFingerprintInput): string {
  const canonical = [
    input.accountId.trim(),
    canonicalizeBookedAtIso(input.bookedAtIso),
    input.amountMinor.toString(10),
    input.merchantRaw.trim().toUpperCase().replace(/\s+/g, " ")
  ].join("|");

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}