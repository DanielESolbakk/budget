import { randomUUID } from "node:crypto";
import { submitManualEntry, type ManualEntryResponse } from "../../src/app/import/manualEntry.js";
import { applySameMerchantPropagation, previewSameMerchantPropagation, undoSameMerchantPropagation } from "../../src/app/reviewQueue.js";
import {
  applyCategorizationCorrection,
  applyImportReviewCorrection,
  dismissImportReviewItem,
  listCategorizationReviewQueue,
} from "../../src/app/reviewService.js";
import type { SavedLedgerView } from "../../src/domain/ledger/filterTransactions.js";
import { TransactionAllocationValidationError, type TransactionCategoryAllocationUpdateResult } from "../../src/domain/ledger/transactionAllocations.js";
import { normalizeMerchantName } from "../../src/domain/merchant/normalizeMerchantName.js";
import type { ManualEntryInput } from "../../src/domain/types.js";
import type { LedgerChannelContext } from "./context.js";
import {
  parseImportReviewCorrectionRequest,
  parseImportReviewDismissalRequest,
  parseNonEmptyString,
  parseSameMerchantPropagationInput,
  parseSameMerchantPropagationPreviewRequest,
  parseTransactionCategoryAllocations,
  parseTransactionFilters,
  parseTransactionQuery,
} from "./validation.js";
export function registerReviewLedgerChannels({
  ipcMain,
  assertTrustedRenderer,
  localLedgerDatabase,
  sampleHousehold,
  runtimeState,
  learnedCategoryRules,
  ledgerOperationCoordinator,
  applyTransactionListTestControl
}: Pick<LedgerChannelContext,
  | "ipcMain"
  | "assertTrustedRenderer"
  | "localLedgerDatabase"
  | "sampleHousehold"
  | "runtimeState"
  | "learnedCategoryRules"
  | "ledgerOperationCoordinator"
  | "applyTransactionListTestControl"
>): void {

  ipcMain.handle(
    "transaction:addManual",
    (event, input: unknown): Promise<ManualEntryResponse> => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(() => {
        const inputRecord =
          typeof input === "object" && input !== null
            ? (input as Record<string, unknown>)
            : undefined;

      if (inputRecord === undefined || typeof inputRecord.householdId !== "string") {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_HOUSEHOLD_ID",
          message: "householdId must be a string.",
        };
      }

      if (typeof inputRecord.accountId !== "string") {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_ACCOUNT_ID",
          message: "accountId must be a string.",
        };
      }

      if (typeof inputRecord.bookedAtIso !== "string") {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_BOOKED_AT_ISO",
          message: "bookedAtIso must be a string.",
        };
      }

      if (typeof inputRecord.amountMinor !== "number") {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_AMOUNT_MINOR_INTEGER",
          message: "amountMinor must be a number.",
        };
      }

      if (typeof inputRecord.merchantRaw !== "string") {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_MERCHANT_RAW",
          message: "merchantRaw must be a string.",
        };
      }

      if (inputRecord.categoryId !== undefined && typeof inputRecord.categoryId !== "string") {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_CATEGORY_ID",
          message: "categoryId must be a string when provided.",
        };
      }

        const response = submitManualEntry(
          inputRecord as unknown as ManualEntryInput,
          typeof inputRecord.accountId === "string"
            ? localLedgerDatabase.getTransactionsForAccount(inputRecord.accountId)
            : [],
          localLedgerDatabase
        );
        return response;
      });
    }
  );

  ipcMain.handle("importReview:list", (event) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listImportReviewItems(sampleHousehold.id);
  });

  ipcMain.handle("importReview:correct", (event, input: unknown) => {
    assertTrustedRenderer(event);
    const request = parseImportReviewCorrectionRequest(input);
    return ledgerOperationCoordinator.runExclusive(() => {
      const result = applyImportReviewCorrection(
        localLedgerDatabase,
        sampleHousehold.id,
        request.reviewItemId,
        request.correction,
        new Date().toISOString(),
        learnedCategoryRules
      );
      if (result.ok) runtimeState.ledgerGeneration += 1;
      return result;
    });
  });

  ipcMain.handle("importReview:dismiss", (event, input: unknown) => {
    assertTrustedRenderer(event);
    const request = parseImportReviewDismissalRequest(input);
    return ledgerOperationCoordinator.runExclusive(() =>
      dismissImportReviewItem(
        localLedgerDatabase,
        sampleHousehold.id,
        request.reviewItemId,
        request.reason,
        new Date().toISOString()
      )
    );
  });

  ipcMain.handle("transaction:listReview", async (event) => {
    assertTrustedRenderer(event);
    await applyTransactionListTestControl("review");
    return listCategorizationReviewQueue(localLedgerDatabase, sampleHousehold.id);
  });

  ipcMain.handle("review:correctionHistory:list", (event) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listMerchantCorrectionProvenance();
  });

  ipcMain.handle("review:propagation:preview", (event, input: unknown) => {
    assertTrustedRenderer(event);
    const request = parseSameMerchantPropagationPreviewRequest(input);
    return ledgerOperationCoordinator.runExclusive(() => {
      const sourceTransaction = localLedgerDatabase.getTransactionById(request.sourceTransactionId);
      if (sourceTransaction === undefined || sourceTransaction.householdId !== sampleHousehold.id) {
        throw new Error(`Source transaction not found: ${request.sourceTransactionId}`);
      }
      return previewSameMerchantPropagation(localLedgerDatabase, request.sourceTransactionId);
    });
  });

  ipcMain.handle("review:propagationHistory:list", (event) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listSameMerchantPropagationOperations();
  });

  ipcMain.handle("review:propagation:apply", (event, input: unknown) => {
    assertTrustedRenderer(event);
    const propagation = parseSameMerchantPropagationInput(input);
    return ledgerOperationCoordinator.runExclusive(() => {
      const sourceTransaction = localLedgerDatabase.getTransactionById(propagation.sourceTransactionId);
      if (sourceTransaction === undefined || sourceTransaction.householdId !== sampleHousehold.id) {
        throw new Error(`Source transaction not found: ${propagation.sourceTransactionId}`);
      }
      if (normalizeMerchantName(sourceTransaction.merchantRaw) !== propagation.merchantAlias) {
        throw new Error("Propagation merchantAlias does not match the source transaction.");
      }
      return applySameMerchantPropagation(localLedgerDatabase, propagation);
    });
  });

  ipcMain.handle("review:propagation:undo", (event, operationId: unknown) => {
    assertTrustedRenderer(event);
    return ledgerOperationCoordinator.runExclusive(() =>
      undoSameMerchantPropagation(
        localLedgerDatabase,
        parseNonEmptyString(operationId, "operationId")
      )
    );
  });

  ipcMain.handle("transaction:list", async (event, input: unknown = {}) => {
    assertTrustedRenderer(event);
    await applyTransactionListTestControl("ledger");
    const result = localLedgerDatabase.queryTransactions(sampleHousehold.id, parseTransactionQuery(input));
    const accounts = localLedgerDatabase.getAccountsForHousehold(sampleHousehold.id);
    return { ...result, accounts };
  });

  ipcMain.handle("pending:list", (event) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listPendingTransactionObservations(sampleHousehold.id);
  });

  ipcMain.handle("ledgerView:list", (event) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listSavedLedgerViews();
  });

  ipcMain.handle("ledgerView:save", (event, input: unknown) => {
    assertTrustedRenderer(event);
    if (typeof input !== "object" || input === null) {
      throw new Error("Saved ledger view input must be an object.");
    }
    const record = input as Record<string, unknown>;
    const name = parseNonEmptyString(record.name, "name");
    if (name.length > 40) throw new Error("Saved view name must be 40 characters or fewer.");
    const savedView: SavedLedgerView = {
      id: randomUUID(),
      name,
      filters: parseTransactionFilters(record.filters),
    };
    localLedgerDatabase.saveLedgerView(savedView);
    return savedView;
  });

  ipcMain.handle("ledgerView:delete", (event, viewId: unknown) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.deleteSavedLedgerView(parseNonEmptyString(viewId, "viewId"));
  });

  ipcMain.handle(
    "transaction:updateCategory",
    (event, input: unknown) => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(() => {
      if (typeof input !== "object" || input === null) {
        throw new Error("Category update input must be an object.");
      }
      const record = input as Record<string, unknown>;
      const transactionId = parseNonEmptyString(record.transactionId, "transactionId");
      const categoryId = parseNonEmptyString(record.categoryId, "categoryId");
      return applyCategorizationCorrection(
        localLedgerDatabase,
        learnedCategoryRules,
        transactionId,
        categoryId
      );
      });
    }
  );

  ipcMain.handle(
    "transaction:updateCategoryAllocations",
    async (event, input: unknown): Promise<TransactionCategoryAllocationUpdateResult> => {
      assertTrustedRenderer(event);
      if (typeof input !== "object" || input === null) {
        throw new Error("Transaction allocation update input must be an object.");
      }
      const record = input as Record<string, unknown>;
      const transactionId = parseNonEmptyString(record.transactionId, "transactionId");
      const allocations = parseTransactionCategoryAllocations(record.allocations);
      try {
        const transaction = await ledgerOperationCoordinator.runExclusive(() =>
          localLedgerDatabase.updateTransactionCategoryAllocations(transactionId, allocations)
        );
        return { ok: true, transaction };
      } catch (error: unknown) {
        if (error instanceof TransactionAllocationValidationError) {
          return { ok: false, code: error.code, message: error.message };
        }
        throw error;
      }
    }
  );
}
