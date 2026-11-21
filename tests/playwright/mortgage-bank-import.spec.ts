import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { LoanRegistryPage } from "./pom/LoanRegistryPage.js";
import type { BudgetApi } from "../../src/renderer/preload.js";

test("loan workflow previews and accepts paired mortgage evidence without changing the loan", async ({
  appShell,
  electronApp,
  window,
}) => {
  await window.setViewportSize({ width: 390, height: 844 });
  await appShell.openWorkspace("Loans");
  const loans = new LoanRegistryPage(window);
  await loans.addLoan({
    label: "Rogaland mortgage",
    principal: "3000000",
    annualInterestRate: "5",
    termYears: "25",
    paymentAmount: "17500",
    paymentFrequency: "monthly",
    currencyCode: "NOK",
  });

  const filePaths = [
    join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-11-mortgage-details-dated.html"),
    join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-11-mortgage-schedule.html"),
  ];
  await electronApp.evaluate((_, paths: string[]) => {
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = "selected";
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = JSON.stringify(paths);
  }, filePaths);

  const loan = loans.loan("Rogaland mortgage");
  await expect(loan.getByRole("button", {
    name: "Import mortgage evidence",
    exact: true,
  })).toBeVisible();
  await loan.getByRole("button", {
    name: "Import mortgage evidence",
    exact: true,
  }).click();

  const importPanel = window.getByRole("region", {
    name: "Mortgage evidence import for Rogaland mortgage",
    exact: true,
  });
  const preview = window.getByRole("region", {
    name: "Mortgage evidence preview for Rogaland mortgage",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("****-123");
  await expect(preview).not.toContainText("loan-123");
  await expect(preview).toContainText(
    "Imported figures remain evidence; they do not replace manually recorded terms or actual balances."
  );
  await expect(preview).toContainText("Source date: 2026-11-21");
  await expect(preview).toContainText("Attachment confirmation required");
  await preview.getByRole("button", {
    name: "Confirm attachment to Rogaland mortgage",
    exact: true,
  }).click();
  await expect(preview).toContainText("You confirmed this evidence belongs to the selected loan.");
  await expect(preview).toContainText("Source comparison with saved loan terms");
  await expect(preview).toContainText("Opprinnelig lånebeløp");
  const acceptButton = preview.getByRole("button", {
    name: "Accept mortgage evidence",
    exact: true,
  });
  await expect(acceptButton).toBeDisabled();
  await preview.getByRole("checkbox", {
    name: "I reviewed the source differences. Saved loan terms and actual balances remain unchanged.",
    exact: true,
  }).check();
  await expect(acceptButton).toBeEnabled();
  await acceptButton.click();
  await expect(importPanel.getByRole("status")).toContainText("Evidence version 1 saved.");
  await loan.getByText("Imported mortgage evidence", { exact: true }).click();
  await expect(loan).toContainText("1 source difference acknowledged");

  const evidence = await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.mortgageImport.listEvidenceSummaries());
  expect(evidence).toMatchObject([{
    loanId: expect.any(String),
    versionNumber: 1,
    sourceAsOfDateIso: "2026-11-21",
    documentRoles: ["details", "schedule"],
    termDifferenceCount: 1,
    termDifferencesAcknowledged: true,
    scheduleValidationStatus: "valid",
  }]);

  const persistedLoans = await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.loanRegistry.list());
  expect(persistedLoans).toMatchObject([{
    label: "Rogaland mortgage",
    principalMinor: 300_000_000,
    annualInterestRateBasisPoints: 500,
    balances: [],
  }]);
  expect(await window.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ))).toBe(false);
});

