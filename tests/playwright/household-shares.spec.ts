import { _electron as electron } from "@playwright/test";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import { LoanRegistryPage } from "./pom/LoanRegistryPage.js";
import { PropertyRegistryPage } from "./pom/PropertyRegistryPage.js";
import { installMainProcessNetworkProbe, mainProcessNetworkRequests } from "./helpers/networkProbe.js";
import {
  installRendererNetworkAttemptBlocker,
  installRendererNetworkAttemptObserver,
  rendererNetworkAttempts,
  rendererNetworkBlockedAttempts,
} from "./helpers/rendererNetworkProbe.js";

test("household shares can be edited independently without network requests", async ({
  appShell,
  databasePath,
  electronApp,
  window,
}) => {
  await installMainProcessNetworkProbe(electronApp);
  await installRendererNetworkAttemptBlocker(window);
  const rendererObservation = await installRendererNetworkAttemptObserver(window);
  await appShell.openWorkspace("Properties");
  const properties = new PropertyRegistryPage(window);
  await properties.addProperty("Home");
  await properties.addValuation("Home", { effectiveDate: "2026-10-01", amount: "5000000", currencyCode: "NOK" });
  const property = properties.property("Home");
  const ownership = property.getByLabel("Household ownership share (basis points)", { exact: true });
  await expect(ownership).toHaveValue("10000");
  await ownership.fill("7500");
  await property.getByRole("button", { name: "Save ownership share", exact: true }).click();
  await expect(property.getByRole("form", { name: "Edit Household ownership share (basis points)" })
    .getByRole("status")).toContainText("Ownership share saved");

  await appShell.openWorkspace("Loans");
  const loans = new LoanRegistryPage(window);
  await loans.addLoan({
    label: "Mortgage",
    principal: "3000000",
    annualInterestRate: "5",
    termYears: "25",
    paymentAmount: "17500",
    paymentFrequency: "monthly",
    currencyCode: "NOK",
    propertyLabel: "Home",
  });
  const loan = loans.loan("Mortgage");
  const responsibility = loan.getByLabel("Household loan responsibility share (basis points)", { exact: true });
  await expect(responsibility).toHaveValue("10000");
  await responsibility.fill("5000");
  await loan.getByRole("button", { name: "Save responsibility share", exact: true }).click();
  await expect(loan.getByRole("status")).toContainText("Responsibility share saved");
  await loans.addBalance("Mortgage", { effectiveDate: "2026-10-01", amount: "3000000" });
  await appShell.openWorkspace("Properties");
  await expect(properties.property("Home").getByLabel(
    "Household ownership share (basis points)", { exact: true }
  )).toHaveValue("7500");
  await ownership.fill("6000");
  await property.getByRole("button", { name: "Save ownership share", exact: true }).click();
  await expect(property.getByRole("form", { name: "Edit Household ownership share (basis points)" })
    .getByRole("status")).toContainText("Ownership share saved");
  await appShell.openWorkspace("Loans");
  await expect(responsibility).toHaveValue("5000");
  expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
  expect(await rendererNetworkAttempts(window)).toEqual([]);
  expect(await rendererNetworkBlockedAttempts(window)).toEqual([]);
  expect(rendererObservation.httpRequests).toEqual([]);
  expect(rendererObservation.webSocketRequests).toEqual([]);
  await electronApp.close();
  const restarted = await electron.launch({
    args: [join(process.cwd(), "out", "main", "index.js")],
    env: { ...process.env, NODE_ENV: "test", BUDGET_DB_PATH: databasePath },
  });
  try {
    const restartedWindow = await restarted.firstWindow();
    await restartedWindow.waitForLoadState("domcontentloaded");
    await installMainProcessNetworkProbe(restarted);
    await installRendererNetworkAttemptBlocker(restartedWindow);
    const restartedObservation = await installRendererNetworkAttemptObserver(restartedWindow);
    const restartedShell = new AppShellPage(restartedWindow);
    await restartedShell.openWorkspace("Properties");
    const restartedProperties = new PropertyRegistryPage(restartedWindow);
    await expect(restartedProperties.property("Home").getByRole("textbox", {
      name: "Household ownership share (basis points)", exact: true,
    })).toHaveValue("6000");
    await expect(restartedProperties.valuationValueCell("Home", "2026-10-01")).toContainText(/NOK\s*5[\s\u00a0\u202f]000[\s\u00a0\u202f]000,00/);
    await restartedShell.openWorkspace("Loans");
    const restartedLoans = new LoanRegistryPage(restartedWindow);
    await expect(restartedLoans.loan("Mortgage").getByRole("textbox", {
      name: "Household loan responsibility share (basis points)", exact: true,
    })).toHaveValue("5000");
    await restartedLoans.expandLoanDetails("Mortgage");
    await expect(restartedLoans.balanceRow("Mortgage", "2026-10-01")).toContainText(/NOK\s*3[\s\u00a0\u202f]000[\s\u00a0\u202f]000,00/);
    expect(await mainProcessNetworkRequests(restarted)).toEqual([]);
    expect(await rendererNetworkAttempts(restartedWindow)).toEqual([]);
    expect(await rendererNetworkBlockedAttempts(restartedWindow)).toEqual([]);
    expect(restartedObservation.httpRequests).toEqual([]);
    expect(restartedObservation.webSocketRequests).toEqual([]);
  } finally {
    await restarted.close();
  }
});

