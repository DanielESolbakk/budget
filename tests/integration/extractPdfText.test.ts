import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pdfParseMocks = vi.hoisted(() => ({
  getText: vi.fn(),
  destroy: vi.fn(),
  recordInput: vi.fn()
}));

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    constructor(options: { data: Buffer }) {
      pdfParseMocks.recordInput(options.data);
    }

    getText() {
      return pdfParseMocks.getText();
    }

    destroy() {
      return pdfParseMocks.destroy();
    }
  }
}));

import {
  extractPdfTextFromBuffer,
  extractPdfTextFromFile
} from "../../src/app/import/extractPdfText.js";

describe("PDF text extraction service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfParseMocks.getText.mockResolvedValue({ text: "Extracted statement text" });
    pdfParseMocks.destroy.mockResolvedValue(undefined);
  });

  it("passes through buffers that are not PDFs as UTF-8 text", async () => {
    const textBuffer = Buffer.from("synthetic statement text", "utf8");

    await expect(extractPdfTextFromBuffer(textBuffer)).resolves.toBe("synthetic statement text");
    expect(pdfParseMocks.recordInput).not.toHaveBeenCalled();
  });

  it("returns parsed text and destroys the parser after success", async () => {
    const pdfBuffer = Buffer.from("%PDF-synthetic", "ascii");

    await expect(extractPdfTextFromBuffer(pdfBuffer)).resolves.toBe("Extracted statement text");
    expect(pdfParseMocks.recordInput).toHaveBeenCalledWith(pdfBuffer);
    expect(pdfParseMocks.destroy).toHaveBeenCalledOnce();
  });

  it("destroys the parser and propagates parsing failures", async () => {
    const parserError = new Error("Synthetic parser failure");
    pdfParseMocks.getText.mockRejectedValueOnce(parserError);

    await expect(
      extractPdfTextFromBuffer(Buffer.from("%PDF-synthetic", "ascii"))
    ).rejects.toBe(parserError);
    expect(pdfParseMocks.destroy).toHaveBeenCalledOnce();
  });

  it("reads file bytes before extracting PDF text", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-pdf-text-"));
    const filePath = join(tempDir, "synthetic.pdf");
    const pdfBuffer = Buffer.from("%PDF-synthetic-file", "ascii");

    try {
      writeFileSync(filePath, pdfBuffer);

      await expect(extractPdfTextFromFile(filePath)).resolves.toBe("Extracted statement text");
      expect(pdfParseMocks.recordInput).toHaveBeenCalledWith(pdfBuffer);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("propagates file-read failures without constructing a parser", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-pdf-missing-"));
    const missingPath = join(tempDir, "missing.pdf");

    try {
      await expect(extractPdfTextFromFile(missingPath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(pdfParseMocks.recordInput).not.toHaveBeenCalled();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});