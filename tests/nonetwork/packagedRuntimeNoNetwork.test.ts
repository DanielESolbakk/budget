import { afterEach, describe, expect, it } from "vitest";
import { createPerformanceHarness } from "../../src/tooling/performance/createPerformanceHarness.js";
import { validatePackagedRuntime } from "../../src/tooling/runtime/validatePackagedRuntime.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";

describe("packaged runtime and harness no-network verification", () => {
  const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;

  afterEach(() => {
    (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
  });

  it("AC-3: keeps packaged validation and benchmark harness local-only by default", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const harnessResult = createPerformanceHarness({ fixturePath: FIXTURE_PATH, iterationCount: 2 });
    const runtimeResult = validatePackagedRuntime({ projectRoot: process.cwd() });

    expect(harnessResult.metrics.roundTripStable).toBe(true);
    expect(runtimeResult.noNetworkByDefault).toBe(true);
    expect(fetchCalled).toBe(false);
  });
});
