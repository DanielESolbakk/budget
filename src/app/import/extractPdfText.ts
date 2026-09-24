import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

export async function extractPdfTextFromBuffer(data: Buffer): Promise<string> {

  if (data.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return data.toString("utf8");
  }

  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

export async function extractPdfTextFromFile(filePath: string): Promise<string> {
  return extractPdfTextFromBuffer(await readFile(filePath));
}
