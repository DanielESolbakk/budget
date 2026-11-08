import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "path";
import { extractSourceDocumentFromBuffer } from "../../src/app/import/extractPdfText.js";
import {
  buildCsvImportRequest,
  classifyPreviouslyImportedCsvCandidates,
  normalizeCsvImportErrors,
  previewCsvRowsWithProgress,
  runCsvImportWorkflow,
  type CsvImportPreviewResponse,
  type CsvImportResponse,
} from "../../src/app/import/importCsv.js";
import {
  buildPdfImportRequest,
  normalizePdfImportErrors,
  previewPdfImportWorkflowInBatches,
  runPdfImportWorkflow,
  type PdfImportPreviewResponse,
  type PdfImportResponse,
} from "../../src/app/import/importPdf.js";
import type { ImportPreflightProgress } from "../../src/app/import/importPreflight.js";
import { digestImportBytes, ImportPreviewError } from "../../src/app/import/importPreviewRegistry.js";
import type { CsvImportProfile } from "../../src/domain/import/csvImportProfile.js";
import { classifyDuplicateCandidates } from "../../src/domain/import/filterPreviouslyImportedTransactions.js";
import type { ImportJobHistoryEntry } from "../../src/domain/import/importJobHistory.js";
import { decodeCsvBytes, parseRogalandCsvText } from "../../src/domain/import/parseCsvText.js";
import { defaultParserAdapterRegistry } from "../../src/domain/import/parserAdapterRegistry.js";
import type { LedgerChannelContext } from "./context.js";
import {
  csvPreviewFailure,
  csvPreviewReceiptFailure,
  getPdfImportSourceFormat,
  invalidAccountMessage,
  parseCsvImportProfileInput,
  parseNonEmptyString,
  parseRendererImportInput,
  pdfPreviewReceiptFailure,
} from "./validation.js";
export function registerImportsChannels({
  ipcMain,
  assertTrustedRenderer,
  localLedgerDatabase,
  sampleHousehold,
  runtimeState,
  learnedCategoryRules,
  importPreviewRegistry,
  ledgerOperationCoordinator,
  activeImportPreflights,
  resolveDefaultAccountId,
  accountBelongsToHousehold,
  applyRuntimeLedgerSnapshot
}: Pick<LedgerChannelContext,
  | "ipcMain"
  | "assertTrustedRenderer"
  | "localLedgerDatabase"
  | "sampleHousehold"
  | "runtimeState"
  | "learnedCategoryRules"
  | "importPreviewRegistry"
  | "ledgerOperationCoordinator"
  | "activeImportPreflights"
  | "resolveDefaultAccountId"
  | "accountBelongsToHousehold"
  | "applyRuntimeLedgerSnapshot"
>): void {

  ipcMain.handle("import:preflight:cancel", (event, requestId: unknown): boolean => {
    assertTrustedRenderer(event);
    const preflight = activeImportPreflights.get(parseNonEmptyString(requestId, "requestId"));
    if (preflight === undefined) return false;
    preflight.cancelled = true;
    return true;
  });

  ipcMain.handle("import:history:list", (event): ImportJobHistoryEntry[] => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listImportJobHistory(sampleHousehold.id);
  });

  ipcMain.handle("import:history:undo", (event, importJobId: unknown) => {
    assertTrustedRenderer(event);
    return ledgerOperationCoordinator.runExclusive(() => {
      const result = localLedgerDatabase.undoImportJob(parseNonEmptyString(importJobId, "importJobId"));
      const runtimeMetadata = localLedgerDatabase.loadRuntimeMetadata();
      if (runtimeMetadata !== null) applyRuntimeLedgerSnapshot(runtimeMetadata);
      runtimeState.ledgerGeneration += 1;
      importPreviewRegistry.invalidateAll();
      return result;
    });
  });

  ipcMain.handle("import:csvProfiles:list", (event): CsvImportProfile[] => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listCsvImportProfiles(sampleHousehold.id);
  });

  ipcMain.handle("import:csvProfiles:save", (event, input: unknown): CsvImportProfile => {
    assertTrustedRenderer(event);
    const parsedInput = parseCsvImportProfileInput(input);
    const householdId = sampleHousehold.id;
    if (!accountBelongsToHousehold(parsedInput.accountId, householdId)) {
      throw new Error(invalidAccountMessage(parsedInput.accountId));
    }

    const existingProfiles = localLedgerDatabase.listCsvImportProfiles(householdId);
    const existingProfile = parsedInput.id === undefined
      ? undefined
      : existingProfiles.find((profile) => profile.id === parsedInput.id);
    if (parsedInput.id !== undefined && existingProfile === undefined) {
      throw new Error("CSV import profile was not found in this household.");
    }

    const now = new Date().toISOString();
    const profile: CsvImportProfile = {
      id: existingProfile?.id ?? randomUUID(),
      householdId,
      name: parsedInput.name,
      accountId: parsedInput.accountId,
      columnMapping: parsedInput.columnMapping,
      createdAtIso: existingProfile?.createdAtIso ?? now,
      updatedAtIso: now,
    };
    localLedgerDatabase.saveCsvImportProfile(profile);
    return profile;
  });

  ipcMain.handle("import:csvProfiles:delete", (event, profileId: unknown): boolean => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.deleteCsvImportProfile(
      sampleHousehold.id,
      parseNonEmptyString(profileId, "profileId")
    );
  });

  ipcMain.handle(
    "import:csvPreview",
    async (
      event,
      input: unknown
    ): Promise<CsvImportPreviewResponse> => {
      assertTrustedRenderer(event);
      const parsedInput = parseRendererImportInput(input, { csv: true, requirePreviewId: false });
      const householdId = sampleHousehold.id;
      const accountId = parsedInput.accountId ?? resolveDefaultAccountId(householdId);
      if (!accountBelongsToHousehold(accountId, householdId)) {
        return csvPreviewFailure("INVALID_ACCOUNT_ID", invalidAccountMessage(accountId));
      }
      const request = buildCsvImportRequest(parsedInput.filePath, {
        householdId,
        accountId,
        columnMapping: parsedInput.columnMapping,
      });
      const requestId = parsedInput.requestId ?? randomUUID();
      if (activeImportPreflights.has(requestId)) throw new Error("An import preflight with this request ID is already active.");
      const preflight = { cancelled: false };
      const previewGeneration = runtimeState.ledgerGeneration;
      activeImportPreflights.set(requestId, preflight);
      const reportProgress = (phase: string, completedRows: number, totalRows: number): void => {
        const progress: ImportPreflightProgress = { requestId, format: "csv", phase, completedRows, totalRows };
        event.sender.send("import:preflight:progress", progress);
      };

      try {
        reportProgress("Reading statement", 0, 0);
        let csvBytes: Buffer;
        try {
          csvBytes = await readFile(request.filePath);
        } catch (fileError) {
          return csvPreviewFailure(
            "FILE_READ_ERROR",
            fileError instanceof Error ? fileError.message : "Could not read CSV file."
          );
        }
        if (preflight.cancelled) return csvPreviewFailure("PREVIEW_CANCELLED", "Preview cancelled. No transactions were saved.");

        const csvText = decodeCsvBytes(csvBytes);
        const rows = parseRogalandCsvText(csvText);
        reportProgress("Validating rows", 0, rows.length);
        const preview = await previewCsvRowsWithProgress(rows, {
          householdId: request.householdId,
          accountId: request.accountId,
          columnMapping: request.columnMapping,
          sourceIdentity: digestImportBytes(csvBytes),
          sourceScope: process.platform === "win32" ? resolve(request.filePath).toLowerCase() : resolve(request.filePath),
        }, {
          isCancelled: () => preflight.cancelled,
          onProgress: (completedRows, totalRows) => reportProgress("Validating rows", completedRows, totalRows),
          batchSize: 100,
        });
        if (preview === null || preflight.cancelled) {
          return csvPreviewFailure("PREVIEW_CANCELLED", "Preview cancelled. No transactions were saved.");
        }
        if (previewGeneration !== runtimeState.ledgerGeneration) {
          return csvPreviewFailure("PREVIEW_STALE", "The ledger changed while the statement was being checked. Preview it again.");
        }

        const snapshot = localLedgerDatabase.loadLedgerSnapshotData();
        const previouslyImported = localLedgerDatabase.getImportedTransactionsForSource(
          "csv",
          request.filePath,
          request.accountId,
          digestImportBytes(csvBytes)
        );
        const duplicateMatches = new Map(classifyPreviouslyImportedCsvCandidates(
          preview.transactions,
          previouslyImported,
          snapshot,
          { filePath: request.filePath, accountId: request.accountId, sourceIdentity: digestImportBytes(csvBytes) }
        )
          .filter((candidate) => candidate.duplicateMatch !== undefined)
          .map((candidate) => [candidate.candidate.id, candidate.duplicateMatch!]));
        const rowsWithDuplicateMatches = preview.rows.map((row) => {
          const duplicateMatch = row.transaction === undefined ? undefined : duplicateMatches.get(row.transaction.id);
          return duplicateMatch === undefined ? row : { ...row, duplicateMatch };
        });
        const previewId = importPreviewRegistry.create({
          format: "csv",
          filePath: request.filePath,
          fileDigest: digestImportBytes(csvBytes),
          householdId,
          accountId,
          ...(request.columnMapping === undefined ? {} : { columnMapping: request.columnMapping }),
        });
        return { ok: true, previewId, headers: Object.keys(rows[0] ?? {}), ...preview, rows: rowsWithDuplicateMatches };
      } finally {
        activeImportPreflights.delete(requestId);
      }
    }
  );

  ipcMain.handle(
    "import:csv",
    (
      event,
      input: unknown
    ): Promise<CsvImportResponse> => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(async () => {
        const parsedInput = parseRendererImportInput(input, { csv: true, requirePreviewId: true });
      const householdId = sampleHousehold.id;
      const accountId = parsedInput.accountId ?? resolveDefaultAccountId(householdId);
      if (!accountBelongsToHousehold(accountId, householdId)) {
        return {
          ok: false,
          errors: [
            {
              rowIndex: -1,
              fields: ["accountId"],
              codes: ["INVALID_ACCOUNT_ID"],
              messages: [invalidAccountMessage(accountId)],
            },
          ],
        };
      }

      const request = buildCsvImportRequest(parsedInput.filePath, {
        householdId,
        accountId,
        columnMapping: parsedInput.columnMapping,
      });

      let csvBytes: Buffer;
      try {
        csvBytes = readFileSync(request.filePath);
      } catch (fileError) {
        const message =
          fileError instanceof Error ? fileError.message : "Could not read CSV file.";
        return normalizeCsvImportErrors([
          {
            rowIndex: -1,
            errors: [{ code: "MISSING_DATE", message, field: "file" }],
          },
        ]);
      }

      try {
        importPreviewRegistry.claim(parsedInput.previewId!, {
          format: "csv",
          filePath: request.filePath,
          fileDigest: digestImportBytes(csvBytes),
          householdId,
          accountId,
          ...(request.columnMapping === undefined ? {} : { columnMapping: request.columnMapping }),
        });
      } catch (error) {
        if (error instanceof ImportPreviewError) {
          return csvPreviewReceiptFailure(error);
        }
        throw error;
      }

      const csvText = decodeCsvBytes(csvBytes);
      const rows = parseRogalandCsvText(csvText);
      const canonicalPath = process.platform === "win32" ? resolve(request.filePath).toLowerCase() : resolve(request.filePath);
      const importJobId = `import-csv-${randomUUID()}`;
      const now = new Date().toISOString();
      const sourceIdentity = digestImportBytes(csvBytes);

      try {
        const response = runCsvImportWorkflow({
          ...request,
          rows,
          importJobId,
          startedAtIso: now,
          finishedAtIso: now,
          sourceIdentity,
          sourceScope: canonicalPath,
          ...(parsedInput.duplicateDecisions === undefined ? {} : { duplicateDecisions: parsedInput.duplicateDecisions }),
        }, {
          categoryRules: learnedCategoryRules,
          loadLedgerSnapshotData: localLedgerDatabase.loadLedgerSnapshotData,
          getImportedTransactionsForSource: localLedgerDatabase.getImportedTransactionsForSource,
          appendImportJobAndTransactions: localLedgerDatabase.appendImportJobAndTransactions,
          getTransactionsForImportJob: localLedgerDatabase.getTransactionsForImportJob,
        });
        if (response.ok) {
          importPreviewRegistry.complete(parsedInput.previewId!);
        } else {
          importPreviewRegistry.release(parsedInput.previewId!);
        }
        return response;
      } catch (error) {
        importPreviewRegistry.release(parsedInput.previewId!);
        throw error;
      }
      });
    }
  );

  ipcMain.handle(
    "import:pdfPreview",
    async (
      event,
      input: unknown
    ): Promise<PdfImportPreviewResponse> => {
      assertTrustedRenderer(event);
      const previewGeneration = runtimeState.ledgerGeneration;
      const parsedInput = parseRendererImportInput(input, { csv: false, requirePreviewId: false });
      const householdId = sampleHousehold.id;
      const accountId = parsedInput.accountId ?? resolveDefaultAccountId(householdId);
      if (!accountBelongsToHousehold(accountId, householdId)) {
        return {
          ok: false,
          errors: [{ code: "INVALID_ACCOUNT_ID", message: invalidAccountMessage(accountId) }],
        };
      }
      const request = buildPdfImportRequest(parsedInput.filePath, { householdId, accountId });
      const requestId = parsedInput.requestId ?? randomUUID();
      if (activeImportPreflights.has(requestId)) throw new Error("An import preflight with this request ID is already active.");
      const preflight = { cancelled: false };
      activeImportPreflights.set(requestId, preflight);
      const reportProgress = (phase: string, completedRows: number, totalRows: number): void => {
        const progress: ImportPreflightProgress = { requestId, format: "pdf", phase, completedRows, totalRows };
        event.sender.send("import:preflight:progress", progress);
      };

      try {
        reportProgress("Reading statement", 0, 0);
        let pdfBytes: Buffer;
        try {
          pdfBytes = await readFile(request.filePath);
        } catch (fileError) {
          return normalizePdfImportErrors([{
            code: "FILE_READ_ERROR",
            message: fileError instanceof Error ? fileError.message : "Could not read PDF text file.",
          }], { sourceName: request.filePath });
        }
        if (preflight.cancelled) {
          return { ok: false, errors: [{ code: "PREVIEW_CANCELLED", message: "Preview cancelled. No transactions were saved." }] };
        }

        reportProgress("Extracting statement text", 0, 0);
        let sourceDocument: Awaited<ReturnType<typeof extractSourceDocumentFromBuffer>>;
        try {
          sourceDocument = await extractSourceDocumentFromBuffer(
            pdfBytes,
            getPdfImportSourceFormat(request.filePath)
          );
        } catch (error) {
          return normalizePdfImportErrors([{
            code: "FILE_READ_ERROR",
            message: error instanceof Error ? error.message : "Could not extract PDF text.",
          }], { sourceName: request.filePath });
        }
        const pdfText = sourceDocument.text;
        if (preflight.cancelled) {
          return { ok: false, errors: [{ code: "PREVIEW_CANCELLED", message: "Preview cancelled. No transactions were saved." }] };
        }
        const totalRows = pdfText.match(/^\s*\d{2}\.\d{2}\.\d{4}\s+/gm)?.length ?? 0;
        reportProgress("Validating statement rows", 0, totalRows);
        const preview = await previewPdfImportWorkflowInBatches(
          {
            pdfText,
            sourceDocument,
            filePath: request.filePath,
            householdId: request.householdId,
            accountId: request.accountId,
          },
          defaultParserAdapterRegistry,
          {
            isCancelled: () => preflight.cancelled,
            onProgress: (completedRows, batchTotalRows) => {
              if (completedRows % 100 === 0 || completedRows === batchTotalRows) {
                reportProgress("Validating statement rows", completedRows, batchTotalRows);
              }
            },
            batchSize: 10,
          }
        );
        if (preview === null || preflight.cancelled) {
          return { ok: false, errors: [{ code: "PREVIEW_CANCELLED", message: "Preview cancelled. No transactions were saved." }] };
        }
        if (!preview.ok) return preview;
        if (previewGeneration !== runtimeState.ledgerGeneration) {
          return normalizePdfImportErrors([{
            code: "FILE_READ_ERROR",
            message: "The ledger changed while the statement was being checked. Preview the statement again.",
          }]);
        }
        if (preflight.cancelled) {
          return { ok: false, errors: [{ code: "PREVIEW_CANCELLED", message: "Preview cancelled. No transactions were saved." }] };
        }
        reportProgress("Validating statement rows", preview.transactions.length, preview.transactions.length);

        const existingTransactions = localLedgerDatabase.getTransactionsForAccount(request.accountId);
        const duplicateCandidates = classifyDuplicateCandidates(preview.transactions, existingTransactions)
          .flatMap((candidate, rowIndex) => candidate.duplicateMatch === undefined
            ? []
            : [{ rowIndex, transactionId: candidate.candidate.id, duplicateMatch: candidate.duplicateMatch }]);

        const previewId = importPreviewRegistry.create({
          format: "pdf",
          filePath: request.filePath,
          fileDigest: digestImportBytes(pdfBytes),
          householdId,
          accountId,
        });
        return { ...preview, previewId, duplicateCandidates };
      } finally {
        activeImportPreflights.delete(requestId);
      }
    }
  );

  ipcMain.handle(
    "import:pdf",
    async (
      event,
      input: unknown
    ): Promise<PdfImportResponse> => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(async () => {
      const parsedInput = parseRendererImportInput(input, { csv: false, requirePreviewId: true });
      const householdId = sampleHousehold.id;
      const accountId = parsedInput.accountId ?? resolveDefaultAccountId(householdId);
      if (!accountBelongsToHousehold(accountId, householdId)) {
        return {
          ok: false,
          errors: [{ code: "INVALID_ACCOUNT_ID", message: invalidAccountMessage(accountId) }],
        };
      }

      const request = buildPdfImportRequest(parsedInput.filePath, { householdId, accountId });

      let pdfBytes: Buffer;
      try {
        pdfBytes = readFileSync(request.filePath);
      } catch (fileError) {
        const message =
          fileError instanceof Error ? fileError.message : "Could not read PDF text file.";
        return normalizePdfImportErrors([{ code: "FILE_READ_ERROR", message }], { sourceName: request.filePath });
      }

      try {
        importPreviewRegistry.claim(parsedInput.previewId!, {
          format: "pdf",
          filePath: request.filePath,
          fileDigest: digestImportBytes(pdfBytes),
          householdId,
          accountId,
        });
      } catch (error) {
        if (error instanceof ImportPreviewError) {
          return pdfPreviewReceiptFailure(error);
        }
        throw error;
      }

      let sourceDocument: Awaited<ReturnType<typeof extractSourceDocumentFromBuffer>>;
      try {
        sourceDocument = await extractSourceDocumentFromBuffer(
          pdfBytes,
          getPdfImportSourceFormat(request.filePath)
        );
      } catch (error) {
        importPreviewRegistry.release(parsedInput.previewId!);
        const message = error instanceof Error ? error.message : "Could not extract PDF text.";
        return normalizePdfImportErrors([{ code: "FILE_READ_ERROR", message }], { sourceName: request.filePath });
      }
      const pdfText = sourceDocument.text;

      const importJobId = `import-pdf-${randomUUID()}`;
      const now = new Date().toISOString();

      let response: PdfImportResponse;
      try {
        response = runPdfImportWorkflow({
          pdfText,
          sourceDocument,
          filePath: request.filePath,
          householdId: request.householdId,
          accountId: request.accountId,
          importJobId,
          categoryRules: learnedCategoryRules,
          ...(parsedInput.duplicateDecisions === undefined ? {} : { duplicateDecisions: parsedInput.duplicateDecisions }),
          ...(parsedInput.acknowledgeExcludedRows === undefined ? {} : { acknowledgeExcludedRows: parsedInput.acknowledgeExcludedRows }),
          startedAtIso: now,
          finishedAtIso: now,
        }, {
          parserRegistry: defaultParserAdapterRegistry,
          hasImportJob: localLedgerDatabase.hasImportJob,
          getTransactionsForImportJob: localLedgerDatabase.getTransactionsForImportJob,
          getImportedTransactionsForSource: localLedgerDatabase.getImportedTransactionsForSource,
          getExistingTransactionsForAccount: localLedgerDatabase.getTransactionsForAccount,
          getAccountCurrencyCode: (accountId) =>
            localLedgerDatabase.getAccountsForHousehold(householdId)
              .find((account) => account.id === accountId)?.currencyCode,
          appendImportJob: localLedgerDatabase.appendImportJob,
          appendImportJobAndTransactions: localLedgerDatabase.appendImportJobAndTransactions,
          appendTransactions: localLedgerDatabase.appendTransactions,
        });
      } catch (error) {
        importPreviewRegistry.release(parsedInput.previewId!);
        throw error;
      }
      if (response.ok) {
        importPreviewRegistry.complete(parsedInput.previewId!);
      } else {
        importPreviewRegistry.release(parsedInput.previewId!);
      }
      return response;
      });
    }
  );
}
