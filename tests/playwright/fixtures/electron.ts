import { test as base, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppShellPage } from "../pom/AppShellPage.js";
import { CategoryTargetPage } from "../pom/CategoryTargetPage.js";
import { CsvImportPage } from "../pom/CsvImportPage.js";
import { DashboardPage } from "../pom/DashboardPage.js";
import { DashboardTargetPage } from "../pom/DashboardTargetPage.js";
import { ForecastPage } from "../pom/ForecastPage.js";
import { ManualEntryPage } from "../pom/ManualEntryPage.js";
import { PdfImportPage } from "../pom/PdfImportPage.js";
import { PreloadBridgePage } from "../pom/PreloadBridgePage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

interface ElectronFixtures {
  electronApp: ElectronApplication;
  window: Page;
  appShell: AppShellPage;
  categoryTarget: CategoryTargetPage;
  csvImport: CsvImportPage;
  dashboard: DashboardPage;
  dashboardTarget: DashboardTargetPage;
  forecast: ForecastPage;
  manualEntry: ManualEntryPage;
  pdfImport: PdfImportPage;
  preloadBridge: PreloadBridgePage;
}

export const test = base.extend<ElectronFixtures>({
  // Playwright requires the first callback argument to be an object pattern.
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const databaseDirectory = mkdtempSync(join(tmpdir(), "budget-playwright-"));
    const databasePath = join(databaseDirectory, "budget.sqlite");
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({
        args: [MAIN_ENTRY],
        env: {
          ...process.env,
          NODE_ENV: "test",
          BUDGET_DB_PATH: databasePath,
        },
      });

      await use(app);
    } finally {
      try {
        await app?.close();
      } finally {
        rmSync(databaseDirectory, { recursive: true, force: true });
      }
    }
  },
  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await use(window);
  },
  appShell: async ({ window }, use) => {
    await use(new AppShellPage(window));
  },
  categoryTarget: async ({ window }, use) => {
    await use(new CategoryTargetPage(window));
  },
  csvImport: async ({ window }, use) => {
    await use(new CsvImportPage(window));
  },
  dashboard: async ({ window }, use) => {
    await use(new DashboardPage(window));
  },
  dashboardTarget: async ({ window }, use) => {
    await use(new DashboardTargetPage(window));
  },
  forecast: async ({ window }, use) => {
    await use(new ForecastPage(window));
  },
  manualEntry: async ({ window }, use) => {
    await use(new ManualEntryPage(window));
  },
  pdfImport: async ({ window }, use) => {
    await use(new PdfImportPage(window));
  },
  preloadBridge: async ({ window }, use) => {
    await use(new PreloadBridgePage(window));
  },
});

export { expect };
