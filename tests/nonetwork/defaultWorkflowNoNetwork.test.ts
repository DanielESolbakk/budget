import { afterEach, describe, expect, it } from "vitest";
import { runDefaultLocalWorkflow } from "../../src/app/runDefaultLocalWorkflow.js";

describe("default workflow no-network verification", () => {
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;

  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
  });

  it("does not invoke fetch in default local workflow", () => {
    let fetchCalled = false;
    (globalThis as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const output = runDefaultLocalWorkflow({ merchantRaw: " Vy " });
    expect(output.normalizedMerchant).toBe("VY");
    expect(fetchCalled).toBe(false);
  });
});