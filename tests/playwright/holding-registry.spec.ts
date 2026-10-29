import { _electron as electron } from "@playwright/test";
import type { Page } from "@playwright/test";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import {
  installMainProcessNetworkProbe,
  mainProcessNetworkRequests,
} from "./helpers/networkProbe.js";
import {
  installRendererNetworkAttemptBlocker,
  installRendererNetworkAttemptObserver,
  rendererNetworkBlockedAttempts,
  rendererNetworkAttempts,
} from "./helpers/rendererNetworkProbe.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

function relativeLuminance(color: string): number {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (channels === undefined || channels.length !== 3) {
    throw new Error(`Unexpected RGB color: ${color}`);
  }
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

interface HoldingValuationForTest {
  id: string;
  holdingId: string;
  effectiveDateIso: string;
  amountMinor: number;
  currencyCode: string;
  recordedAtIso: string;
}

interface HoldingForTest {
  id: string;
  householdId: string;
  label: string;
  quantity: number;
  costBasisMinor: number;
  currencyCode: string;
  createdAtIso: string;
  valuations: HoldingValuationForTest[];
}

async function openInvestments(appShell: AppShellPage): Promise<void> {
  await appShell.openWorkspace("Investments");
}

function registry(page: Page) {
  return page.getByRole("region", { name: "Investment holdings registry", exact: true });
}

function holding(page: Page, label: string) {
  return registry(page).getByRole("region", { name: `Holding ${label}`, exact: true });
}

async function addHolding(
  page: Page,
  input: { label: string; quantity: string; costBasis: string; currencyCode: string }
): Promise<void> {
  const form = registry(page).getByRole("form", { name: "Add investment holding", exact: true });
  await form.getByLabel("Holding label", { exact: true }).fill(input.label);
  await form.getByLabel("Quantity", { exact: true }).fill(input.quantity);
  await form.getByLabel("Cost basis", { exact: true }).fill(input.costBasis);
  await form.getByLabel("Currency code", { exact: true }).fill(input.currencyCode);
  await form.getByRole("button", { name: "Save holding", exact: true }).click();
}

async function addValuation(
  page: Page,
  label: string,
  input: { effectiveDate: string; amount: string; currencyCode?: string }
): Promise<void> {
  const form = holding(page, label).getByRole("form", {
    name: `Add valuation for ${label}`,
    exact: true,
  });
  await form.getByLabel("Effective date", { exact: true }).fill(input.effectiveDate);
  await form.getByLabel("Amount", { exact: true }).fill(input.amount);
  if (input.currencyCode !== undefined) {
    await form.getByLabel("Currency code", { exact: true }).fill(input.currencyCode);
  }
  await form.getByRole("button", { name: "Save value", exact: true }).click();
}

async function listHoldings(page: Page): Promise<HoldingForTest[]> {
  return page.evaluate(() => (
    globalThis as typeof globalThis & {
      budgetApi: { holdingRegistry: { list: () => Promise<HoldingForTest[]> } };
    }
  ).budgetApi.holdingRegistry.list());
}

async function listEurRates(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (
    globalThis as typeof globalThis & {
      budgetApi: { exchangeRates: { list: (currencyCode: string) => Promise<unknown[]> } };
    }
  ).budgetApi.exchangeRates.list("EUR"));
}

test("holding labels and values remain legible on the household canvas", async ({
  appShell,
  window,
}) => {
  await window.setViewportSize({ width: 1280, height: 800 });
  await openInvestments(appShell);
  await addHolding(window, {
    label: "Global fund",
    quantity: "10",
    costBasis: "10000",
    currencyCode: "EUR",
  });
  await addValuation(window, "Global fund", {
    effectiveDate: "2026-10-01",
    amount: "11000",
  });

  const colors = await window.evaluate(() => {
    const workspace = document.querySelector('[aria-label="Investments workspace"]');
    const record = workspace?.querySelector(".holding-record");
    const heading = record?.querySelector("h3");
    const value = record?.querySelector(".holding-history-table-wrap td");
    if (workspace === null || heading === null || value === null || heading === undefined || value === undefined) {
      throw new Error("Holding text contrast elements are missing.");
    }
    return {
      background: getComputedStyle(workspace).backgroundColor,
      heading: getComputedStyle(heading).color,
      value: getComputedStyle(value).color,
    };
  });

  expect(contrastRatio(colors.heading, colors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.value, colors.background)).toBeGreaterThanOrEqual(4.5);
});