test("an incomplete loan is created only when mortgage evidence is accepted", async ({
  appShell,
  electronApp,
  window,
}) => {
  await appShell.openWorkspace("Loans");
  const loans = new LoanRegistryPage(window);
  const filePaths = [
    join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-11-mortgage-details.html"),
    join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-11-mortgage-schedule.html"),
  ];
  await electronApp.evaluate((_, paths: string[]) => {
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = "selected";
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = JSON.stringify(paths);
  }, filePaths);

  const importPanel = window.getByRole("region", {
    name: "Mortgage evidence import for an incomplete loan",
    exact: true,
  });
  await window.getByRole("button", {
    name: "Import as incomplete loan",
    exact: true,
  }).click();
  await importPanel.getByLabel("Loan label", { exact: true }).fill("Rogaland mortgage");
  await importPanel.getByRole("button", { name: "Choose mortgage HTML files", exact: true }).click();

  const preview = window.getByRole("region", {
    name: "Mortgage evidence preview for Rogaland mortgage",
    exact: true,
  });
  await expect(preview).toContainText("Attachment confirmation required");
  expect(await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.loanRegistry.listSourceOnly())).toEqual([]);
  await preview.getByRole("button", {
    name: "Confirm attachment to an incomplete loan",
    exact: true,
  }).click();
  await preview.getByRole("button", { name: "Accept mortgage evidence", exact: true }).click();

  const sourceOnlySection = loans.section.getByRole("region", {
    name: "Source-only loan records",
    exact: true,
  });
  await expect(sourceOnlySection).toContainText("Rogaland mortgage");
  await expect(sourceOnlySection)
    .toContainText("No actual balance or complete loan terms are recorded.");
  await expect(window.getByRole("region", {
    name: "Mortgage evidence import for an incomplete loan",
    exact: true,
  })).toHaveCount(0);
  await expect(loans.section.getByText("Mortgage evidence version 1 saved.", { exact: true }))
    .toBeVisible();
  const completeLoans = await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.loanRegistry.list());
  expect(completeLoans).toEqual([]);
  const sourceOnlyRecords = await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.loanRegistry.listSourceOnly());
  expect(sourceOnlyRecords).toMatchObject([{
    label: "Rogaland mortgage",
    currencyCode: "NOK",
    recordStatus: "source-only",
  }]);
  await sourceOnlySection.getByRole("button", {
    name: "Import mortgage evidence",
    exact: true,
  }).click();
  await expect(window.getByRole("region", {
    name: "Mortgage evidence import for Rogaland mortgage",
    exact: true,
  })).toBeVisible();
  const evidence = await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.mortgageImport.listEvidenceSummaries());
  expect(evidence).toMatchObject([{
    loanId: sourceOnlyRecords[0]?.id,
    versionNumber: 1,
    documentRoles: ["details", "schedule"],
    attachment: { status: "confirmed" },
  }]);
});

test("canceling a mortgage preview does not persist evidence or change the loan", async ({
  appShell,
  electronApp,
  window,
}) => {
  await appShell.openWorkspace("Loans");
  const loans = new LoanRegistryPage(window);
  await loans.addLoan({
    label: "Rogaland mortgage",
    principal: "3000000",
    annualInterestRate: "5",
    termYears: "25",
    paymentAmount: "17500",
    paymentFrequency: "monthly",
    currencyCode: "NOK",
  });
  const filePaths = [
    join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-11-mortgage-details.html"),
    join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-11-mortgage-schedule.html"),
  ];
  await electronApp.evaluate((_, paths: string[]) => {
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = "selected";
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = JSON.stringify(paths);
  }, filePaths);

  const loan = loans.loan("Rogaland mortgage");
  await loan.getByRole("button", { name: "Import mortgage evidence", exact: true }).click();
  const importPanel = window.getByRole("region", {
    name: "Mortgage evidence import for Rogaland mortgage",
    exact: true,
  });
  const preview = window.getByRole("region", {
    name: "Mortgage evidence preview for Rogaland mortgage",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Cancel import", exact: true }).click();
  await expect(importPanel.getByRole("status"))
    .toContainText("Import canceled. No loan data was changed.");

  const evidence = await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.mortgageImport.listEvidenceSummaries());
  expect(evidence).toEqual([]);
  const unchangedLoans = await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.loanRegistry.list());
  expect(unchangedLoans).toMatchObject([{
    label: "Rogaland mortgage",
    principalMinor: 300_000_000,
    annualInterestRateBasisPoints: 500,
    balances: [],
  }]);
});
