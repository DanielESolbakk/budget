import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractSourceDocumentFromBuffer,
  extractPdfTextFromBuffer,
  extractPdfTextFromFile
} from "../../src/app/import/extractPdfText.js";

const BINARY_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-binary.pdf");

describe("PDF text extraction service", () => {
  it("passes through buffers that are not PDFs as UTF-8 text", async () => {
    const textBuffer = Buffer.from("synthetic statement text", "utf8");

    await expect(extractPdfTextFromBuffer(textBuffer)).resolves.toBe("synthetic statement text");
  });

  it("passes standalone text through the shared source document with page-local offsets", async () => {
    const sourceText = "BANK-B\nSYNTHETIC ROW";
    const sourceDocument = await extractSourceDocumentFromBuffer(Buffer.from(sourceText, "utf8"));

    expect(sourceDocument).toMatchObject({
      format: "text",
      text: sourceText,
      capabilities: expect.arrayContaining(["plain-text", "ordered-pages", "source-offsets", "standalone-text"]),
      pages: [{
        pageNumber: 1,
        sourceText,
        sourceLines: [
          { pageNumber: 1, lineNumber: 1, startOffset: 0, endOffset: 6, rawText: "BANK-B" },
          { pageNumber: 1, lineNumber: 2, startOffset: 7, endOffset: 20, rawText: "SYNTHETIC ROW" },
        ],
      }],
    });
  });

  it("retains ordered page identity and source offsets for binary PDF text", async () => {
    const extractionModule = await import("../../src/app/import/extractPdfText.js");
    const extractSourceDocumentFromBuffer = (
      extractionModule as unknown as {
        extractSourceDocumentFromBuffer?: (data: Buffer) => Promise<{
          format: "pdf" | "text";
          pages: Array<{
            pageNumber: number;
            text: string;
            sourceText: string;
            sourceLines: Array<{
              lineNumber: number;
              startOffset: number;
              endOffset: number;
              rawText: string;
            }>;
          }>;
        }>;
      }
    ).extractSourceDocumentFromBuffer;

    expect(extractSourceDocumentFromBuffer).toBeTypeOf("function");
    if (extractSourceDocumentFromBuffer === undefined) return;

    const sourceDocument = await extractSourceDocumentFromBuffer(readFileSync(BINARY_FIXTURE_PATH));
    expect(sourceDocument.format).toBe("pdf");
    expect(sourceDocument.pages.map((page) => page.pageNumber)).toEqual([1]);

    const page = sourceDocument.pages[0];
    expect(page?.text).toContain("SALARY");
    const salaryLine = page?.sourceLines.find((line) => line.rawText.includes("SALARY"));
    expect(salaryLine).toBeDefined();
    if (page === undefined || salaryLine === undefined) return;

    expect(page.sourceText.slice(salaryLine.startOffset, salaryLine.endOffset)).toBe(salaryLine.rawText);
  });

  it("extracts positioned text from the synthetic binary PDF fixture", async () => {
    const pdfBuffer = readFileSync(BINARY_FIXTURE_PATH);
    const extractedText = await extractPdfTextFromBuffer(pdfBuffer);

    expect(extractedText).toContain("ROGALAND SPAREBANK");
    expect(extractedText).toContain("27.05.2026");
    expect(extractedText).toContain("SALARY");
  });

  it("reads file bytes before extracting PDF text", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-pdf-text-"));
    const filePath = join(tempDir, "synthetic.pdf");
    const pdfBuffer = readFileSync(BINARY_FIXTURE_PATH);

    try {
      writeFileSync(filePath, pdfBuffer);

      const extractedText = await extractPdfTextFromFile(filePath);
      expect(extractedText).toContain("MERCHANT-005 Butikkjop");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("propagates file-read failures without constructing a parser", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "budget-pdf-missing-"));
    const missingPath = join(tempDir, "missing.pdf");

    try {
      await expect(extractPdfTextFromFile(missingPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});