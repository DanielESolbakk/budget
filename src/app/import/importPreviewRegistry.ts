import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { CsvColumnMapping } from "../../domain/import/csvRowMapper.js";

export type ImportPreviewFormat = "csv" | "pdf";

export interface ImportPreviewContext {
  format: ImportPreviewFormat;
  filePath: string;
  fileDigest: string;
  householdId: string;
  accountId: string;
  columnMapping?: CsvColumnMapping | undefined;
}

interface StoredImportPreview extends ImportPreviewContext {
  previewId: string;
  createdAtMs: number;
  expiresAtMs: number;
  claimed: boolean;
}

export type ImportPreviewErrorCode =
  | "PREVIEW_NOT_FOUND"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_IN_USE"
  | "PREVIEW_STALE"
  | "PREVIEW_CONTEXT_MISMATCH";

export class ImportPreviewError extends Error {
  readonly code: ImportPreviewErrorCode;

  constructor(code: ImportPreviewErrorCode, message: string) {
    super(message);
    this.name = "ImportPreviewError";
    this.code = code;
  }
}

function canonicalizeFilePath(filePath: string): string {
  const resolvedPath = resolve(filePath);
  return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

function canonicalizeMapping(mapping: CsvColumnMapping | undefined): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(mapping ?? {}).sort(([left], [right]) => left.localeCompare(right))
    )
  );
}

export function digestImportBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class ImportPreviewRegistry {
  private readonly previews = new Map<string, StoredImportPreview>();

  constructor(
    private readonly options: {
      ttlMs?: number;
      maxEntries?: number;
      now?: () => number;
    } = {}
  ) {}

  create(context: ImportPreviewContext): string {
    const now = this.now();
    this.removeExpired(now);

    while (this.previews.size >= this.maxEntries()) {
      const oldestPreviewId = this.previews.keys().next().value as string | undefined;
      if (oldestPreviewId === undefined) break;
      this.previews.delete(oldestPreviewId);
    }

    const previewId = randomUUID();
    this.previews.set(previewId, {
      ...context,
      filePath: canonicalizeFilePath(context.filePath),
      previewId,
      createdAtMs: now,
      expiresAtMs: now + this.ttlMs(),
      claimed: false,
    });
    return previewId;
  }

  claim(previewId: string, context: ImportPreviewContext): void {
    const preview = this.previews.get(previewId);
    if (preview === undefined) {
      throw new ImportPreviewError("PREVIEW_NOT_FOUND", "Preview receipt was not found.");
    }

    const now = this.now();
    if (preview.expiresAtMs <= now) {
      this.previews.delete(previewId);
      throw new ImportPreviewError("PREVIEW_EXPIRED", "Preview receipt has expired.");
    }
    if (preview.claimed) {
      throw new ImportPreviewError("PREVIEW_IN_USE", "Preview receipt is already being used.");
    }
    if (preview.fileDigest !== context.fileDigest) {
      throw new ImportPreviewError("PREVIEW_STALE", "The file changed after preview.");
    }
    if (
      preview.format !== context.format ||
      preview.filePath !== canonicalizeFilePath(context.filePath) ||
      preview.householdId !== context.householdId ||
      preview.accountId !== context.accountId ||
      canonicalizeMapping(preview.columnMapping) !== canonicalizeMapping(context.columnMapping)
    ) {
      throw new ImportPreviewError("PREVIEW_CONTEXT_MISMATCH", "The import context changed after preview.");
    }

    preview.claimed = true;
  }

  complete(previewId: string): void {
    this.previews.delete(previewId);
  }

  release(previewId: string): void {
    const preview = this.previews.get(previewId);
    if (preview !== undefined) {
      preview.claimed = false;
    }
  }

  invalidateAll(): void {
    this.previews.clear();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private ttlMs(): number {
    return this.options.ttlMs ?? 5 * 60 * 1000;
  }

  private maxEntries(): number {
    return this.options.maxEntries ?? 32;
  }

  private removeExpired(now: number): void {
    for (const [previewId, preview] of this.previews) {
      if (preview.expiresAtMs <= now) {
        this.previews.delete(previewId);
      }
    }
  }
}