test("invalid shares are labeled and leave saved values unchanged at compact and desktop widths", async ({
  appShell,
  window,
}) => {
  await window.setViewportSize({ width: 390, height: 844 });
  await appShell.openWorkspace("Properties");
  const properties = new PropertyRegistryPage(window);
  await properties.addProperty("Home");
  const property = properties.property("Home");
  const ownership = property.getByRole("textbox", { name: "Household ownership share (basis points)", exact: true });
  await expect(ownership).toHaveValue("10000");
  const hint = property.getByText("0 is 0%; 10000 is 100%. This does not determine legal ownership or liability.");
  const contrast = await hint.evaluate((element) => {
    const luminance = (color: string): number => {
      const channels = color.match(/\d+/g)?.slice(0, 3).map(Number);
      if (channels?.length !== 3) throw new Error(`Unexpected color: ${color}`);
      const linear = channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    let parent: Element | null = element;
    let background = "rgba(0, 0, 0, 0)";
    while (parent !== null && background === "rgba(0, 0, 0, 0)") {
      background = getComputedStyle(parent).backgroundColor;
      parent = parent.parentElement;
    }
    const foregroundLuminance = luminance(getComputedStyle(element).color);
    const backgroundLuminance = luminance(background);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await ownership.focus();
  await ownership.press("Tab");
  await expect(property.getByRole("button", { name: "Save ownership share", exact: true })).toBeFocused();
  await window.keyboard.press("Shift+Tab");
  await expect(ownership).toBeFocused();
  await ownership.fill("10001");
  await ownership.press("Enter");
  await expect(ownership).toHaveAttribute("aria-invalid", "true");
  await expect(property.getByRole("alert")).toContainText("whole number from 0 to 10000");
  await appShell.openWorkspace("Loans");
  const loans = new LoanRegistryPage(window);
  await loans.addLoan({
    label: "Mortgage", principal: "3000000", annualInterestRate: "5", termYears: "25",
    paymentAmount: "17500", paymentFrequency: "monthly", currencyCode: "NOK",
  });
  const loan = loans.loan("Mortgage");
  const responsibility = loan.getByRole("textbox", {
    name: "Household loan responsibility share (basis points)", exact: true,
  });
  await expect(responsibility).toHaveValue("10000");
  await responsibility.fill("5000.5");
  await responsibility.press("Enter");
  await expect(responsibility).toHaveAttribute("aria-invalid", "true");
  await expect(loan.getByRole("alert")).toContainText("whole number from 0 to 10000");
  expect(await window.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  const savedShares = await window.evaluate(async () => {
    const view = document.defaultView;
    if (view === null) throw new Error("Renderer window is unavailable.");
    const [properties, loans] = await Promise.all([
      view.budgetApi.propertyRegistry.list(),
      view.budgetApi.loanRegistry.list(),
    ]);
    return { properties, loans };
  });
  expect(savedShares.properties[0]).toHaveProperty("ownershipShareBasisPoints", 10_000);
  expect(savedShares.loans[0]).toHaveProperty("responsibilityShareBasisPoints", 10_000);
  await appShell.openWorkspace("Properties");
  await window.setViewportSize({ width: 1280, height: 800 });
  expect(await window.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`both share controls save inclusive boundaries at ${viewport.width}px`, async ({ appShell, window }) => {
    await window.setViewportSize(viewport);
    await appShell.openWorkspace("Properties");
    const properties = new PropertyRegistryPage(window);
    await properties.addProperty("Home");
    await appShell.openWorkspace("Loans");
    const loans = new LoanRegistryPage(window);
    await loans.addLoan({
      label: "Mortgage", principal: "3000000", annualInterestRate: "5", termYears: "25",
      paymentAmount: "17500", paymentFrequency: "monthly", currencyCode: "NOK",
    });

    for (const boundary of ["0", "10000"]) {
      await appShell.openWorkspace("Properties");
      const property = properties.property("Home");
      await property.getByLabel("Household ownership share (basis points)", { exact: true }).fill(boundary);
      await property.getByRole("button", { name: "Save ownership share", exact: true }).click();
      await expect(property.getByRole("status")).toContainText("Ownership share saved");
      await appShell.openWorkspace("Loans");
      const loan = loans.loan("Mortgage");
      await loan.getByLabel("Household loan responsibility share (basis points)", { exact: true }).fill(boundary);
      await loan.getByRole("button", { name: "Save responsibility share", exact: true }).click();
      await expect(loan.getByRole("status")).toContainText("Responsibility share saved");
      const shares = await window.evaluate(async () => {
        const view = document.defaultView;
        if (view === null) throw new Error("Renderer window is unavailable.");
        const [properties, loans] = await Promise.all([
          view.budgetApi.propertyRegistry.list(),
          view.budgetApi.loanRegistry.list(),
        ]);
        return [properties[0]?.ownershipShareBasisPoints, loans[0]?.responsibilityShareBasisPoints];
      });
      expect(shares).toEqual([Number(boundary), Number(boundary)]);
      expect(await window.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
    }
  });
}

test("the IPC boundary rejects malformed shares without changing saved values", async ({ appShell, window }) => {
  await appShell.openWorkspace("Properties");
  await new PropertyRegistryPage(window).addProperty("Home");
  await appShell.openWorkspace("Loans");
  await new LoanRegistryPage(window).addLoan({
    label: "Mortgage", principal: "3000000", annualInterestRate: "5", termYears: "25",
    paymentAmount: "17500", paymentFrequency: "monthly", currencyCode: "NOK",
  });
  const result = await window.evaluate(async () => {
    const view = document.defaultView;
    if (view === null) throw new Error("Renderer window is unavailable.");
    const [properties, loans] = await Promise.all([
      view.budgetApi.propertyRegistry.list(),
      view.budgetApi.loanRegistry.list(),
    ]);
    const property = properties[0];
    const loan = loans[0];
    if (property === undefined || loan === undefined) throw new Error("Share records are missing.");
    const attempts = await Promise.allSettled([
      Reflect.apply(view.budgetApi.propertyRegistry.updateOwnershipShare, null, [
        { propertyId: property.id, ownershipShareBasisPoints: 10_001 },
      ]),
      Reflect.apply(view.budgetApi.loanRegistry.updateResponsibilityShare, null, [
        { loanId: loan.id, responsibilityShareBasisPoints: 5_000.5 },
      ]),
    ]);
    const [savedProperties, savedLoans] = await Promise.all([
      view.budgetApi.propertyRegistry.list(),
      view.budgetApi.loanRegistry.list(),
    ]);
    return { statuses: attempts.map((attempt) => attempt.status), savedProperties, savedLoans };
  });
  expect(result.statuses).toEqual(["rejected", "rejected"]);
  expect(result.savedProperties[0]?.ownershipShareBasisPoints).toBe(10_000);
  expect(result.savedLoans[0]?.responsibilityShareBasisPoints).toBe(10_000);
});
