import { expect, test } from "@playwright/test";
import { CategoryTargetPage } from "./pom/CategoryTargetPage.js";
import { DashboardTargetPage } from "./pom/DashboardTargetPage.js";

function linearizeColorChannel(channel: string | undefined): number {
  if (channel === undefined) {
    throw new Error("Expected an RGB color channel.");
  }

  const normalized = Number(channel) / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
  const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3);
  if (channels === undefined || channels.length !== 3) {
    throw new Error(`Expected an RGB color, received "${color}".`);
  }

  const red = linearizeColorChannel(channels[0]);
  const green = linearizeColorChannel(channels[1]);
  const blue = linearizeColorChannel(channels[2]);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

test("browser-preview notice text meets WCAG AA contrast on its dark header", async ({
  page,
}) => {
  await page.goto("/");

  const notice = page.getByRole("status").filter({ hasText: "Browser preview" });
  await expect(notice).toBeVisible();

  const textColors = await notice.evaluate((element) => {
    const backgroundColor = window.getComputedStyle(element).backgroundColor;
    return Array.from(element.querySelectorAll("strong, span"), (text) => ({
      foregroundColor: window.getComputedStyle(text).color,
      backgroundColor,
    }));
  });

  expect(textColors).toHaveLength(2);
  for (const { foregroundColor, backgroundColor } of textColors) {
    expect(contrastRatio(foregroundColor, backgroundColor)).toBeGreaterThanOrEqual(4.5);
  }
});

test("synthetic preview target edits refresh comparisons and monthly checks", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-05-15T12:00:00Z"));
  await page.goto("/");

  const targets = new CategoryTargetPage(page);
  const comparison = new DashboardTargetPage(page);
  await expect(page.getByLabel("Active reporting range"))
    .toHaveText("1 May 2026 - 31 May 2026");
  await page.getByText("Manage category targets", { exact: true }).click();
  await targets.addTargetButton.click();
  await targets.categorySelect.selectOption("groceries");
  await targets.targetAmountInput.fill("6000");
  await targets.saveButton.click();

  await expect(targets.savedTargetItem("groceries")).toContainText(/6\s*000,00/);
  await expect(comparison.targetCell("groceries")).toHaveText(/6\s*000,00/);
  await expect(comparison.deltaCell("groceries")).toContainText("over target");
  await expect(page.getByRole("link", { name: "Review 1 category over target" })).toBeVisible();

  await targets.editTargetButton("groceries").click();
  await targets.targetAmountInput.fill("7500");
  await targets.saveButton.click();

  await expect(comparison.targetCell("groceries")).toHaveText(/7\s*500,00/);
  await expect(comparison.deltaCell("groceries")).toContainText("under target");
  await expect(page.getByRole("link", { name: "Review 1 category over target" })).toHaveCount(0);
});
