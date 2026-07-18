import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export const PACKAGED_RUNTIME_CONTRACT_VERSION = 1 as const;

export interface PackagedRuntimeValidationOptions {
  projectRoot?: string;
  requireBuiltArtifacts?: boolean;
}

export interface PackagedRuntimeValidationResult {
  contractVersion: typeof PACKAGED_RUNTIME_CONTRACT_VERSION;
  runtimeMode: "built-artifacts" | "source-layout";
  inspectedPaths: {
    mainEntry: string;
    preloadEntry: string;
    rendererEntry: string;
  };
  startupReadiness: {
    status: "ready" | "not-ready";
    checks: {
      mainEntryPresent: boolean;
      preloadEntryPresent: boolean;
      rendererEntryPresent: boolean;
      networkGuardInstalled: boolean;
      browserWindowConfigured: boolean;
      preloadBridgeExposed: boolean;
      dashboardBridgeAvailable: boolean;
    };
    missing: string[];
  };
  baselineShell: {
    status: "ready" | "not-ready";
    title: string | null;
    rootElementPresent: boolean;
  };
  noNetworkByDefault: boolean;
}

interface ValidationTargets {
  runtimeMode: "built-artifacts" | "source-layout";
  mainEntry: string;
  preloadEntry: string;
  rendererEntry: string;
}

function toPortableRelativePath(projectRoot: string, filePath: string): string {
  return relative(projectRoot, filePath).split(sep).join("/");
}

function resolveValidationTargets(projectRoot: string, requireBuiltArtifacts: boolean): ValidationTargets {
  const builtTargets = {
    runtimeMode: "built-artifacts" as const,
    mainEntry: resolve(projectRoot, "out/main/index.js"),
    preloadEntry: resolve(projectRoot, "out/preload/index.cjs"),
    rendererEntry: resolve(projectRoot, "out/renderer/index.html"),
  };

  const builtArtifactsPresent = [
    builtTargets.mainEntry,
    builtTargets.preloadEntry,
    builtTargets.rendererEntry,
  ].every((path) => existsSync(path));

  if (requireBuiltArtifacts || builtArtifactsPresent) {
    return builtTargets;
  }

  return {
    runtimeMode: "source-layout",
    mainEntry: resolve(projectRoot, "electron/main.ts"),
    preloadEntry: resolve(projectRoot, "src/renderer/preload.ts"),
    rendererEntry: resolve(projectRoot, "src/renderer/index.html"),
  };
}

function readTextIfPresent(filePath: string): string {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match?.[1]?.trim() || null;
}

function hasPattern(source: string, pattern: RegExp): boolean {
  return pattern.test(source);
}

export function validatePackagedRuntime(
  options: PackagedRuntimeValidationOptions = {}
): PackagedRuntimeValidationResult {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const targets = resolveValidationTargets(projectRoot, options.requireBuiltArtifacts ?? false);
  const mainSource = readTextIfPresent(targets.mainEntry);
  const preloadSource = readTextIfPresent(targets.preloadEntry);
  const rendererSource = readTextIfPresent(targets.rendererEntry);

  const checks = {
    mainEntryPresent: mainSource.length > 0,
    preloadEntryPresent: preloadSource.length > 0,
    rendererEntryPresent: rendererSource.length > 0,
    networkGuardInstalled: hasPattern(
      mainSource,
      /installNetworkGuard\(\s*session\.defaultSession\s*\)/
    ),
    browserWindowConfigured: hasPattern(mainSource, /new\s+BrowserWindow\s*\(/) &&
      hasPattern(mainSource, /preload\s*:\s*[\s\S]*?preload\/index\.(?:cjs|js|ts)/) &&
      hasPattern(mainSource, /loadFile\(\s*[\s\S]*?renderer\/index\.html/),
    preloadBridgeExposed: hasPattern(
      preloadSource,
      /contextBridge\.exposeInMainWorld\(\s*["']budgetApi["']\s*,/
    ),
    dashboardBridgeAvailable: hasPattern(
      preloadSource,
      /ipcRenderer\.invoke\(\s*["']dashboard:getData["']/
    ),
  };

  const missing: string[] = [];
  if (!checks.mainEntryPresent) missing.push("main-entry");
  if (!checks.preloadEntryPresent) missing.push("preload-entry");
  if (!checks.rendererEntryPresent) missing.push("renderer-entry");
  if (!checks.networkGuardInstalled) missing.push("network-guard");
  if (!checks.browserWindowConfigured) missing.push("browser-window");
  if (!checks.preloadBridgeExposed) missing.push("preload-bridge");
  if (!checks.dashboardBridgeAvailable) missing.push("dashboard-bridge");

  const title = extractTitle(rendererSource);
  const rootElementPresent = rendererSource.includes('<div id="root"></div>');

  return {
    contractVersion: PACKAGED_RUNTIME_CONTRACT_VERSION,
    runtimeMode: targets.runtimeMode,
    inspectedPaths: {
      mainEntry: toPortableRelativePath(projectRoot, targets.mainEntry),
      preloadEntry: toPortableRelativePath(projectRoot, targets.preloadEntry),
      rendererEntry: toPortableRelativePath(projectRoot, targets.rendererEntry),
    },
    startupReadiness: {
      status: missing.length === 0 ? "ready" : "not-ready",
      checks,
      missing,
    },
    baselineShell: {
      status: title !== null && rootElementPresent ? "ready" : "not-ready",
      title,
      rootElementPresent,
    },
    noNetworkByDefault: checks.networkGuardInstalled,
  };
}
