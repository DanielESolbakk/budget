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
  await window.clock.install({ time: new Date("2026-11-21T12:00:00.000Z") });
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
  const currentCheckpoint = preview.getByRole("group", {
    name: "Current month source checkpoint",
    exact: true,
  });
  await expect(currentCheckpoint).toContainText("November 2026");
  await expect(currentCheckpoint).toContainText("1 100,00");
  await expect(currentCheckpoint).toContainText("1 000,00");
  await expect(currentCheckpoint).toContainText("90,00");
  await expect(currentCheckpoint).toContainText("10,00");
  await expect(currentCheckpoint).toContainText("99 000,00");
  const nextCheckpoint = preview.getByRole("group", {
    name: "Next month source checkpoint",
    exact: true,
  });
  await expect(nextCheckpoint).toContainText("Desember 2026");
  await expect(nextCheckpoint).toContainText("1 099,00");
  const yearEndCheckpoint = preview.getByRole("group", {
    name: "First year-end source checkpoint",
    exact: true,
  });
  await expect(yearEndCheckpoint).toContainText("Desember 2026");
  await expect(yearEndCheckpoint).toContainText("98 000,00");
  const finalCheckpoint = preview.getByRole("group", {
    name: "Final available source checkpoint",
    exact: true,
  });
  await expect(finalCheckpoint).toContainText("Desember 2026");
  await expect(finalCheckpoint).toContainText("1 099,00");
  await expect(finalCheckpoint).toContainText("98 000,00");
  await expect(preview).toContainText("****-123");
  await expect(preview).not.toContainText("loan-123");
  await expect(preview).toContainText(
    "Imported figures remain evidence; they do not replace manually recorded terms or actual balances."
  );
  await expect(preview).toContainText("Source date: 2026-11-21");
  await expect(preview).toContainText("Attachment confirmation required");
  const confirmAttachmentButton = preview.getByRole("button", {
    name: "Confirm attachment to Rogaland mortgage",
    exact: true,
  });
  await confirmAttachmentButton.focus();
  await window.keyboard.press("Enter");
  await expect(preview).toContainText("You confirmed this evidence belongs to the selected loan.");
  await expect(preview).toContainText("Source comparison with saved loan terms");
  await expect(preview).toContainText("Opprinnelig lånebeløp");
  await window.setViewportSize({ width: 1280, height: 800 });
  await electronApp.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow === undefined) throw new Error("Expected an Electron window.");
    mainWindow.webContents.setZoomFactor(2);
  });
  await expect.poll(() => window.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ))).toBe(false);
  await expect(preview.getByRole("group", {
    name: "Current month source checkpoint",
    exact: true,
  })).toBeVisible();
  await electronApp.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow === undefined) throw new Error("Expected an Electron window.");
    mainWindow.webContents.setZoomFactor(1);
  });
  await window.setViewportSize({ width: 390, height: 844 });
  const acceptButton = preview.getByRole("button", {
    name: "Accept mortgage evidence",
    exact: true,
  });
  await expect(acceptButton).toBeDisabled();
  const differenceAcknowledgement = preview.getByRole("checkbox", {
    name: "I reviewed the source differences. Saved loan terms and actual balances remain unchanged.",
    exact: true,
  });
  await differenceAcknowledgement.focus();
  await window.keyboard.press("Space");
  await expect(differenceAcknowledgement).toBeChecked();
  await expect(acceptButton).toBeEnabled();
  await acceptButton.focus();
  await window.keyboard.press("Enter");
  await expect(importPanel.getByRole("status")).toContainText("Evidence version 1 saved.");
  await loan.getByText("Imported mortgage evidence", { exact: true }).click();
  await expect(loan).toContainText("1 source difference acknowledged");
  await window.reload();
  await appShell.openWorkspace("Loans");
  await loans.selectLoan("Rogaland mortgage");
  const reloadedLoan = loans.loan("Rogaland mortgage");
  await reloadedLoan.getByText("Imported mortgage evidence", { exact: true }).click();
  await expect(reloadedLoan).toContainText("1 source difference acknowledged");

  await electronApp.evaluate((_, paths: string[]) => {
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = "selected";
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = JSON.stringify(paths);
  }, [...filePaths].reverse());
  await reloadedLoan.getByRole("button", {
    name: "Import mortgage evidence",
    exact: true,
  }).click();
  const replayPreview = window.getByRole("region", {
    name: "Mortgage evidence preview for Rogaland mortgage",
    exact: true,
  });
  await expect(replayPreview).toContainText("Paired evidence checks passed.");
  const replayAcceptButton = replayPreview.getByRole("button", {
    name: "Accept mortgage evidence",
    exact: true,
  });
  await expect(replayAcceptButton).toBeDisabled();
  await replayPreview.getByRole("checkbox", {
    name: "I reviewed the source differences. Saved loan terms and actual balances remain unchanged.",
    exact: true,
  }).check();
  await replayAcceptButton.click();
  await expect(reloadedLoan.getByRole("status"))
    .toContainText("Evidence version 2 saved.");

  const evidence = await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.mortgageImport.listEvidenceSummaries());
  expect(evidence.map((version) => version.versionNumber)).toEqual([1, 2]);
  expect(evidence).toMatchObject([
    {
      loanId: expect.any(String),
      sourceAsOfDateIso: "2026-11-21",
      documentRoles: ["details", "schedule"],
      termDifferenceCount: 1,
      termDifferencesAcknowledged: true,
      scheduleValidationStatus: "valid",
    },
    {
      loanId: expect.any(String),
      versionNumber: 2,
      sourceAsOfDateIso: "2026-11-21",
      documentRoles: ["details", "schedule"],
      termDifferenceCount: 1,
      termDifferencesAcknowledged: true,
      scheduleValidationStatus: "valid",
    },
  ]);

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
  await expect(preview).toContainText("Source date not identified.");
  await expect(preview).toContainText(
    /Import time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/
  );
  const importTimeText = await preview.getByText(/Import time:/).textContent();
  const previewImportedAtIso = importTimeText?.match(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/
  )?.[0];
  if (previewImportedAtIso === undefined) throw new Error("Expected an ISO import time in preview.");
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
  const acceptedEvidence = await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.mortgageImport.listEvidenceSummaries());
  const acceptedVersion = acceptedEvidence[0];
  if (acceptedVersion === undefined) throw new Error("Expected accepted mortgage evidence.");
  expect(acceptedVersion.importedAtIso).toBe(previewImportedAtIso);
  await expect(sourceOnlySection).toContainText(acceptedVersion.importedAtIso);
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

