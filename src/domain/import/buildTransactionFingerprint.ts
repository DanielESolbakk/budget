import { createHash } from "node:crypto";

export interface TransactionFingerprintInput {
  accountId: string;
  bookedAtIso: string;
  amountMinor: number;
  merchantRaw: string;
}

export function buildTransactionFingerprint(input: TransactionFingerprintInput): string {
  const canonical = [
    input.accountId.trim(),
    input.bookedAtIso.trim(),
    input.amountMinor.toString(10),
    input.merchantRaw.trim().toUpperCase().replace(/\s+/g, " ")
  ].join("|");

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}