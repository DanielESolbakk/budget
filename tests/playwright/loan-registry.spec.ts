import { _electron as electron } from "@playwright/test";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import { LoanRegistryPage } from "./pom/LoanRegistryPage.js";
import { PropertyRegistryPage } from "./pom/PropertyRegistryPage.js";
import {
  installMainProcessNetworkProbe,
  mainProcessNetworkRequests,
} from "./helpers/networkProbe.js";
import {
  installRendererNetworkAttemptBlocker,
  installRendererNetworkAttemptObserver,
  rendererNetworkAttempts,
  rendererNetworkBlockedAttempts,
} from "./helpers/rendererNetworkProbe.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

test("loan terms and append-only balance history survive restart without rate fallback or network access", async ({
  appShell,
  databasePath,
  electronApp,
  window,
}, testInfo) => {
  await window.setViewportSize({ width: 1280, height: 800 });
  await installRendererNetworkAttemptBlocker(window);
  await installMainProcessNetworkProbe(electronApp);
  const rendererObservation = await installRendererNetworkAttemptObserver(window);
  await appShell.openWorkspace("Data safety");

  const properties = new PropertyRegistryPage(window);
  await expect(properties.section.getByRole("heading", { name: "Property registry" })).toBeVisible();
  await properties.addProperty("Home");
  await properties.addValuation("Home", {
    effectiveDate: "2026-09-01",
    amount: "4500000",
    currencyCode: "NOK",
  });
  const propertyHistoryBeforeLoanWrites = await window.evaluate(() => (
    globalThis as typeof globalThis & {
      budgetApi: { propertyRegistry: { list: () => Promise<unknown[]> } };
    }
  ).budgetApi.propertyRegistry.list());

  const loans = new LoanRegistryPage(window);
  await expect(loans.section).toBeVisible();
  await expect(window.evaluate(() => (
    globalThis as typeof globalThis & {
      budgetApi: { exchangeRates: { list: (currencyCode: string) => Promise<unknown[]> } };
    }
  ).budgetApi.exchangeRates.list("EUR"))).resolves.toEqual([]);

  await loans.addLoan({
    label: "Home mortgage",
    principal: "3000000",
    annualInterestRate: "5",
    termYears: "25",
    paymentAmount: "17500",
    paymentFrequency: "monthly",
    currencyCode: "NOK",
    propertyLabel: "Home",
  });
  await loans.addBalance("Home mortgage", {
    effectiveDate: "2026-10-01",
    amount: "3000000",
  });
  await expect(
    loans.section.getByRole("status").filter({ hasText: "Loan added." })
  ).toHaveCount(0);
  await loans.addBalance("Home mortgage", {
    effectiveDate: "2026-11-01",
    amount: "2995000",
  });
  await loans.addLoan({
    label: "Personal loan",
    principal: "10000",
    annualInterestRate: "4",
    termYears: "3",
    paymentAmount: "300",
    paymentFrequency: "monthly",
    currencyCode: "EUR",
  });
  await loans.addBalance("Personal loan", {
    effectiveDate: "2026-11-01",
    amount: "9000",
  });

  await expect(loans.balanceHistory("Home mortgage").getByRole("row")).toHaveCount(3);
  await expect(loans.balanceRow("Home mortgage", "2026-10-01")).toContainText("NOK");
  await expect(loans.balanceRow("Home mortgage", "2026-11-01"))
    .toContainText(/2[\s\u00a0\u202f]995[\s\u00a0\u202f]000,00/);
  await expect(loans.loan("Personal loan")).toContainText("Unsecured");
  await expect(loans.balanceRow("Personal loan", "2026-11-01")).toContainText("EUR");
  await loans.section.evaluate((section) => section.scrollIntoView({ block: "start" }));
  await expect(loans.section.getByRole("heading", { name: "Loan registry" })).toBeInViewport();
  await window.screenshot({ path: testInfo.outputPath("loan-registry-populated-desktop.png") });
  await window.setViewportSize({ width: 390, height: 844 });
  expect(await window.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  )).toBe(false);
  await loans.section.evaluate((section) => section.scrollIntoView({ block: "start" }));
  await expect(loans.section.getByRole("heading", { name: "Loan registry" })).toBeInViewport();
  await expect(loans.balanceHistory("Home mortgage")).toBeVisible();
  await expect(loans.balanceRow("Personal loan", "2026-11-01")).toContainText("EUR");
  await window.screenshot({ path: testInfo.outputPath("loan-registry-populated-mobile.png") });
  const loansBeforeRestart = await window.evaluate(() => (
    globalThis as typeof globalThis & {
      budgetApi: { loanRegistry: { list: () => Promise<unknown[]> } };
    }
  ).budgetApi.loanRegistry.list());
  expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
  expect(await rendererNetworkAttempts(window)).toEqual([]);
  expect(await rendererNetworkBlockedAttempts(window)).toEqual([]);
  expect(rendererObservation.httpRequests).toEqual([]);
  expect(rendererObservation.webSocketRequests).toEqual([]);
  expect(await window.evaluate(() => (
    globalThis as typeof globalThis & {
      budgetApi: { propertyRegistry: { list: () => Promise<unknown[]> } };
    }
  ).budgetApi.propertyRegistry.list())).toEqual(propertyHistoryBeforeLoanWrites);

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
    await installMainProcessNetworkProbe(restartedApp);
    const restartedObservation = await installRendererNetworkAttemptObserver(restartedWindow);
    await new AppShellPage(restartedWindow).openWorkspace("Data safety");
    const restartedLoans = new LoanRegistryPage(restartedWindow);
    const loansAfterRestart = await restartedWindow.evaluate(() => (
      globalThis as typeof globalThis & {
        budgetApi: { loanRegistry: { list: () => Promise<unknown[]> } };
      }
    ).budgetApi.loanRegistry.list());

    expect(loansAfterRestart).toEqual(loansBeforeRestart);
    await expect(restartedLoans.balanceRow("Home mortgage", "2026-10-01")).toContainText("NOK");
    await expect(restartedLoans.balanceRow("Home mortgage", "2026-11-01"))
      .toContainText(/2[\s\u00a0\u202f]995[\s\u00a0\u202f]000,00/);
    await expect(restartedLoans.balanceRow("Personal loan", "2026-11-01")).toContainText("EUR");
    await expect(restartedWindow.evaluate(() => (
      globalThis as typeof globalThis & {
        budgetApi: { exchangeRates: { list: (currencyCode: string) => Promise<unknown[]> } };
      }
    ).budgetApi.exchangeRates.list("EUR"))).resolves.toEqual([]);
    expect(await mainProcessNetworkRequests(restartedApp)).toEqual([]);
    expect(await rendererNetworkAttempts(restartedWindow)).toEqual([]);
    expect(await rendererNetworkBlockedAttempts(restartedWindow)).toEqual([]);
    expect(restartedObservation.httpRequests).toEqual([]);
    expect(restartedObservation.webSocketRequests).toEqual([]);
  } finally {
    await restartedApp.close();
  }
});