test("canceling while mortgage evidence is being read stops the pending preview", async ({
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
  ];
  await electronApp.evaluate((_, paths: string[]) => {
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = "selected";
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = JSON.stringify(paths);
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DELAY_MS"] = "1500";
  }, filePaths);

  const loan = loans.loan("Rogaland mortgage");
  await loan.getByRole("button", {
    name: "Import mortgage evidence",
    exact: true,
  }).click();
  const importPanel = window.getByRole("region", {
    name: "Mortgage evidence import for Rogaland mortgage",
    exact: true,
  });
  const cancelReadButton = importPanel.getByRole("button", {
    name: "Cancel reading mortgage evidence",
    exact: true,
  });
  await expect(cancelReadButton).toBeVisible();
  await cancelReadButton.click();
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

test("unsupported HTML cannot create an incomplete loan", async ({
  appShell,
  electronApp,
  window,
}) => {
  await appShell.openWorkspace("Loans");
  const loans = new LoanRegistryPage(window);
  const filePaths = [
    join(process.cwd(), "tests", "fixtures", "synthetic", "unsupported-mortgage-page.html"),
  ];
  await electronApp.evaluate((_, paths: string[]) => {
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = "selected";
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = JSON.stringify(paths);
  }, filePaths);

  await window.getByRole("button", {
    name: "Import as incomplete loan",
    exact: true,
  }).click();
  const importPanel = window.getByRole("region", {
    name: "Mortgage evidence import for an incomplete loan",
    exact: true,
  });
  await importPanel.getByLabel("Loan label", { exact: true }).fill("Unsupported sample");
  await importPanel.getByRole("button", {
    name: "Choose mortgage HTML files",
    exact: true,
  }).click();
  await expect(importPanel.getByRole("alert"))
    .toContainText("not a supported mortgage-details or repayment-plan page");

  const sourceOnlyLoans = await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.loanRegistry.listSourceOnly());
  expect(sourceOnlyLoans).toEqual([]);
  await expect(loans.sourceOnlyLoans).toHaveCount(0);
});
