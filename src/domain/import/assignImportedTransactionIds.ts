import { createHash } from "node:crypto";
import type { Transaction } from "../types.js";
import { buildTransactionFingerprint } from "./buildTransactionFingerprint.js";

function buildImportedTransactionId(identity: string, occurrenceIndex: number): string {
  return createHash("sha256")
    .update(`${identity}|${occurrenceIndex}`, "utf8")
    .digest("hex");
}

export function assignImportedTransactionIds(
  transactions: readonly Transaction[],
  options: {
    sourceScope?: string;
    sourceScopes?: readonly (string | undefined)[];
    sourceReferences?: readonly (string | undefined)[];
  } = {}
): Transaction[] {
  const occurrenceByIdentity = new Map<string, number>();

  return transactions.map((transaction, index) => {
    const fingerprint = buildTransactionFingerprint({
      accountId: transaction.accountId,
      bookedAtIso: transaction.bookedAtIso,
      amountMinor: transaction.amountMinor,
      merchantRaw: transaction.merchantRaw,
    });
    const reference = (options.sourceReferences?.[index] ?? transaction.sourceReference)?.trim();
    const sourceScope = options.sourceScopes === undefined
      ? options.sourceScope
      : options.sourceScopes[index];
    const identity = [
      `fingerprint:${fingerprint}`,
      ...(reference ? [`reference:${reference}`] : []),
      ...(sourceScope ? [`source:${sourceScope}`] : []),
    ].join("|");
    const occurrenceIndex = occurrenceByIdentity.get(identity) ?? 0;
    occurrenceByIdentity.set(identity, occurrenceIndex + 1);

    return {
      ...transaction,
      id: buildImportedTransactionId(identity, occurrenceIndex),
    };
  });
}