test("loan entry shows field errors and remains keyboard reachable without mobile overflow", async ({
  appShell,
  window,
}) => {
  await window.setViewportSize({ width: 390, height: 844 });
  await appShell.openWorkspace("Data safety");
  const loans = new LoanRegistryPage(window);
  await expect(loans.section).toBeVisible();
  await expect(loans.section.getByText("No loans have been recorded.", { exact: true }))
    .toBeVisible();

  await loans.labelInput.focus();
  await window.keyboard.press("Tab");
  await loans.principalInput.fill("-1");
  await loans.annualInterestRateInput.fill("5");
  await loans.termYearsInput.fill("25");
  await loans.paymentAmountInput.fill("17500");
  await loans.paymentFrequencySelect.selectOption("monthly");
  await loans.currencyCodeInput.fill("NOK");
  await loans.createButton.focus();
  await window.keyboard.press("Enter");

  await expect(loans.section.getByRole("alert")).toContainText("loan label");
  await expect(loans.labelInput).toHaveAttribute("aria-invalid", "true");
  await expect(loans.loan("Invalid loan")).toHaveCount(0);

  await loans.labelInput.fill("Invalid loan");
  await loans.createButton.focus();
  await window.keyboard.press("Enter");
  await expect(loans.section.getByRole("alert")).toContainText("principal");
  await expect(loans.principalInput).toHaveAttribute("aria-invalid", "true");
  await expect(loans.loan("Invalid loan")).toHaveCount(0);
  expect(await window.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  )).toBe(false);

  await window.setViewportSize({ width: 1280, height: 800 });
  await loans.addLoan({
    label: "Keyboard mortgage",
    principal: "3000000",
    annualInterestRate: "5",
    termYears: "25",
    paymentAmount: "17500",
    paymentFrequency: "monthly",
    currencyCode: "NOK",
  });
  await expect(loans.loan("Keyboard mortgage")).toBeVisible();
  expect(await window.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  )).toBe(false);
});
