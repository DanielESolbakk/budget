import { _electron as electron } from "@playwright/test";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

test.describe("account statement coverage and checkpoints", () => {
  test("exposes statement source type and optional local import provenance", async ({ window }) => {
    const coverage = window.getByRole("region", { name: "Account statement coverage" });
    await expect(coverage.getByLabel("Coverage source type")).toHaveValue("manual");
    await coverage.getByLabel("Coverage source type").selectOption("csv");
    await expect(coverage.getByLabel("Coverage import job")).toBeVisible();
  });

  test("keeps an empty unconfirmed period unknown until the user confirms it", async ({ window }) => {
    const coverage = window.getByRole("region", { name: "Account statement coverage" });
    await expect(coverage).toBeVisible();
    await coverage.getByLabel("Coverage account").selectOption("sample-acc");
    await coverage.getByLabel("Statement start date").fill("2026-03-01");
    await coverage.getByLabel("Statement end date").fill("2026-03-31");
    await coverage.getByLabel("Statement source").fill("Synthetic March statement");
    await coverage.getByRole("button", { name: "Save statement period" }).click();

    const period = coverage.getByRole("group", { name: "Coverage period 2026-03-01 to 2026-03-31" });
    await expect(period).toContainText("Unknown");
    await expect(period).toContainText("No booked transactions in this period");
    await expect(period).not.toContainText("Missing statement");

    await period.getByRole("button", { name: "Confirm coverage" }).click();
    await expect(period).toContainText("Coverage confirmed");
  });

  test("shows the exact checkpoint difference and keeps history reachable on compact windows", async ({
    window,
  }) => {
    await window.setViewportSize({ width: 1280, height: 800 });
    const coverage = window.getByRole("region", { name: "Account statement coverage" });
    await coverage.getByLabel("Coverage account").selectOption("sample-acc");
    await coverage.getByLabel("Statement start date").fill("2026-03-01");
    await coverage.getByLabel("Statement end date").fill("2026-03-31");
    await coverage.getByLabel("Statement source").fill("Synthetic March statement");
    await coverage.getByRole("button", { name: "Save statement period" }).click();
    const period = coverage.getByRole("group", { name: "Coverage period 2026-03-01 to 2026-03-31" });
    await period.getByRole("button", { name: "Confirm coverage" }).click();

    await coverage.getByLabel("Checkpoint date").fill("2026-03-01");
    await coverage.getByLabel("Checkpoint balance").fill("1000.00");
    await coverage.getByLabel("Checkpoint source").fill("Synthetic opening balance");
    await coverage.getByRole("button", { name: "Save balance checkpoint" }).click();

    await coverage.getByLabel("Checkpoint date").fill("2026-03-31");
    await coverage.getByLabel("Checkpoint balance").fill("1005.00");
    await coverage.getByLabel("Checkpoint source").fill("Synthetic closing balance");
    await coverage.getByRole("button", { name: "Save balance checkpoint" }).click();
    await expect(period).toContainText(/Difference.*5,00/);
    await expect(period.getByRole("list", { name: "Balance checkpoint history" })).toHaveCount(1);

    await window.setViewportSize({ width: 390, height: 844 });
    await expect(period.getByRole("list", { name: "Balance checkpoint history" })).toBeVisible();
    const horizontalOverflow = await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBe(false);
  });

  test("retains confirmed coverage and checkpoint history after an application relaunch", async ({
    databasePath,
    electronApp,
    window,
  }) => {
    const coverage = window.getByRole("region", { name: "Account statement coverage" });
    await coverage.getByLabel("Coverage account").selectOption("sample-acc");
    await coverage.getByLabel("Statement start date").fill("2026-03-01");
    await coverage.getByLabel("Statement end date").fill("2026-03-31");
    await coverage.getByLabel("Statement source").fill("Synthetic relaunch statement");
    await coverage.getByRole("button", { name: "Save statement period" }).click();
    const period = coverage.getByRole("group", { name: "Coverage period 2026-03-01 to 2026-03-31" });
    await period.getByRole("button", { name: "Confirm coverage" }).click();

    await coverage.getByLabel("Checkpoint date").fill("2026-03-01");
    await coverage.getByLabel("Checkpoint balance").fill("1000.00");
    await coverage.getByLabel("Checkpoint source").fill("Synthetic opening balance");
    await coverage.getByRole("button", { name: "Save balance checkpoint" }).click();
    await coverage.getByLabel("Checkpoint date").fill("2026-03-31");
    await coverage.getByLabel("Checkpoint balance").fill("1005.00");
    await coverage.getByLabel("Checkpoint source").fill("Synthetic closing balance");
    await coverage.getByRole("button", { name: "Save balance checkpoint" }).click();
    await expect(period).toContainText(/Difference.*5,00/);

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
      const restartedCoverage = restartedWindow.getByRole("region", {
        name: "Account statement coverage",
      });
      const restartedPeriod = restartedCoverage.getByRole("group", {
        name: "Coverage period 2026-03-01 to 2026-03-31",
      });

      await expect(restartedPeriod).toContainText("Coverage confirmed");
      await expect(restartedPeriod).toContainText("Synthetic relaunch statement");
      await expect(restartedPeriod).toContainText(/Difference.*5,00/);
      await expect(restartedPeriod.getByRole("list", { name: "Balance checkpoint history" }))
        .toContainText("Synthetic opening balance");
      await expect(restartedPeriod.getByRole("list", { name: "Balance checkpoint history" }))
        .toContainText("Synthetic closing balance");
    } finally {
      await restartedApp.close();
    }
  });
});
