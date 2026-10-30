import { test, expect } from "./fixtures/electron.js";
import type { WorkspaceName } from "./pom/AppShellPage.js";
import { PropertyRegistryPage } from "./pom/PropertyRegistryPage.js";
import { LoanRegistryPage } from "./pom/LoanRegistryPage.js";
import { _electron as electron, type ElectronApplication, type Locator } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppShellPage } from "./pom/AppShellPage.js";

async function fieldBoundaryContrast(field: Locator): Promise<number> {
  return field.evaluate((node) => {
    const style = getComputedStyle(node);
    function luminance(color: string): number {
      const values = color.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number);
      if (values === undefined || values.length !== 3) throw new Error(`Unsupported field color: ${color}`);
      const channels = values.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    }
    const border = luminance(style.borderTopColor);
    const background = luminance(style.backgroundColor);
    return (Math.max(border, background) + 0.05) / (Math.min(border, background) + 0.05);
  });
}

test("the header import action opens the import workspace from monthly review", async ({
  appShell,
  window,
}) => {
  await expect(appShell.workspace("Review")).toBeVisible();
  await appShell.banner.getByRole("button", { name: "Import statement", exact: true }).click();
  await expect(appShell.workspace("Import")).toBeVisible();
  await expect(window.getByRole("button", { name: "Choose statement file", exact: true })).toBeVisible();
  await expect(appShell.destination("Activity")).toHaveAttribute("aria-current", "page");
});

test("keyboard users can skip navigation to the active workspace", async ({
  appShell,
  window,
}) => {
  await expect(appShell.workspace("Review")).toBeVisible();
  await window.keyboard.press("Tab");
  const skipLink = window.getByRole("link", { name: "Skip to workspace" });
  await expect(skipLink).toBeFocused();
  await window.keyboard.press("Enter");
  await expect(window.getByRole("main")).toBeFocused();
});

test("shortcuts focus their destination while navigation preserves sibling keyboard access", async ({
  appShell,
  window,
}) => {
  await appShell.banner.getByRole("button", { name: "Import statement", exact: true }).click();
  await expect(appShell.workspace("Import").getByRole("heading", { name: "Import", exact: true })).toBeFocused();
  await appShell.openWorkspace("Transactions");
  const views = window.getByRole("navigation", { name: "Activity views" });
  await expect(views.getByRole("button", { name: "Transactions", exact: true })).toBeFocused();
  await expect(window.getByRole("status", { name: "Workspace destination" })).toHaveText("Transactions");
  await window.keyboard.press("Tab");
  await expect(views.getByRole("button", { name: "Pending", exact: true })).toBeFocused();
});

for (const width of [1440, 390]) {
  test(`monthly and ledger controls remain readable and distinct at ${width}px`, async ({
    appShell,
    dashboard,
    electronApp,
    ledger,
    window,
  }) => {
    await electronApp.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(width, 1000);
    }, width);
    await appShell.openWorkspace("Review");
    await expect(dashboard.monthlyAttention).toBeVisible();
    const monthlyText = dashboard.monthlyAttention.locator("h3, h4, p, a, button");
    const monthlySizes = await monthlyText.evaluateAll((nodes) =>
      nodes.map((node) => Number.parseFloat(getComputedStyle(node).fontSize)));
    expect(monthlySizes.length).toBeGreaterThan(0);
    expect.soft(Math.min(...monthlySizes), "monthly-check text must remain readable").toBeGreaterThanOrEqual(14);
    const monthLabel = window.locator('label[for="month-select"]');
    expect.soft(await monthLabel.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)))
      .toBeGreaterThanOrEqual(14);
    await appShell.openWorkspace("Transactions");
    const threshold = ledger.section.getByRole("button", { name: "Quick filter Large transactions, at least NOK 10,000" }).locator("small");
    await expect.poll(() => threshold.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)))
      .toBeGreaterThanOrEqual(14);
    await expect.poll(() => ledger.savedViewsSummary.evaluate((node) => node.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(24);
    expect.soft(await ledger.savedViewsSummary.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)))
      .toBeGreaterThanOrEqual(14);
    expect(await fieldBoundaryContrast(ledger.merchantInput)).toBeGreaterThanOrEqual(3);
    await ledger.savedViewsSummary.focus();
    await window.keyboard.press("Enter");
    await expect(ledger.savedViewNameInput).toBeVisible();
  });
}

test("household form boundaries remain identifiable on white surfaces", async ({ appShell, window }) => {
  await appShell.openWorkspace("Properties");
  const properties = new PropertyRegistryPage(window);
  await properties.addPropertyAction.click();
  await expect(properties.propertyLabelInput).toBeVisible();
  expect(await fieldBoundaryContrast(properties.propertyLabelInput)).toBeGreaterThanOrEqual(3);
});

