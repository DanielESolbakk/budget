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

  await loans.expandLoanDetails("Home mortgage");
  await loans.expandLoanDetails("Personal loan");
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
    await restartedLoans.expandLoanDetails("Home mortgage");
    await restartedLoans.expandLoanDetails("Personal loan");
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

  await expect(loans.section.getByRole("alert")).toContainText("2 highlighted fields");
  await expect(loans.labelInput).toHaveAttribute("aria-invalid", "true");
  await expect(loans.principalInput).toHaveAttribute("aria-invalid", "true");
  await expect(loans.loan("Invalid loan")).toHaveCount(0);

  await loans.labelInput.fill("Invalid loan");
  await loans.createButton.focus();
  await window.keyboard.press("Enter");
  await expect(loans.section.getByRole("alert")).toContainText("1 highlighted field");
  await expect(loans.labelInput).not.toHaveAttribute("aria-invalid", "true");
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

test("loan creation groups required terms and describes accepted input formats", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Data safety");
  const loans = new LoanRegistryPage(window);

  await expect(loans.createForm.getByRole("group", { name: "Loan details", exact: true }))
    .toBeVisible();
  await expect(loans.createForm.getByRole("group", { name: "Payment details", exact: true }))
    .toBeVisible();
  await expect(loans.createForm.getByRole("group", { name: "Property link", exact: true }))
    .toBeVisible();
  await expect(loans.section.getByText(
    "All loan details are required except the property link.",
    { exact: true }
  )).toBeVisible();

  await expect(loans.principalInput).toHaveAttribute("aria-required", "true");
  await expect(loans.principalInput).toHaveAttribute("aria-describedby", /loan-principal-hint/);
  await expect(loans.section.getByText(/up to two decimal places.*3000000,00/i)).toBeVisible();
  await expect(loans.annualInterestRateInput).toHaveAttribute(
    "aria-describedby",
    /loan-interest-rate-hint/
  );
  await expect(loans.section.getByText(/0 to 100 percent.*5,00/i)).toBeVisible();
  await expect(loans.termYearsInput).toHaveAttribute("aria-describedby", /loan-term-years-hint/);
  await expect(loans.section.getByText(/whole years.*25/i)).toBeVisible();
  await expect(loans.paymentAmountInput).toHaveAttribute(
    "aria-describedby",
    /loan-payment-amount-hint/
  );
  await expect(loans.currencyCodeInput).toHaveAttribute(
    "aria-describedby",
    /loan-currency-code-hint/
  );
  await expect(loans.section.getByText(/three-letter.*NOK.*EUR/i)).toBeVisible();
  await expect(loans.propertySelect).not.toHaveAttribute("aria-required", "true");
});

test("loan submission shows every field error and focuses the first invalid input", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Data safety");
  const loans = new LoanRegistryPage(window);
  await loans.principalInput.fill("");
  await loans.annualInterestRateInput.fill("");
  await loans.termYearsInput.fill("");
  await loans.paymentAmountInput.fill("");
  await loans.currencyCodeInput.fill("");
  await loans.createButton.click();

  const invalidFields = [
    ["label", loans.labelInput],
    ["principalMinor", loans.principalInput],
    ["annualInterestRateBasisPoints", loans.annualInterestRateInput],
    ["termMonths", loans.termYearsInput],
    ["paymentAmountMinor", loans.paymentAmountInput],
    ["currencyCode", loans.currencyCodeInput],
  ] as const;

  await expect(loans.section.getByRole("alert")).toHaveCount(1);
  for (const [field, input] of invalidFields) {
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAttribute("aria-describedby", new RegExp(
      `loan-create-error-${field}`
    ));
    await expect(loans.fieldError(field)).toBeVisible();
  }
  await expect(loans.labelInput).toBeFocused();
  await expect(loans.loan("Invalid loan")).toHaveCount(0);
});

test("balance history explains its correction path and preserves both dated entries", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Data safety");
  const loans = new LoanRegistryPage(window);
  const label = "Correction test loan";
  await loans.addLoan({
    label,
    principal: "3000000",
    annualInterestRate: "5",
    termYears: "25",
    paymentAmount: "17500",
    paymentFrequency: "monthly",
    currencyCode: "NOK",
  });

  await expect(loans.balanceHistoryGuidance())
    .toContainText(/does not replace earlier entries/i);
  await expect(loans.balanceHistoryGuidance())
    .toContainText(/To correct one, add another snapshot/i);
  await expect(loans.balanceAmountInput(label)).toBeVisible();

  await loans.addBalance(label, {
    effectiveDate: "2026-10-01",
    amount: "3000000",
  });
  await loans.addBalance(label, {
    effectiveDate: "2026-10-01",
    amount: "2995000",
  });
  await loans.expandLoanDetails(label);

  const sameDateRows = loans.balanceHistory(label).getByRole("row")
    .filter({ hasText: "2026-10-01" });
  await expect(sameDateRows).toHaveCount(2);
  const rowText = (await sameDateRows.allTextContents()).join(" ");
  expect(rowText).toMatch(/NOK 3[\s\u00a0\u202f]000[\s\u00a0\u202f]000,00/);
  expect(rowText).toMatch(/NOK 2[\s\u00a0\u202f]995[\s\u00a0\u202f]000,00/);
});

test("loan details collapse without hiding the next balance action", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Data safety");
  const loans = new LoanRegistryPage(window);
  const label = "Compact loan";
  await loans.addLoan({
    label,
    principal: "10000",
    annualInterestRate: "4",
    termYears: "3",
    paymentAmount: "300",
    paymentFrequency: "monthly",
    currencyCode: "EUR",
  });

  const details = loans.loanDetails(label);
  await expect(details).toBeVisible();
  await expect(details).not.toHaveAttribute("open", "");
  await expect(loans.balanceForm(label)).toBeVisible();
  await loans.expandLoanDetails(label);
  await expect(loans.balanceHistory(label)).toBeVisible();
  await expect(loans.loan(label).getByText("Principal", { exact: true })).toBeVisible();
});
