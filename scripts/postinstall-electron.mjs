/**
 * postinstall-electron.mjs
 *
 * Works around a known Windows bug in extract-zip@2.0.1 (used by the electron
 * npm package) where subdirectory entries in the electron zip are silently
 * skipped, leaving only the first root-level file in dist/.
 *
 * This script runs after `npm install` on all platforms. On platforms where
 * the electron binary is already present it exits immediately. On Windows,
 * when the binary is missing, it re-extracts using PowerShell's
 * Expand-Archive which handles the zip correctly on all Windows versions.
 *
 * CI: set ELECTRON_SKIP_BINARY_DOWNLOAD=1 before `npm install` to skip the
 * electron binary download entirely. Vitest tests do not need the binary.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const electronDir = join(__dirname, "..", "node_modules", "electron");
const distDir = join(electronDir, "dist");
const pathTxt = join(electronDir, "path.txt");

const PLATFORM_EXE = {
  win32: "electron.exe",
  darwin: "Electron.app/Contents/MacOS/Electron",
  linux: "electron",
};

const exeName = PLATFORM_EXE[platform()] ?? "electron";
const binaryPath = join(distDir, exeName);

// Already installed — nothing to do.
if (existsSync(binaryPath) && existsSync(pathTxt)) {
  process.exit(0);
}

// Read the electron version from its own package.json.
const electronPkg = JSON.parse(
  readFileSync(join(electronDir, "package.json"), "utf8")
);
const version = electronPkg.version;

// Locate the cached zip written by @electron/get.
const cacheRoot =
  process.env.electron_config_cache ??
  join(
    process.env.LOCALAPPDATA ?? join(process.env.HOME ?? "~", ".cache"),
    "electron",
    "Cache"
  );

let zipPath = null;
try {
  for (const hash of readdirSync(cacheRoot)) {
    const candidate = join(
      cacheRoot,
      hash,
      `electron-v${version}-${platform() === "win32" ? "win32" : platform()}-x64.zip`
    );
    if (existsSync(candidate)) {
      zipPath = candidate;
      break;
    }
  }
} catch {
  // cache dir not found — non-fatal
}

if (!zipPath) {
  console.warn(
    "[postinstall-electron] Electron binary missing and no cached zip found.\n" +
      "Run: node node_modules/electron/install.js\n" +
      "Or delete node_modules/electron and run npm install again."
  );
  process.exit(0); // non-fatal — CI sets ELECTRON_SKIP_BINARY_DOWNLOAD
}

console.log(`[postinstall-electron] Re-extracting electron binary from cache`);

if (platform() === "win32") {
  // PowerShell Expand-Archive handles Windows zip subdirectory entries correctly.
  mkdirSync(distDir, { recursive: true });
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${distDir}'`,
    ],
    { stdio: "inherit" }
  );
  if (result.status !== 0) {
    console.error("[postinstall-electron] Extraction failed.");
    process.exit(1);
  }
} else {
  // On macOS/Linux extract-zip works correctly; re-run electron's own install.
  const { execSync } = await import("node:child_process");
  execSync("node install.js", { cwd: electronDir, stdio: "inherit" });
  process.exit(0); // install.js writes path.txt itself on non-Windows
}

await writeFile(pathTxt, exeName, "utf8");
console.log(`[postinstall-electron] Electron binary ready.`);