test("monthly review and ledger remain usable at 200 percent zoom", async () => {
  const directory = mkdtempSync(join(tmpdir(), "budget-zoom-"));
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      args: [join(process.cwd(), "out", "main", "index.js"), `--user-data-dir=${join(directory, "profile")}`],
      env: { ...process.env, NODE_ENV: "test", BUDGET_DB_PATH: join(directory, "ledger.sqlite") },
    });
    const window = await application.firstWindow();
    const appShell = new AppShellPage(window);
    await expect(appShell.heading).toBeVisible();
    await application.evaluate(({ BrowserWindow }) => {
      const browser = BrowserWindow.getAllWindows()[0];
      if (browser === undefined) throw new Error("Electron window is unavailable.");
      browser.setContentSize(1440, 1000);
      browser.webContents.setZoomFactor(2);
    });
    for (const name of ["Review", "Transactions"] as const) {
      await appShell.openWorkspace(name);
      await expect(appShell.workspace(name)).toBeVisible();
      await expect.poll(() => window.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      )).toBeLessThanOrEqual(0);
    }
  } finally {
    await application?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

const workspaces: WorkspaceName[] = [
  "Review", "Transactions", "Coverage", "Pending", "Import",
  "Properties", "Loans", "Investments", "Settings", "Data safety",
];

test("household share percentages retain hundredth-percent precision in storage", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Properties");
  await new PropertyRegistryPage(window).addProperty("Home");
  const ownership = window.getByRole("textbox", { name: /Household ownership share/ });
  await expect(ownership).toHaveValue("100");
  await ownership.fill("75,25");
  await ownership.press("Enter");
  await expect(window.getByRole("form", { name: "Edit Household ownership share (%)" })
    .getByRole("status")).toContainText("Ownership share saved");
  await expect(ownership).toHaveValue("75.25");

  await appShell.openWorkspace("Loans");
  await new LoanRegistryPage(window).addLoan({
    label: "Mortgage", principal: "3000000", annualInterestRate: "5", termYears: "25",
    paymentAmount: "17500", paymentFrequency: "monthly", currencyCode: "NOK",
  });
  const responsibility = window.getByRole("textbox", { name: /Household loan responsibility share/ });
  await expect(responsibility).toHaveValue("100");
  await responsibility.fill("50.01");
  await responsibility.press("Enter");
  await expect(window.getByRole("form", { name: "Edit Household loan responsibility share (%)" })
    .getByRole("status")).toContainText("Responsibility share saved");
  const shares = await window.evaluate(async () => {
    const view = document.defaultView;
    if (view === null) throw new Error("Renderer window is unavailable.");
    const [properties, loans] = await Promise.all([
      view.budgetApi.propertyRegistry.list(),
      view.budgetApi.loanRegistry.list(),
    ]);
    return [properties[0]?.ownershipShareBasisPoints, loans[0]?.responsibilityShareBasisPoints];
  });
  expect(shares).toEqual([7525, 5001]);
});

test("recovery action groups leave a visible gap between file selection and execution", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Data safety");
  for (const section of ["Backup", "Export", "Restore Snapshot"]) {
    const buttons = window.getByRole("region", { name: section, exact: true })
      .locator(".action-row").getByRole("button");
    const first = await buttons.nth(0).boundingBox();
    const second = await buttons.nth(1).boundingBox();
    if (first === null || second === null) throw new Error("Recovery actions must be visible.");
    expect(second.x >= first.x + first.width + 8 || second.y >= first.y + first.height + 8).toBe(true);
  }
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "compact", width: 390, height: 844 },
]) {
  test(`all workspaces remain reachable without document overflow at ${viewport.name} size`, async ({
    appShell,
    dashboard,
    electronApp,
    window,
  }, testInfo) => {
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    }, viewport);
    await dashboard.monthSelector.selectOption("2026-05");

    for (const name of workspaces) {
      await appShell.openWorkspace(name);
      const workspace = appShell.workspace(name);
      await expect(workspace).toBeVisible();
      await expect(workspace.getByText(/^Loading/)).toHaveCount(0);
      await expect(workspace.locator('[aria-busy="true"]')).toHaveCount(0);
      const dimensions = await window.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      expect(dimensions.content, `${name} must not widen the document`).toBeLessThanOrEqual(dimensions.viewport);
      await window.evaluate(() => globalThis.scrollTo(0, 0));
      await window.mouse.move(0, 0);
      const path = testInfo.outputPath(`${name.toLowerCase().replaceAll(" ", "-")}-${viewport.name}.png`);
      await window.screenshot({ path, fullPage: true, animations: "disabled" });
      await testInfo.attach(`${name} ${viewport.name}`, { path, contentType: "image/png" });
    }
  });
}
