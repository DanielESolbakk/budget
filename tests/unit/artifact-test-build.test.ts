import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildArtifactTestInputs } from "../helpers/buildArtifactTestInputs.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
const directories: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("artifact test build boundary", () => {
  it("rebuilds even when stale artifacts exist, using the current project inputs", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "budget-artifact-build-"));
    directories.push(projectRoot);
    const artifacts = [
      join(projectRoot, "out", "main", "index.js"),
      join(projectRoot, "out", "preload", "index.cjs"),
      join(projectRoot, "out", "renderer", "index.html"),
    ];
    for (const directory of ["main", "preload", "renderer"]) mkdirSync(join(projectRoot, "out", directory), { recursive: true });
    for (const artifact of artifacts) writeFileSync(artifact, "old source");
    vi.mocked(execFileSync).mockImplementation(() => {
      for (const artifact of artifacts) writeFileSync(artifact, "current source");
      return Buffer.from("");
    });
    buildArtifactTestInputs(projectRoot);
    expect(execFileSync).toHaveBeenCalledExactlyOnceWith(process.execPath, [
      join(projectRoot, "node_modules", "electron-vite", "bin", "electron-vite.js"), "build",
    ], { cwd: projectRoot, stdio: "inherit" });
    for (const artifact of artifacts) expect(readFileSync(artifact, "utf8")).toBe("current source");
  });
  it("propagates an interrupted build rather than allowing stale-artifact success", () => {
    const failure = new Error("synthetic build failure");
    vi.mocked(execFileSync).mockImplementation(() => { throw failure; });
    expect(() => buildArtifactTestInputs()).toThrow(failure);
  });
});
