import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { join } from "node:path";
import { DashboardTargetPage } from "./pom/DashboardTargetPage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");
const DEFAULT_YEAR_MONTH = "2026-05";
const nokCurrencyFormatter = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMinor(minor: number): string {
  return nokCurrencyFormatter.format(minor / 100);
}

async function setDashboardTargetViewHandler(
  app: ElectronApplication,
  targetMinor: number
): Promise<void> {
  await app.evaluate(
    async ({ ipcMain }, nextTargetMinor) => {
      ipcMain.removeHandler("dashboard:getViewData");
      ipcMain.handle("dashboard:getViewData", async (_event, yearMonth: string) => ({
        state: "ready",
        snapshot: {
          selectedYearMonth: yearMonth,
          monthlyTotals: {
            yearMonth,
            incomeMinor: 54000,
            expenseMinor: 8500,
            netMinor: 45500,
          },
          categoryBreakdown: {
            yearMonth,
            entries: [
              {
                categoryId: "salary",
                label: "salary",
                totalMinor: 54000,
                transactionCount: 1,
              },
              {
                categoryId: "groceries",
                label: "groceries",
                totalMinor: 8500,
                transactionCount: 1,
              },
            ],
          },
          targetVsActualCategoryRows: {
            yearMonth,
            rows: [
              {
                categoryId: "groceries",
                targetMinor: nextTargetMinor,
                actualMinor: 8500,
                deltaMinor: 8500 - nextTargetMinor,
              },
              {
                categoryId: "salary",
                targetMinor: null,
                actualMinor: 54000,
                deltaMinor: null,
              },
            ],
          },
        },
      }));
    },
    targetMinor
  );
}

test.describe("Dashboard target-vs-actual renderer smoke", () => {
  let app: ElectronApplication | undefined;
  let window: Page;
  let targetPage: DashboardTargetPage;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: "test" },
    });
    window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    targetPage = new DashboardTargetPage(window);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("Scenario 1: target-vs-actual section renders target, actual, and delta values", async () => {
    await expect(targetPage.section).toBeVisible();
    await expect(targetPage.heading).toBeVisible();
    await expect(targetPage.table).toBeVisible();
    await expect(targetPage.targetColumn).toBeVisible();
    await expect(targetPage.actualColumn).toBeVisible();
    await expect(targetPage.deltaColumn).toBeVisible();

    await expect(targetPage.categoryCell("groceries")).toBeVisible();
    await expect(targetPage.targetCell("groceries")).toHaveText(formatMinor(9000));
    await expect(targetPage.actualCell("groceries")).toHaveText(formatMinor(8500));
    await expect(targetPage.deltaCell("groceries")).toHaveText(formatMinor(-500));
  });

  test("Scenario 3: categories without targets show the explicit no-target policy", async () => {
    await expect(targetPage.categoryRow("salary")).toBeVisible();
    await expect(targetPage.actualCell("salary")).toHaveText(formatMinor(54000));
    await expect(targetPage.targetCell("salary")).toHaveText("No target");
    await expect(targetPage.deltaCell("salary")).toHaveText("No target");
    await expect(targetPage.noTargetIndicators("salary")).toHaveCount(2);
  });
});

test.describe("Dashboard target-vs-actual renderer smoke — refresh path", () => {
  let app: ElectronApplication | undefined;
  let window: Page;
  let targetPage: DashboardTargetPage;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: "test" },
    });
    window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    targetPage = new DashboardTargetPage(window);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("Scenario 2: updating a target and refreshing reflects the latest saved values", async () => {
    if (!app) {
      throw new Error("Electron application did not launch.");
    }

    await setDashboardTargetViewHandler(app, 9000);
    await window.reload();
    await window.waitForLoadState("domcontentloaded");

    await expect(targetPage.section).toBeVisible();
    await expect(targetPage.targetCell("groceries")).toHaveText(formatMinor(9000));
    await expect(targetPage.deltaCell("groceries")).toHaveText(formatMinor(-500));

    await setDashboardTargetViewHandler(app, 9500);
    await window.reload();
    await window.waitForLoadState("domcontentloaded");

    await expect(targetPage.targetCell("groceries")).toHaveText(formatMinor(9500));
    await expect(targetPage.targetCell("groceries")).not.toHaveText(formatMinor(9000));
    await expect(targetPage.actualCell("groceries")).toHaveText(formatMinor(8500));
    await expect(targetPage.deltaCell("groceries")).toHaveText(formatMinor(-1000));
    await expect(targetPage.deltaCell("groceries")).not.toHaveText(formatMinor(-500));
    await expect(window.getByRole("combobox", { name: "Select month" })).toHaveValue(DEFAULT_YEAR_MONTH);
  });
});
