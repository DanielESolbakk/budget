import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { validatePackagedRuntime } from "../../src/tooling/runtime/validatePackagedRuntime.js";
import { readStylesheetGraph, stylesheetStructure } from "../helpers/stylesheets.js";

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

  it("ships every imported stylesheet in the source cascade order", () => {
    const rendererDirectory = resolve("out", "renderer");
    const html = readFileSync(resolve(rendererDirectory, "index.html"), "utf8");
    const stylesheets = Array.from(html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g));
    expect(stylesheets).toHaveLength(1);
    const builtPath = resolve(rendererDirectory, stylesheets[0]![1]!);
    const built = postcss.parse(readFileSync(builtPath, "utf8"), { from: builtPath });
    const { root } = readStylesheetGraph(resolve("src", "renderer", "app.css"));
    expect(stylesheetStructure(built)).toBe(stylesheetStructure(root));
  });
});
