import { _electron as electron } from "@playwright/test";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { CategoryTargetPage } from "./pom/CategoryTargetPage.js";
import { DashboardTargetPage } from "./pom/DashboardTargetPage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");
const RESTART_TARGET_CATEGORY_ID = "restart-target";
const INITIAL_TARGET_NOK = "725";
const UPDATED_TARGET_NOK = "900";

function persistedTargetRow(categoryId: string, targetNok: string): RegExp {
  return new RegExp(`${categoryId}:\\s*${targetNok},00\\s*kr`);
}

test.describe("Category target persistence across application restart", () => {
  test("saved target remains visible after launching a new Electron process", async ({
    categoryTarget,
    databasePath,
    electronApp,
  }) => {
    await categoryTarget.categoryIdInput.fill(RESTART_TARGET_CATEGORY_ID);
    await categoryTarget.targetAmountInput.fill(INITIAL_TARGET_NOK);
    await categoryTarget.saveButton.click();
    await expect(categoryTarget.savedTargetItem(RESTART_TARGET_CATEGORY_ID)).toHaveText(
      persistedTargetRow(RESTART_TARGET_CATEGORY_ID, INITIAL_TARGET_NOK),
    );

    await electronApp.close();

    const restartedApp = await electron.launch({
      args: [MAIN_ENTRY],
      env: {
        ...process.env,
        NODE_ENV: "test",
        BUDGET_DB_PATH: databasePath,
      },
    });

    try {
      const restartedWindow = await restartedApp.firstWindow();
      await restartedWindow.waitForLoadState("domcontentloaded");
      const restartedCategoryTarget = new CategoryTargetPage(restartedWindow);

      await expect(restartedCategoryTarget.savedTargetItem(RESTART_TARGET_CATEGORY_ID)).toHaveText(
        persistedTargetRow(RESTART_TARGET_CATEGORY_ID, INITIAL_TARGET_NOK),
      );
    } finally {
      await restartedApp.close();
    }
  });

  test("updated target feeds the dashboard after a new Electron process starts", async ({
    categoryTarget,
    databasePath,
    electronApp,
  }) => {
    await categoryTarget.categoryIdInput.fill(RESTART_TARGET_CATEGORY_ID);
    await categoryTarget.targetAmountInput.fill(INITIAL_TARGET_NOK);
    await categoryTarget.saveButton.click();
    await expect(categoryTarget.savedTargetItem(RESTART_TARGET_CATEGORY_ID)).toHaveText(
      persistedTargetRow(RESTART_TARGET_CATEGORY_ID, INITIAL_TARGET_NOK),
    );

    await categoryTarget.categoryIdInput.fill(RESTART_TARGET_CATEGORY_ID);
    await categoryTarget.targetAmountInput.fill(UPDATED_TARGET_NOK);
    await categoryTarget.saveButton.click();
    await expect(categoryTarget.savedTargetItem(RESTART_TARGET_CATEGORY_ID)).toHaveText(
      persistedTargetRow(RESTART_TARGET_CATEGORY_ID, UPDATED_TARGET_NOK),
    );

    await electronApp.close();

    const restartedApp = await electron.launch({
      args: [MAIN_ENTRY],
      env: {
        ...process.env,
        NODE_ENV: "test",
        BUDGET_DB_PATH: databasePath,
      },
    });

    try {
      const restartedWindow = await restartedApp.firstWindow();
      await restartedWindow.waitForLoadState("domcontentloaded");
      const restartedCategoryTarget = new CategoryTargetPage(restartedWindow);
      const restartedDashboardTarget = new DashboardTargetPage(restartedWindow);

      await expect(restartedCategoryTarget.savedTargetItem(RESTART_TARGET_CATEGORY_ID)).toHaveText(
        persistedTargetRow(RESTART_TARGET_CATEGORY_ID, UPDATED_TARGET_NOK),
      );
      await expect(restartedDashboardTarget.targetCell(RESTART_TARGET_CATEGORY_ID)).toHaveText(
        /900,00\s*kr/,
      );
      await expect(restartedDashboardTarget.actualCell(RESTART_TARGET_CATEGORY_ID)).toHaveText(
        /0,00\s*kr/,
      );
      await expect(restartedDashboardTarget.deltaCell(RESTART_TARGET_CATEGORY_ID)).toHaveText(
        /(?:-|\u2212)900,00\s*kr/,
      );
    } finally {
      await restartedApp.close();
    }
  });
});
