import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, expect } from "./fixtures/electron.js";
import { LoanRegistryPage } from "./pom/LoanRegistryPage.js";
import type { BudgetApi } from "../../src/renderer/preload.js";

function getRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${name} to be an object.`);
  }
  return value as Record<string, unknown>;
}

test("stores the local mortgage identity key using Electron safe storage", async ({
  electronApp,
}) => {
  const userDataPath = await electronApp.evaluate(({ app }) => app.getPath("userData"));
  const keyFilePath = join(userDataPath, "mortgage-identity-key.bin");
  expect(existsSync(keyFilePath)).toBe(true);

  const result = await electronApp.evaluate(({ safeStorage }, ciphertextBase64: string) => {
    const ciphertext = Buffer.from(ciphertextBase64, "base64");
    const encodedKey = safeStorage.decryptString(ciphertext);
    const key = Buffer.from(encodedKey, "base64");
    return {
      keyByteLength: key.byteLength,
      encryptedFileContainsPlaintextKey: ciphertext.includes(key),
    };
  }, readFileSync(keyFilePath).toString("base64"));
  expect(result).toEqual({
    keyByteLength: 32,
    encryptedFileContainsPlaintextKey: false,
  });
});

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
  await expect(importPanel.getByText(
    "Select the saved loan-details page, repayment-plan page, or both. A single supported page can be reviewed as partial evidence.",
    { exact: true }
  )).toBeVisible();
  const chooseFilesButton = importPanel.getByRole("button", {
    name: "Choose mortgage HTML files",
    exact: true,
  });
  await expect(chooseFilesButton).toBeEnabled();
  await chooseFilesButton.click();
  await expect(preview).toBeVisible();
  const currentCheckpoint = preview.getByRole("group", {
    name: "Current month source checkpoint",
    exact: true,
  });
  const currentCheckpointSummary = currentCheckpoint.getByRole("button", {
    name: /Current month source checkpoint/,
  });
  await expect(currentCheckpointSummary).toContainText("November 2026");
  await expect(currentCheckpointSummary).toContainText("1 100,00");
  await expect(currentCheckpointSummary).toContainText("99 000,00");
  await expect(currentCheckpoint.getByText("Principal", { exact: true })).toBeHidden();
  await currentCheckpointSummary.click();
  await expect(currentCheckpoint.getByText("Principal", { exact: true })).toBeVisible();
  await expect(currentCheckpoint).toContainText("November 2026");
  await expect(currentCheckpoint).toContainText("1 100,00");
  await expect(currentCheckpoint).toContainText("1 000,00");
  await expect(currentCheckpoint).toContainText("90,00");
  await expect(currentCheckpoint).toContainText("10,00");
  await expect(currentCheckpoint).toContainText("99 000,00");
  const showCurrentSource = currentCheckpoint.getByText("Show in source", { exact: true });
  await showCurrentSource.focus();
  await window.keyboard.press("Enter");
  const currentSourceExcerpt = currentCheckpoint.getByRole("group", {
    name: "Original source excerpt around November 2026",
    exact: true,
  });
  await expect(currentSourceExcerpt).toBeVisible();
  await expect(currentSourceExcerpt).toContainText("Source year grouping: 2026");
  await expect(currentSourceExcerpt).toContainText("Termin");
  await expect(currentSourceExcerpt).toContainText("November 2026");
  await expect(currentSourceExcerpt).toContainText("Desember 2026");
  await expect(currentSourceExcerpt.getByText(/^Source row/)).toHaveCount(2);
  await expect(currentSourceExcerpt).toContainText("Restgjeld");
  await expect(currentSourceExcerpt).toContainText("99 000,00");
  await expect(currentSourceExcerpt).not.toContainText("loan-123");
  await expect(currentSourceExcerpt.getByRole("link")).toHaveCount(0);
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
  const yearEndSummary = yearEndCheckpoint.getByRole("button", {
    name: /First year-end source checkpoint/,
  });
  await expect(yearEndSummary).toContainText("Desember 2026");
  await expect(yearEndSummary).toContainText("98 000,00");
  await expect(yearEndSummary).toContainText(
    "Monthly detail covers 2 of 12 months; no full-year monthly sum is available for comparison."
  );
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
  await window.clock.setFixedTime(new Date("2027-01-21T12:00:00.000Z"));
  await confirmAttachmentButton.focus();
  await window.keyboard.press("Enter");
  const attachmentConfirmationStatus = preview.getByText(
    "You confirmed this evidence belongs to the selected loan.",
    { exact: true }
  );
  await expect(attachmentConfirmationStatus).toBeFocused();
  await expect(yearEndCheckpoint).toContainText("Desember 2026");
  await expect(preview).toContainText("Source comparison with saved loan terms");
  await expect(preview).toContainText("Opprinnelig lånebeløp");
  const reviewActions = preview.getByRole("group", {
    name: "Mortgage evidence review actions",
    exact: true,
  });
  await preview.getByRole("link", {
    name: "Jump to review actions",
    exact: true,
  }).click();
  await expect(reviewActions).toBeFocused();
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
  await expect(importPanel.getByText(
    "Evidence version 1 saved. No actual balance was inferred.",
    { exact: true }
  )).toBeVisible();
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
  await window.getByRole("region", {
    name: "Mortgage evidence import for Rogaland mortgage",
    exact: true,
  }).getByRole("button", {
    name: "Choose mortgage HTML files",
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

test("requires disclosure before confirming an identity check from another installation", async ({
  appShell,
  databasePath,
  electronApp,
  window,
}) => {
  await window.clock.install({ time: new Date("2026-11-21T12:00:00.000Z") });
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
  const openImport = loan.getByRole("button", {
    name: "Import mortgage evidence",
    exact: true,
  });
  await openImport.click();
  const importPanel = window.getByRole("region", {
    name: "Mortgage evidence import for Rogaland mortgage",
    exact: true,
  });
  await importPanel.getByRole("button", {
    name: "Choose mortgage HTML files",
    exact: true,
  }).click();
  let preview = window.getByRole("region", {
    name: "Mortgage evidence preview for Rogaland mortgage",
    exact: true,
  });
  await preview.getByRole("button", {
    name: "Confirm attachment to Rogaland mortgage",
    exact: true,
  }).click();
  await preview.getByRole("checkbox", {
    name: "I reviewed the source differences. Saved loan terms and actual balances remain unchanged.",
    exact: true,
  }).check();
  await preview.getByRole("button", {
    name: "Accept mortgage evidence",
    exact: true,
  }).click();
  await expect(loan).toContainText("Evidence version 1 saved.");

  const identityDatabase = new DatabaseSync(databasePath);
  try {
    const row = identityDatabase.prepare(`
      SELECT id, documents_json FROM mortgage_evidence_versions
      ORDER BY version_number DESC LIMIT 1
    `).get() as { id: string; documents_json: string };
    const documents: unknown = JSON.parse(row.documents_json);
    if (!Array.isArray(documents)) throw new Error("Expected mortgage evidence documents.");
    for (const document of documents) {
      const evidenceDocument = getRecord(document, "mortgage evidence document");
      const identityFingerprint = getRecord(
        evidenceDocument["identityFingerprint"],
        "mortgage identity fingerprint"
      );
      const currentKeyId = identityFingerprint["keyId"];
      if (typeof currentKeyId !== "string") {
        throw new Error("Expected a mortgage identity fingerprint.");
      }
      identityFingerprint["keyId"] = currentKeyId === "0000000000000000"
        ? "1111111111111111"
        : "0000000000000000";
    }
    identityDatabase.prepare(
      "UPDATE mortgage_evidence_versions SET documents_json = ? WHERE id = ?"
    ).run(JSON.stringify(documents), row.id);
  } finally {
    identityDatabase.close();
  }

  await electronApp.evaluate((_, paths: string[]) => {
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = "selected";
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = JSON.stringify(paths);
  }, filePaths);
  await importPanel.getByRole("button", {
    name: "Choose mortgage HTML files",
    exact: true,
  }).click();
  preview = window.getByRole("region", {
    name: "Mortgage evidence preview for Rogaland mortgage",
    exact: true,
  });

  const identityCheckResults = preview.getByRole("region", {
    name: "Mortgage identity check results",
    exact: true,
  });
  await expect(identityCheckResults).toContainText(
    "Source pages: references and currency match."
  );
  await expect(identityCheckResults).toContainText(
    "Saved loan reference: not checked; this evidence uses another installation's identity key."
  );
  await expect(preview).toContainText("Schedule consistency: valid.");
  await expect(preview).not.toContainText("loan-123");

  const revealReferences = preview.getByRole("button", {
    name: "Reveal source loan references",
    exact: true,
  });
  const confirmUnavailableIdentity = preview.getByRole("button", {
    name: "I understand; confirm attachment to Rogaland mortgage",
    exact: true,
  });
  await expect(confirmUnavailableIdentity).toBeDisabled();
  await revealReferences.focus();
  await window.keyboard.press("Enter");
  const revealedReferences = preview.getByRole("region", {
    name: "Revealed source loan references",
    exact: true,
  });
  await expect(revealedReferences).toBeFocused();
  await expect(revealedReferences).toContainText("Loan details: loan-123");
  await expect(revealedReferences).toContainText("Repayment plan: loan-123");
  expect(await window.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ))).toBe(false);
  const identityAcknowledgement = preview.getByRole("checkbox", {
    name: "I reviewed these references and understand that the saved loan identity could not be verified.",
    exact: true,
  });
  await expect(confirmUnavailableIdentity).toBeDisabled();
  await identityAcknowledgement.focus();
  await window.keyboard.press("Space");
  await expect(confirmUnavailableIdentity).toBeEnabled();
  await confirmUnavailableIdentity.focus();
  await window.keyboard.press("Enter");
  await expect(preview.getByText(
    "You confirmed this evidence belongs to the selected loan; its saved identity could not be checked.",
    { exact: true }
  )).toBeFocused();
  await expect(identityCheckResults).toContainText(
    "Saved loan reference: not checked; this evidence uses another installation's identity key."
  );

  await preview.getByRole("checkbox", {
    name: "I reviewed the source differences. Saved loan terms and actual balances remain unchanged.",
    exact: true,
  }).check();
  await preview.getByRole("button", {
    name: "Accept mortgage evidence",
    exact: true,
  }).click();
  await expect(loan).toContainText("Evidence version 2 saved.");
  const evidence = await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.mortgageImport.listEvidenceSummaries());
  expect(evidence[1]?.attachment).toMatchObject({
    status: "confirmed",
    identityCheck: "unavailable",
  });
});

test("shows full-year monthly sums beside the annual mortgage summary", async ({
  appShell,
  electronApp,
  window,
}) => {
  await window.clock.install({ time: new Date("2027-01-21T12:00:00.000Z") });
  await appShell.openWorkspace("Loans");
  const loans = new LoanRegistryPage(window);
  await loans.addLoan({
    label: "Rogaland mortgage",
    principal: "100000",
    annualInterestRate: "5",
    termYears: "25",
    paymentAmount: "1000",
    paymentFrequency: "monthly",
    currencyCode: "NOK",
  });
  const filePaths = [
    join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-full-year-mortgage-schedule.html"),
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
  await importPanel.getByRole("button", {
    name: "Choose mortgage HTML files",
    exact: true,
  }).click();

  const preview = window.getByRole("region", {
    name: "Mortgage evidence preview for Rogaland mortgage",
    exact: true,
  });
  const yearEndCheckpoint = preview.getByRole("group", {
    name: "First year-end source checkpoint",
    exact: true,
  });
  const yearEndSummary = yearEndCheckpoint.getByRole("button", {
    name: /First year-end source checkpoint/,
  });
  await expect(yearEndSummary).toContainText("Source period: 2026");
  await expect(yearEndSummary).toContainText("annual");
  await expect(yearEndSummary).toContainText("2 400,00");
  const monthlySums = yearEndCheckpoint.getByRole("group", {
    name: "Full-year monthly sums",
    exact: true,
  });
  await expect(monthlySums).toBeHidden();
  await yearEndSummary.click();
  await expect(monthlySums).toBeVisible();
  await expect(monthlySums).toContainText("Payment sum");
  await expect(monthlySums).toContainText("Principal sum");
  await expect(monthlySums).toContainText("2 400,00");
  await expect(monthlySums).toContainText("1 200,00");
  await expect(monthlySums).toContainText("December projected closing balance");
  await expect(monthlySums).toContainText("998 800,00");
});

test("uses saved currency only after confirming the sanitized Rogaland bank layout", async ({
  appShell,
  electronApp,
  window,
}) => {
  await window.clock.install({ time: new Date("2026-11-21T12:00:00.000Z") });
  await appShell.openWorkspace("Loans");
  const loans = new LoanRegistryPage(window);
  await loans.addLoan({
    label: "Rogaland mortgage",
    principal: "100000",
    annualInterestRate: "5",
    termYears: "25",
    paymentAmount: "1000",
    paymentFrequency: "monthly",
    currencyCode: "NOK",
  });
  const filePaths = [
    join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-11-mortgage-details-bank-layout.html"),
    join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-11-mortgage-schedule-bank-layout.html"),
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
  await importPanel.getByRole("button", {
    name: "Choose mortgage HTML files",
    exact: true,
  }).click();
  const preview = window.getByRole("region", {
    name: "Mortgage evidence preview for Rogaland mortgage",
    exact: true,
  });
  const details = preview.getByRole("group", { name: "Loan details evidence", exact: true });

  await expect(preview).toContainText("Attachment confirmation required.");
  await expect(details).toContainText("Not identified");
  await expect(preview).not.toContainText("Matches saved value.");
  await preview.getByRole("button", {
    name: "Confirm attachment to Rogaland mortgage using NOK",
    exact: true,
  }).click();

  await expect(details).toContainText("NOK (saved loan currency)");
  await expect(preview).toContainText("Matches saved value.");
  const schedule = preview.getByRole("group", {
    name: "Repayment schedule evidence",
    exact: true,
  });
  await expect(schedule).toContainText(/Schedule rows\s*3/);
  await expect(preview.getByRole("group", {
    name: "Current month source checkpoint",
    exact: true,
  })).toContainText("November 2026");
  await expect(preview.getByRole("group", {
    name: "First year-end source checkpoint",
    exact: true,
  })).toContainText(
    "Monthly detail covers 2 of 12 months; partial coverage is not comparable to the annual summary."
  );
  await expect(preview).toContainText("Source date not identified.");

  const partialAcceptance = preview.getByRole("checkbox", {
    name: "Accept this partial evidence version; unsupported values remain unknown.",
    exact: true,
  });
  await partialAcceptance.check();
  await preview.getByRole("button", {
    name: "Accept mortgage evidence",
    exact: true,
  }).click();
  await expect(importPanel.getByRole("status")).toContainText("Evidence version 1 saved.");
});

test("shows and requires review of an unsupported source loan type", async ({
  appShell,
  electronApp,
  window,
}) => {
  await appShell.openWorkspace("Loans");
  const loans = new LoanRegistryPage(window);
  await loans.addLoan({
    label: "Rogaland mortgage",
    principal: "100000",
    annualInterestRate: "5",
    termYears: "25",
    paymentAmount: "1000",
    paymentFrequency: "monthly",
    currencyCode: "NOK",
  });
  const filePaths = [
    join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-11-mortgage-details-product-type.html"),
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
  await importPanel.getByRole("button", {
    name: "Choose mortgage HTML files",
    exact: true,
  }).click();
  const preview = window.getByRole("region", {
    name: "Mortgage evidence preview for Rogaland mortgage",
    exact: true,
  });
  await expect(preview).toContainText("Lånetype");
  await expect(preview).toContainText("Rammelån");
  await preview.getByRole("button", {
    name: "Confirm attachment to Rogaland mortgage",
    exact: true,
  }).click();
  await expect(preview).toContainText(
    "Some evidence is partial. Review the available source details before accepting."
  );
  const acceptPartial = preview.getByRole("checkbox", {
    name: "Accept this partial evidence version; unsupported values remain unknown.",
    exact: true,
  });
  const acceptButton = preview.getByRole("button", {
    name: "Accept mortgage evidence",
    exact: true,
  });
  await expect(acceptButton).toBeDisabled();
  await acceptPartial.check();
  await expect(acceptButton).toBeEnabled();
  await acceptButton.click();
  await expect(importPanel.getByRole("status")).toContainText("Evidence version 1 saved.");
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
  await expect(importPanel.getByText(
    "Select the saved loan-details page, repayment-plan page, or both. A single supported page can be reviewed as partial evidence.",
    { exact: true }
  )).toBeVisible();
  const chooseFilesButton = importPanel.getByRole("button", {
    name: "Choose mortgage HTML files",
    exact: true,
  });
  await expect(chooseFilesButton).toBeDisabled();
  await importPanel.getByLabel("Currency code", { exact: true }).fill("NOK");
  await expect(chooseFilesButton).toBeEnabled();
  await chooseFilesButton.click();

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
  await importPanel.getByRole("button", {
    name: "Choose mortgage HTML files",
    exact: true,
  }).click();
  const preview = window.getByRole("region", {
    name: "Mortgage evidence preview for Rogaland mortgage",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Cancel import", exact: true }).click();
  await expect(importPanel.getByRole("status").filter({
    hasText: "Import canceled. No loan data was changed.",
  })).toBeVisible();

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
  await importPanel.getByRole("button", {
    name: "Choose mortgage HTML files",
    exact: true,
  }).click();
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

test("changing incomplete-loan context during a read allows a fresh preview", async ({
  appShell,
  electronApp,
  window,
}) => {
  await appShell.openWorkspace("Loans");
  const filePaths = [
    join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-11-mortgage-details.html"),
  ];
  await electronApp.evaluate((_, paths: string[]) => {
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = "selected";
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = JSON.stringify(paths);
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DELAY_MS"] = "1500";
  }, filePaths);

  await window.getByRole("button", {
    name: "Import as incomplete loan",
    exact: true,
  }).click();
  const importPanel = window.getByRole("region", {
    name: "Mortgage evidence import for an incomplete loan",
    exact: true,
  });
  await importPanel.getByLabel("Loan label", { exact: true }).fill("Initial sample");
  await importPanel.getByLabel("Currency code", { exact: true }).fill("NOK");
  await importPanel.getByRole("button", {
    name: "Choose mortgage HTML files",
    exact: true,
  }).click();
  await expect(importPanel.getByRole("button", {
    name: "Cancel reading mortgage evidence",
    exact: true,
  })).toBeVisible();

  await importPanel.getByLabel("Loan label", { exact: true }).fill("Updated sample");
  const chooseFilesButton = importPanel.getByRole("button", {
    name: "Choose mortgage HTML files",
    exact: true,
  });
  await expect(chooseFilesButton).toBeEnabled();
  await chooseFilesButton.click();

  const preview = window.getByRole("region", {
    name: "Mortgage evidence preview for Updated sample",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Cancel import", exact: true }).click();
  await expect(importPanel.getByRole("status").filter({
    hasText: "Import canceled. No loan data was changed.",
  })).toBeVisible();

  const sourceOnlyLoans = await window.evaluate(() => (
    globalThis as typeof globalThis & { budgetApi: BudgetApi }
  ).budgetApi.loanRegistry.listSourceOnly());
  expect(sourceOnlyLoans).toEqual([]);
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
  await importPanel.getByLabel("Currency code", { exact: true }).fill("NOK");
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
