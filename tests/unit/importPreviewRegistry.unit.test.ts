import { describe, expect, it } from "vitest";
import {
  ImportPreviewError,
  ImportPreviewRegistry,
  digestImportBytes,
} from "../../src/app/import/importPreviewRegistry.js";

function context(fileDigest = digestImportBytes(Buffer.from("statement"))) {
  return {
    format: "csv" as const,
    filePath: "fixtures/statement.csv",
    fileDigest,
    householdId: "household",
    accountId: "account",
    columnMapping: { description: "Description" },
  };
}

describe("ImportPreviewRegistry", () => {
  it("claims a matching receipt once and removes it on completion", () => {
    const registry = new ImportPreviewRegistry();
    const previewId = registry.create(context());

    registry.claim(previewId, context());
    expect(() => registry.claim(previewId, context())).toThrowError(
      expect.objectContaining({ code: "PREVIEW_IN_USE" })
    );

    registry.complete(previewId);
    expect(() => registry.claim(previewId, context())).toThrowError(
      expect.objectContaining({ code: "PREVIEW_NOT_FOUND" })
    );
  });

  it("rejects changed bytes without claiming the receipt", () => {
    const registry = new ImportPreviewRegistry();
    const previewId = registry.create(context());

    expect(() => registry.claim(previewId, context(digestImportBytes(Buffer.from("changed"))))).toThrowError(
      expect.objectContaining({ code: "PREVIEW_STALE" })
    );

    registry.claim(previewId, context());
  });

  it("expires receipts and evicts the oldest entry at capacity", () => {
    let now = 1000;
    const registry = new ImportPreviewRegistry({
      now: () => now,
      ttlMs: 10,
      maxEntries: 2,
    });
    const first = registry.create(context());
    now += 1;
    const second = registry.create({ ...context(), filePath: "fixtures/second.csv" });
    now += 1;
    const third = registry.create({ ...context(), filePath: "fixtures/third.csv" });

    expect(() => registry.claim(first, context())).toThrowError(
      expect.objectContaining({ code: "PREVIEW_NOT_FOUND" })
    );
    registry.claim(second, { ...context(), filePath: "fixtures/second.csv" });
    registry.claim(third, { ...context(), filePath: "fixtures/third.csv" });

    now += 10;
    expect(() => registry.claim(second, { ...context(), filePath: "fixtures/second.csv" })).toThrowError(
      expect.objectContaining({ code: "PREVIEW_EXPIRED" })
    );
  });

  it("invalidates all receipts after restore", () => {
    const registry = new ImportPreviewRegistry();
    const previewId = registry.create(context());

    registry.invalidateAll();

    expect(() => registry.claim(previewId, context())).toThrowError(
      expect.objectContaining({ code: "PREVIEW_NOT_FOUND" })
    );
  });

  it("exposes stable error instances for callers", () => {
    const registry = new ImportPreviewRegistry();
    expect(() => registry.claim("missing", context())).toThrow(ImportPreviewError);
  });
});