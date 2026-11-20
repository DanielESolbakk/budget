import type { LedgerRecoveryHistory } from "../../domain/backup/snapshotContract.js";
import type {
  CategorizationDecision,
  CategorizationRuleProvenance,
  MerchantCorrectionProvenance,
  TransactionCategoryEditProvenance,
  TransactionCategoryAllocation,
} from "../../domain/types.js";
import { isRecord, validateTransactions } from "./snapshotRecordValidation.js";

export function validateRecoveryHistory(
  value: unknown,
  householdId: string,
  accountIds: Set<string>,
  importJobIds: Set<string>,
  categoryIds: readonly string[],
  snapshotPath: string,
  transactionIds?: Set<string>,
): LedgerRecoveryHistory {
  function invalid(detail: string): never {
    throw new Error(`Invalid snapshot recovery history: ${detail}: ${snapshotPath}`);
  }
  function text(input: unknown): string {
    if (typeof input !== "string" || input.trim() === "") invalid("expected non-empty text");
    return input;
  }
  function count(input: unknown): number {
    if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0) invalid("invalid operation count");
    return input;
  }
  function timestamp(input: unknown): string {
    const date = text(input);
    if (!date.includes("T") || Number.isNaN(Date.parse(date))) invalid("invalid timestamp");
    return date;
  }
  function records(input: unknown): Record<string, unknown>[] {
    if (!Array.isArray(input)) invalid("expected a collection");
    return input.map((entry) => {
      if (!isRecord(entry)) invalid("expected a record");
      return entry;
    });
  }
  function category(input: unknown): string {
    const id = text(input);
    if (!categoryIds.includes(id)) invalid("unknown category reference");
    return id;
  }
  function allocation(input: unknown): TransactionCategoryAllocation {
    if (!isRecord(input) || typeof input.amountMinor !== "number" ||
      !Number.isSafeInteger(input.amountMinor) || input.amountMinor === 0) {
      invalid("invalid category edit allocation");
    }
    return { categoryId: category(input.categoryId), amountMinor: input.amountMinor };
  }
  // Propagation undo compares stored categorization JSON, including nested rule key order.
  function rule(input: unknown): CategorizationRuleProvenance {
    if (!isRecord(input) || typeof input.priority !== "number" || !Number.isSafeInteger(input.priority)) {
      invalid("invalid historical rule");
    }
    return {
      ...input,
      ruleId: text(input.ruleId), merchantAlias: text(input.merchantAlias),
      categoryId: category(input.categoryId), priority: input.priority,
    };
  }
  function decision(input: unknown): CategorizationDecision {
    if (!isRecord(input) ||
      (input.status !== "categorized" && input.status !== "unmatched" && input.status !== "ambiguous") ||
      typeof input.confidence !== "number" || !Number.isFinite(input.confidence) ||
      input.confidence < 0 || input.confidence > 1 ||
      (input.confidenceLevel !== "high" && input.confidenceLevel !== "low") ||
      typeof input.requiresReview !== "boolean" || !Array.isArray(input.matchingRules)) {
      invalid("invalid historical categorization");
    }
    return {
      ...input,
      status: input.status, confidence: input.confidence, confidenceLevel: input.confidenceLevel,
      requiresReview: input.requiresReview, matchingRules: input.matchingRules.map(rule),
      ...(input.categoryId === undefined ? {} : { categoryId: category(input.categoryId) }),
      ...(input.selectedRule === undefined ? {} : { selectedRule: rule(input.selectedRule) }),
    };
  }
  function unique(ids: string[]): void {
    if (new Set(ids).size !== ids.length) invalid("duplicate history identity");
  }
  if (!isRecord(value)) invalid("missing history");
  const merchantCorrections = records(value.merchantCorrections).map((entry): MerchantCorrectionProvenance => {
    if (entry.actor !== "local-user") invalid("invalid correction actor");
    return {
      id: text(entry.id), sourceTransactionId: text(entry.sourceTransactionId),
      merchantAlias: text(entry.merchantAlias), categoryId: category(entry.categoryId),
      actor: entry.actor, correctedAtIso: timestamp(entry.correctedAtIso),
      ...(entry.originalCategorization === undefined ? {} : {
        originalCategorization: decision(entry.originalCategorization),
      }),
    };
  });
  const transactionCategoryEdits = records(value.transactionCategoryEdits ?? [])
    .map((entry): TransactionCategoryEditProvenance => {
      if (entry.actor !== "local-user" ||
        (entry.mode !== "single" && entry.mode !== "split") ||
        typeof entry.rememberForMerchant !== "boolean" ||
        (entry.merchantRuleEffect !== "updated" &&
          entry.merchantRuleEffect !== "already-matching" &&
          entry.merchantRuleEffect !== "not-requested" &&
          entry.merchantRuleEffect !== "unavailable")) {
        invalid("invalid transaction category edit outcome");
      }
      const sourceTransactionId = text(entry.sourceTransactionId);
      if (transactionIds !== undefined && !transactionIds.has(sourceTransactionId)) {
        invalid("unknown category edit transaction");
      }
      const merchantAlias = entry.merchantAlias;
      if (typeof merchantAlias !== "string" || merchantAlias.trim() !== merchantAlias) {
        invalid("invalid category edit merchant alias");
      }
      const categoryId = entry.categoryId === undefined ? undefined : category(entry.categoryId);
      const allocations = entry.allocations === undefined
        ? undefined
        : records(entry.allocations).map(allocation);
      const previousCategoryId = entry.previousCategoryId === undefined
        ? undefined
        : category(entry.previousCategoryId);
      const previousAllocations = entry.previousAllocations === undefined
        ? undefined
        : records(entry.previousAllocations).map(allocation);
      if (
        (entry.mode === "single" && (categoryId === undefined || allocations !== undefined)) ||
        (entry.mode === "split" &&
          (categoryId !== undefined || allocations === undefined || allocations.length < 2 ||
            entry.rememberForMerchant || entry.merchantRuleEffect !== "not-requested")) ||
        (entry.mode === "single" && entry.merchantRuleEffect === "updated" && merchantAlias === "")
      ) {
        invalid("inconsistent transaction category edit");
      }
      return {
        id: text(entry.id),
        sourceTransactionId,
        merchantAlias,
        mode: entry.mode,
        ...(categoryId === undefined ? {} : { categoryId }),
        ...(allocations === undefined ? {} : { allocations }),
        ...(previousCategoryId === undefined ? {} : { previousCategoryId }),
        ...(previousAllocations === undefined ? {} : { previousAllocations }),
        rememberForMerchant: entry.rememberForMerchant,
        merchantRuleEffect: entry.merchantRuleEffect,
        actor: entry.actor,
        correctedAtIso: timestamp(entry.correctedAtIso),
      };
    });
  const sameMerchantPropagations = records(value.sameMerchantPropagations).map((entry) => {
    const changes = records(entry.changes).map((change) => ({
      transactionId: text(change.transactionId),
      beforeCategoryId: change.beforeCategoryId === null ? null : category(change.beforeCategoryId),
      afterCategoryId: category(change.afterCategoryId),
      ...(change.beforeCategorization === undefined ? {} : { beforeCategorization: decision(change.beforeCategorization) }),
      ...(change.afterCategorization === undefined ? {} : { afterCategorization: decision(change.afterCategorization) }),
    }));
    unique(changes.map((change) => change.transactionId));
    return {
      id: text(entry.id), sourceTransactionId: text(entry.sourceTransactionId),
      merchantAlias: text(entry.merchantAlias), categoryId: category(entry.categoryId),
      appliedAtIso: timestamp(entry.appliedAtIso), changes,
      ...(entry.undoneAtIso === undefined ? {} : { undoneAtIso: timestamp(entry.undoneAtIso) }),
    };
  });
  const importOperations = records(value.importOperations).map((entry) => {
    const importJobId = text(entry.importJobId);
    if (!importJobIds.has(importJobId)) invalid("unknown import job");
    if (typeof entry.undoAvailable !== "boolean") invalid("invalid undo availability");
    const accountId = entry.accountId === undefined ? undefined : text(entry.accountId);
    if (accountId !== undefined && !accountIds.has(accountId)) invalid("unknown import account");
    const transactionBaselines = records(entry.transactionBaselines).map((baseline) => {
      const transactionId = text(baseline.transactionId);
      const serializedTransaction = text(baseline.serializedTransaction);
      let parsed: unknown;
      try {
        parsed = JSON.parse(serializedTransaction);
      } catch {
        invalid("invalid undo baseline JSON");
      }
      if (!isRecord(parsed) || parsed.id !== transactionId || parsed.householdId !== householdId ||
        (parsed.importJobId !== null && parsed.importJobId !== importJobId) ||
        !Number.isSafeInteger(parsed.amountMinor)) invalid("invalid undo baseline identity");
      const baselineFields = ["id", "householdId", "accountId", "bookedAtIso", "amountMinor", "merchantRaw",
        "currencyCode", "sourceType", "sourceReference", "categoryId", "categoryAllocations", "importJobId"];
      if (baselineFields.some((field) => !Object.hasOwn(parsed, field))) invalid("incomplete undo baseline");
      if (parsed.categoryId !== null) category(parsed.categoryId);
      const transactions: unknown[] = [{
        ...parsed,
        currencyCode: parsed.currencyCode ?? undefined,
        sourceType: parsed.sourceType ?? undefined,
        sourceReference: parsed.sourceReference ?? undefined,
        categoryId: parsed.categoryId ?? undefined,
        categoryAllocations: parsed.categoryAllocations ?? undefined,
        importJobId: parsed.importJobId ?? undefined,
      }];
      try {
        validateTransactions(transactions, householdId, accountIds, importJobIds, snapshotPath, categoryIds);
      } catch {
        invalid("invalid undo baseline transaction");
      }
      return { transactionId, serializedTransaction };
    });
    unique(transactionBaselines.map((baseline) => baseline.transactionId));
    return {
      importJobId, ...(accountId === undefined ? {} : { accountId }),
      candidateCount: count(entry.candidateCount), importedCount: count(entry.importedCount),
      duplicateCount: count(entry.duplicateCount), undoAvailable: entry.undoAvailable,
      undoRemovedCount: count(entry.undoRemovedCount), undoRetainedCount: count(entry.undoRetainedCount),
      ...(entry.undoneAtIso === undefined ? {} : { undoneAtIso: timestamp(entry.undoneAtIso) }),
      transactionBaselines,
    };
  });
  unique(merchantCorrections.map((entry) => entry.id));
  unique(transactionCategoryEdits.map((entry) => entry.id));
  unique(sameMerchantPropagations.map((entry) => entry.id));
  unique(importOperations.map((entry) => entry.importJobId));
  return { merchantCorrections, transactionCategoryEdits, sameMerchantPropagations, importOperations };
}
