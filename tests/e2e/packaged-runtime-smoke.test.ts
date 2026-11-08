import { describe, expect, it } from "vitest";
import { validatePackagedRuntime } from "../../src/tooling/runtime/validatePackagedRuntime.js";

describe("built-artifact static contract (not native startup)", () => {
  it("AC-2: reports expected shell markers in freshly built artifacts", () => {
    const result = validatePackagedRuntime({
      projectRoot: process.cwd(),
      requireBuiltArtifacts: true,
    });

    expect(result.runtimeMode).toBe("built-artifacts");
    expect(result.startupReadiness.status).toBe("ready");
    expect(result.baselineShell).toEqual({
      status: "ready",
      title: "Budget Planner",
      rootElementPresent: true,
    });
    expect(result.noNetworkByDefault).toBe(true);
  });
});
