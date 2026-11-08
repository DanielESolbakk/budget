import { execFileSync } from "node:child_process";
import { join } from "node:path";

export function buildArtifactTestInputs(projectRoot = process.cwd()): void {
  execFileSync(process.execPath, [
    join(projectRoot, "node_modules", "electron-vite", "bin", "electron-vite.js"), "build",
  ], { cwd: projectRoot, stdio: "inherit" });
}

export default function setupArtifactTests(): void {
  buildArtifactTestInputs();
}
