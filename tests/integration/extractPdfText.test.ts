import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractPdfTextFromBuffer,
  extractPdfTextFromFile
} from "../../src/app/import/extractPdfText.js";

const BINARY_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-binary.pdf");

describe("PDF text extraction service", () => {
  it("passes through buffers that are not PDFs as UTF-8 text", async () => {
    const textBuffer = Buffer.from("synthetic statement text", "utf8");

    await expect(extractPdfTextFromBuffer(textBuffer)).resolves.toBe("synthetic statement text");
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