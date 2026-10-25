import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/electron.js";

async function saveSyntheticRate(window: Page): Promise<void> {
  const rates = window.getByRole("region", { name: "Exchange rates", exact: true });
  await rates.getByLabel("Rate NOK per 1 unit").fill("12.00");
  await rates.getByLabel("Rate effective date").fill("2026-05-01");
  await rates.getByLabel("Rate source").fill("Synthetic table rate");
  await rates.getByRole("button", { name: "Save local exchange rate" }).click();
  await expect(rates.getByRole("table", { name: "Saved local exchange rates" }))
    .toContainText("Synthetic table rate");
}

test.describe("exchange-rate settings layout", () => {
  test("separates rate entry from report controls until the report view is selected", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Settings");
    const rates = window.getByRole("region", { name: "Exchange rates", exact: true });
    const rateBookTab = rates.getByRole("button", { name: "Rate book", exact: true });
    const monthlyReportTab = rates.getByRole("button", { name: "Monthly report", exact: true });
    await expect(rateBookTab).toHaveAttribute("aria-pressed", "true");
    await expect(monthlyReportTab).toHaveAttribute("aria-pressed", "false");
    await expect(rates.getByLabel("Report month")).toBeHidden();

    await monthlyReportTab.click();
    await expect(rateBookTab).toHaveAttribute("aria-pressed", "false");
    await expect(rates.getByLabel("Report month")).toBeVisible();
  });

  test("presents saved local rates in a comparison table", async ({ appShell, window }) => {
    await appShell.openWorkspace("Settings");
    const rates = window.getByRole("region", { name: "Exchange rates", exact: true });
    await saveSyntheticRate(window);

    const savedRates = rates.getByRole("table", { name: "Saved local exchange rates" });
    const rateRow = savedRates.getByRole("row", { name: /EUR.*2026-05-01.*Synthetic table rate/ });
    await expect(rateRow).toBeVisible();
    await expect(savedRates.getByRole("columnheader", { name: "Currency" })).toBeVisible();
    await expect(savedRates.getByRole("columnheader", { name: "NOK per unit" })).toBeVisible();
    await expect(savedRates.getByRole("columnheader", { name: "Effective date" })).toBeVisible();
    await expect(savedRates.getByRole("columnheader", { name: "Source" })).toBeVisible();

    const savedMessage = rates.getByRole("status").filter({ hasText: "Local exchange rate saved." });
    await expect(savedMessage).toBeVisible();
    await rates.getByRole("button", { name: "Monthly report", exact: true }).click();
    await expect(savedMessage).toBeHidden();

    await window.setViewportSize({ width: 390, height: 844 });
    const horizontalOverflow = await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBe(false);
  });

  test("@visual Visual: saved local rates remain scannable at desktop and compact widths", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Settings");
    await saveSyntheticRate(window);
    const savedRates = window.getByRole("table", { name: "Saved local exchange rates" });
    await expect(savedRates).toBeVisible();

    await window.setViewportSize({ width: 1280, height: 800 });
    await expect(window).toHaveScreenshot("exchange-rates-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await window.setViewportSize({ width: 390, height: 844 });
    await expect(window).toHaveScreenshot("exchange-rates-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await window.getByRole("region", { name: "Exchange rates", exact: true })
      .getByRole("button", { name: "Monthly report", exact: true })
      .click();
    await window.setViewportSize({ width: 1280, height: 800 });
    await expect(window).toHaveScreenshot("exchange-report-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await window.setViewportSize({ width: 390, height: 844 });
    await expect(window).toHaveScreenshot("exchange-report-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  });
});
