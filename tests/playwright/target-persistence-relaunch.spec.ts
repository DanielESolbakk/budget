import { _electron as electron } from "@playwright/test";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { CategoryTargetPage } from "./pom/CategoryTargetPage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

test.describe("Category target persistence across application restart", () => {
  test("saved target remains visible after launching a new Electron process", async ({
    categoryTarget,
    databasePath,
  }) => {
    await categoryTarget.categoryIdInput.fill("restart-target");
    await categoryTarget.targetAmountInput.fill("725");
    await categoryTarget.saveButton.click();
    await expect(categoryTarget.savedTargetItem("restart-target")).toBeVisible();

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

      await expect(restartedCategoryTarget.savedTargetItem("restart-target")).toBeVisible();
    } finally {
      await restartedApp.close();
    }
  });
});