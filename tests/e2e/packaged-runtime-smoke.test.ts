import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { validatePackagedRuntime } from "../../src/tooling/runtime/validatePackagedRuntime.js";

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function ensureBuiltArtifacts(): void {
  const requiredPaths = [
    join(process.cwd(), "out/main/index.js"),
    join(process.cwd(), "out/preload/index.cjs"),
    join(process.cwd(), "out/renderer/index.html"),
  ];

  if (requiredPaths.every((filePath) => existsSync(filePath))) {
    return;
  }

  execFileSync(npmCommand(), ["run", "build"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

describe("packaged runtime smoke", () => {
  beforeAll(() => {
    ensureBuiltArtifacts();
  });

  it("AC-2: reports startup readiness for the packaged baseline shell", () => {
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