test("holding history survives restart without conversion or network requests", async ({
  appShell,
  databasePath,
  electronApp,
  window,
}) => {
  await window.setViewportSize({ width: 1280, height: 800 });
  await installRendererNetworkAttemptBlocker(window);
  const rendererNetworkObservation = await installRendererNetworkAttemptObserver(window);
  await installMainProcessNetworkProbe(electronApp);
  await openInvestments(appShell);
  await expect(registry(window)).toBeVisible();
  expect(await listEurRates(window)).toEqual([]);

  await addHolding(window, {
    label: "Global fund",
    quantity: "10",
    costBasis: "10000",
    currencyCode: "EUR",
  });
  await addValuation(window, "Global fund", {
    effectiveDate: "2026-10-01",
    amount: "11000",
  });
  await addValuation(window, "Global fund", {
    effectiveDate: "2026-11-01",
    amount: "11500",
  });

  const beforeRestart = await listHoldings(window);
  expect(beforeRestart).toHaveLength(1);
  expect(beforeRestart[0]).toMatchObject({
    label: "Global fund",
    quantity: 10,
    costBasisMinor: 1_000_000,
    currencyCode: "EUR",
    valuations: [
      {
        holdingId: beforeRestart[0]?.id,
        effectiveDateIso: "2026-10-01",
        amountMinor: 1_100_000,
        currencyCode: "EUR",
      },
      {
        holdingId: beforeRestart[0]?.id,
        effectiveDateIso: "2026-11-01",
        amountMinor: 1_150_000,
        currencyCode: "EUR",
      },
    ],
  });
  await expect(holding(window, "Global fund")).toContainText("EUR");
  await expect(
    holding(window, "Global fund")
      .getByRole("table", { name: "Valuation history", exact: true })
      .getByRole("row")
  ).toHaveCount(3);
  for (const valuation of beforeRestart[0]!.valuations) {
    const row = holding(window, "Global fund")
      .getByRole("table", { name: "Valuation history", exact: true })
      .getByRole("row")
      .filter({ hasText: valuation.effectiveDateIso });
    await expect(row.getByRole("cell").nth(0)).toContainText(valuation.effectiveDateIso);
    await expect(row.getByRole("cell").nth(1)).toContainText(valuation.currencyCode);
    await expect(row.getByRole("cell").nth(2).locator("time"))
      .toHaveAttribute("datetime", valuation.recordedAtIso);
  }
  await window.setViewportSize({ width: 390, height: 844 });
  const mobileHistory = holding(window, "Global fund")
    .getByRole("table", { name: "Valuation history", exact: true });
  await expect(mobileHistory).toBeVisible();
  await expect(mobileHistory.getByRole("row").nth(1)).toContainText("EUR");
  expect(await window.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  )).toBe(false);
  await window.setViewportSize({ width: 1280, height: 800 });
  expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
  expect(await rendererNetworkAttempts(window)).toEqual([]);
  expect(await rendererNetworkBlockedAttempts(window)).toEqual([]);
  expect(rendererNetworkObservation.httpRequests).toEqual([]);
  expect(rendererNetworkObservation.webSocketRequests).toEqual([]);

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
    await installRendererNetworkAttemptBlocker(restartedWindow);
    const restartedNetworkObservation =
      await installRendererNetworkAttemptObserver(restartedWindow);
    await installMainProcessNetworkProbe(restartedApp);
    await openInvestments(new AppShellPage(restartedWindow));
    const afterRestart = await listHoldings(restartedWindow);

    expect(afterRestart).toEqual(beforeRestart);
    expect(await listEurRates(restartedWindow)).toEqual([]);
    const restartedHolding = holding(restartedWindow, "Global fund");
    await expect(restartedHolding.getByText("10", { exact: true })).toBeVisible();
    await expect(restartedHolding.getByText(/^EUR\s+10\s*000,00$/)).toBeVisible();
    for (const valuation of afterRestart[0]!.valuations) {
      const row = holding(restartedWindow, "Global fund")
        .getByRole("table", { name: "Valuation history", exact: true })
        .getByRole("row")
        .filter({ hasText: valuation.effectiveDateIso });
      await expect(row.getByRole("cell").nth(1)).toContainText("EUR");
      await expect(row.getByRole("cell").nth(1)).toContainText(
        valuation.effectiveDateIso === "2026-10-01" ? /11\s*000,00/ : /11\s*500,00/
      );
      await expect(row.getByRole("cell").nth(2).locator("time"))
        .toHaveAttribute("datetime", valuation.recordedAtIso);
    }
    expect(await mainProcessNetworkRequests(restartedApp)).toEqual([]);
    expect(await rendererNetworkAttempts(restartedWindow)).toEqual([]);
    expect(await rendererNetworkBlockedAttempts(restartedWindow)).toEqual([]);
    expect(restartedNetworkObservation.httpRequests).toEqual([]);
    expect(restartedNetworkObservation.webSocketRequests).toEqual([]);
  } finally {
    await restartedApp.close();
  }
});

