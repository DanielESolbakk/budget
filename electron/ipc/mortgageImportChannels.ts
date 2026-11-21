import type { MortgageEvidenceAcceptanceSummary, MortgageImportTarget } from "../../src/shared/mortgageBankEvidence.js";
import type { LedgerChannelContext } from "./context.js";
import { parseNonEmptyString } from "./validation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTarget(value: unknown): MortgageImportTarget {
  if (!isRecord(value)) throw new Error("Mortgage import target must be an object.");
  if (value["kind"] === "existing") {
    return {
      kind: "existing",
      loanId: parseNonEmptyString(value["loanId"], "loanId"),
    };
  }
  if (value["kind"] === "new-source-only") {
    const propertyId = value["propertyId"];
    if (propertyId !== undefined && (typeof propertyId !== "string" || propertyId.trim() === "")) {
      throw new Error("propertyId must be a non-empty string when provided.");
    }
    return {
      kind: "new-source-only",
      label: parseNonEmptyString(value["label"], "label"),
      ...(propertyId === undefined ? {} : { propertyId }),
    };
  }
  throw new Error("Mortgage import target kind is unsupported.");
}

function parsePreviewInput(value: unknown): {
  requestId: string;
  target: MortgageImportTarget;
} {
  if (!isRecord(value)) throw new Error("Mortgage preview request must be an object.");
  if (Object.hasOwn(value, "filePaths")) {
    throw new Error("Mortgage file paths must be chosen by the desktop dialog.");
  }
  if (Object.hasOwn(value, "attachmentConfirmed")) {
    throw new Error("Attachment confirmation must use its dedicated action.");
  }
  return {
    requestId: parseNonEmptyString(value["requestId"], "requestId"),
    target: parseTarget(value["target"]),
  };
}

function parseAcceptInput(value: unknown): {
  previewId: string;
  acceptPartial: boolean;
  acknowledgeTermDifferences: boolean;
} {
  if (!isRecord(value)) throw new Error("Mortgage acceptance request must be an object.");
  const acceptPartial = value["acceptPartial"] ?? false;
  if (typeof acceptPartial !== "boolean") throw new Error("acceptPartial must be a boolean.");
  const acknowledgeTermDifferences = value["acknowledgeTermDifferences"] ?? false;
  if (typeof acknowledgeTermDifferences !== "boolean") {
    throw new Error("acknowledgeTermDifferences must be a boolean.");
  }
  return {
    previewId: parseNonEmptyString(value["previewId"], "previewId"),
    acceptPartial,
    acknowledgeTermDifferences,
  };
}

function acceptanceSummary(
  evidence: ReturnType<LedgerChannelContext["mortgageBankImportService"]["acceptPreview"]>
): MortgageEvidenceAcceptanceSummary {
  return {
    id: evidence.id,
    loanId: evidence.loanId,
    versionNumber: evidence.versionNumber,
    sourceAsOfDateIso: evidence.sourceAsOfDateIso,
    importedAtIso: evidence.importedAtIso,
    documentRoles: evidence.documents.map((document) => document.role),
    attachment: evidence.attachment,
    termDifferenceCount: evidence.termComparisons.filter((comparison) =>
      comparison.status === "differs"
    ).length,
    termDifferencesAcknowledged: evidence.termDifferencesAcknowledged,
    scheduleValidationStatus: evidence.scheduleValidation?.status ?? null,
  };
}

export function registerMortgageImportChannels({
  ipcMain,
  assertTrustedRenderer,
  mortgageBankImportService,
  mortgageHtmlImportDialog,
  ledgerOperationCoordinator,
  runtimeState,
}: Pick<LedgerChannelContext,
  | "ipcMain"
  | "assertTrustedRenderer"
  | "mortgageBankImportService"
  | "mortgageHtmlImportDialog"
  | "ledgerOperationCoordinator"
  | "runtimeState"
>): void {
  ipcMain.handle("mortgageImport:previewFiles", async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const request = parsePreviewInput(input);
    mortgageBankImportService.beginPreviewRequest(request.requestId);
    try {
      const result = await mortgageHtmlImportDialog({
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Mortgage HTML documents", extensions: ["html", "htm"] }],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return await mortgageBankImportService.previewFiles({
        requestId: request.requestId,
        filePaths: result.filePaths,
        target: request.target,
        attachmentConfirmed: false,
      });
    } finally {
      mortgageBankImportService.finishPreviewRequest(request.requestId);
    }
  });

  ipcMain.handle("mortgageImport:confirmAttachment", (event, previewId: unknown) => {
    assertTrustedRenderer(event);
    return mortgageBankImportService.confirmAttachmentPreview(
      parseNonEmptyString(previewId, "previewId")
    );
  });

  ipcMain.handle("mortgageImport:acceptPreview", (event, input: unknown) => {
    assertTrustedRenderer(event);
    const request = parseAcceptInput(input);
    return ledgerOperationCoordinator.runExclusive(() => {
      const evidence = mortgageBankImportService.acceptPreview(
        request.previewId,
        request.acceptPartial,
        request.acknowledgeTermDifferences
      );
      runtimeState.ledgerGeneration += 1;
      return acceptanceSummary(evidence);
    });
  });

  ipcMain.handle("mortgageImport:cancelPreview", (event, previewId: unknown): boolean => {
    assertTrustedRenderer(event);
    return mortgageBankImportService.cancelPreview(
      parseNonEmptyString(previewId, "previewId")
    );
  });

  ipcMain.handle("mortgageImport:listEvidenceSummaries", (event) => {
    assertTrustedRenderer(event);
    return mortgageBankImportService.listEvidenceSummaries();
  });
}
