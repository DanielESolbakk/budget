import { describe, expect, it } from "vitest";
import { runDefaultLocalWorkflow } from "../../src/app/runDefaultLocalWorkflow.js";

describe("local workflow pure contract", () => {
  it("returns normalized merchant output for local-only workflow", () => {
    const output = runDefaultLocalWorkflow({ merchantRaw: " Kiwi  ASA " });
    expect(output.normalizedMerchant).toBe("KIWI");
  });
});