test("holding errors are field-specific and keyboard entry works on desktop", async ({
  appShell,
  electronApp,
  window,
}) => {
  await window.setViewportSize({ width: 390, height: 844 });
  await installMainProcessNetworkProbe(electronApp);
  await openInvestments(appShell);

  const holdingForm = registry(window)
    .getByRole("form", { name: "Add investment holding", exact: true });
  const labelInput = holdingForm.getByLabel("Holding label", { exact: true });
  const quantityInput = holdingForm.getByLabel("Quantity", { exact: true });
  await holdingForm.getByLabel("Cost basis", { exact: true }).fill("10000");
  await holdingForm.getByLabel("Currency code", { exact: true }).fill("EUR");
  await labelInput.fill("");
  await quantityInput.fill("-1");
  await holdingForm.getByRole("button", { name: "Save holding", exact: true }).click();

  await expect(registry(window).getByText("Enter a holding label.", { exact: true })).toBeVisible();
  await expect(registry(window).getByText("Enter a positive quantity.", { exact: true })).toBeVisible();
  await expect(labelInput).toHaveAttribute("aria-invalid", "true");
  await expect(quantityInput).toHaveAttribute("aria-invalid", "true");
  await expect(registry(window).getByText("No investment holdings have been recorded.", {
    exact: true,
  })).toBeVisible();
  expect(await listHoldings(window)).toEqual([]);
  expect(await window.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  )).toBe(false);

  await window.setViewportSize({ width: 1280, height: 800 });
  await labelInput.focus();
  await window.keyboard.type("Global fund");
  await window.keyboard.press("Tab");
  await window.keyboard.type("10");
  await window.keyboard.press("Tab");
  await window.keyboard.type("10000");
  await window.keyboard.press("Tab");
  await window.keyboard.type("EUR");
  await window.keyboard.press("Enter");

  await expect(holding(window, "Global fund")).toBeVisible();
  await expect(holding(window, "Global fund")).toContainText("10");
  await expect(holding(window, "Global fund")).toContainText("EUR");
  await expect(holding(window, "Global fund").getByText("No values have been recorded.", {
    exact: true,
  })).toBeVisible();
  const valuationForm = holding(window, "Global fund").getByRole("form", {
    name: "Add valuation for Global fund",
    exact: true,
  });
  await valuationForm.getByLabel("Effective date", { exact: true }).fill("2026-11-01");
  const amountInput = valuationForm.getByLabel("Amount", { exact: true });
  await amountInput.fill("-1");
  await valuationForm.getByRole("button", { name: "Save value", exact: true }).click();
  await expect(registry(window).getByText(
    "Enter a non-negative value with up to two decimal places.",
    { exact: true }
  )).toBeVisible();
  await expect(amountInput).toHaveAttribute("aria-invalid", "true");
  await expect(holding(window, "Global fund").getByText("No values have been recorded.", {
    exact: true,
  })).toBeVisible();
  expect((await listHoldings(window))[0]?.valuations).toEqual([]);
  expect(await window.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  )).toBe(false);
  expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
});
