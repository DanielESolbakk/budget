import { test, expect } from "./fixtures/electron.js";
import type { WorkspaceName } from "./pom/AppShellPage.js";
import { PropertyRegistryPage } from "./pom/PropertyRegistryPage.js";
import { LoanRegistryPage } from "./pom/LoanRegistryPage.js";

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
