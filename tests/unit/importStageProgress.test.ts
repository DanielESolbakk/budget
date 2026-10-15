import { describe, expect, it } from "vitest";
import { getImportPendingMessage } from "../../src/renderer/import/ImportStageProgress.js";

describe("getImportPendingMessage", () => {
  it("distinguishes preflight validation from transaction persistence", () => {
    expect(getImportPendingMessage("map-and-validate")).toBe("Checking the file...");
    expect(getImportPendingMessage("confirm")).toBe("Importing transactions...");
  });
});