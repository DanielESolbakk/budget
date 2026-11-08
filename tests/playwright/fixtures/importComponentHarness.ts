import React from "react";
import { createRoot } from "react-dom/client";
import type { CsvImportPreviewResponse } from "../../../src/app/import/importCsv.js";
import type { PdfImportPreviewResponse } from "../../../src/app/import/importPdf.js";
import type { ImportPreflightProgress } from "../../../src/app/import/importPreflight.js";
import { CsvImportSection } from "../../../src/renderer/import/CsvImportSection.js";
import { PdfImportSection } from "../../../src/renderer/import/PdfImportSection.js";

export function mountImportComponent(format: "csv" | "pdf") {
  const host = document.createElement("div");
  document.getElementById("root")?.setAttribute("hidden", "");
  document.body.append(host);
  const root = createRoot(host);
  const pending = new Map<string, (outcome: "success" | "cancelled" | "error") => void>();
  const requests: string[] = [];
  const cancelled: string[] = [];
  let failCancellation = false;
  const listeners = new Set<(progress: ImportPreflightProgress) => void>();
  const original = window.budgetApi;
  const preview = <Response,>(
    { requestId }: { requestId?: string },
    success: (requestId: string) => Response,
    cancelledResponse: Response
  ) => {
    if (requestId === undefined) throw new Error("Component omitted preflight request identity.");
    requests.push(requestId);
    return new Promise<Response>((resolve, reject) => {
      pending.set(requestId, (outcome) => {
        if (outcome === "error") reject(new Error("Synthetic preview failure"));
        else resolve(outcome === "cancelled" ? cancelledResponse : success(requestId));
      });
    });
  };
  window.budgetApi = {
    ...original,
    import: {
      ...original.import,
      previewCsv: (input) => preview<CsvImportPreviewResponse>(input,
        (previewId) => ({
          ok: true, previewId, headers: ["Description", "Booked date", "Amount out", "Currency"],
          rows: [], transactions: [],
        }),
        { ok: false, code: "PREVIEW_CANCELLED", message: "Preview cancelled." }),
      previewPdf: (input) => preview<PdfImportPreviewResponse>(input,
        (previewId) => ({
          ok: true, previewId, transactions: [], adapterId: "synthetic",
          excludedRowCount: 0, excludedRows: [],
        }),
        { ok: false, errors: [{ code: "PREVIEW_CANCELLED", message: "Preview cancelled." }] }),
      cancelPreview: async (requestId) => {
        if (failCancellation) throw new Error("Synthetic cancellation failure");
        cancelled.push(requestId);
        return true;
      },
      onPreflightProgress: (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      profiles: { ...original.import.profiles, list: async () => [] },
    },
  };
  let selectionId = 1;
  let path = `first.${format}`;
  let accountId: string | undefined;
  const render = () => {
    const props = {
      initialFilePath: path,
      fileSelectionId: selectionId,
      ...(accountId === undefined ? {} : { preferredAccountId: accountId }),
      onChooseFile: () => {},
      onCancelImport: () => {},
      onImportSuccess: () => {},
      onOpenLedger: () => {},
      onReviewUncategorized: () => {},
      onReviewImportItems: () => {},
    };
    root.render(format === "csv"
      ? React.createElement(CsvImportSection, props)
      : React.createElement(PdfImportSection, props));
  };
  render();
  return {
    requests,
    cancelled,
    failCancellation: () => { failCancellation = true; },
    listenerCount: () => listeners.size,
    changeFile: () => { path = `second.${format}`; selectionId += 1; render(); },
    changeAccount: (next: string) => { accountId = next; render(); },
    progress: (requestId: string, phase: string, progressFormat = format) => {
      for (const listener of listeners) {
        listener({ requestId, format: progressFormat, phase, completedRows: 1, totalRows: 2 });
      }
    },
    settle: (requestId: string, outcome: "success" | "cancelled" | "error") => {
      const request = pending.get(requestId);
      if (request === undefined) throw new Error("Unknown pending request.");
      pending.delete(requestId);
      request(outcome);
    },
    unmount: () => { root.unmount(); },
    dispose: () => {
      root.unmount();
      host.remove();
      window.budgetApi = original;
      document.getElementById("root")?.removeAttribute("hidden");
    },
  };
}
