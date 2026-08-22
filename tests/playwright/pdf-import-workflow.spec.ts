/**
 * Playwright runtime smoke tests for the PDF import renderer workflow.
 *
 * These tests launch the built Electron app and verify:
 *   - Scenario 1: Importing the supported synthetic text PDF fixture from the renderer
 *     reports success and the adapter ID is recorded in provenance (AC-1, AC-2, AC-4).
 *   - Scenario 2: Importing an unsupported layout reports validation errors and preserves
 *     the pre-import dashboard state (AC-1, AC-3).
 *   - Scenario 3: The import workflow runs under the network guard with no outbound calls (AC-5).
 *
 * Framework boundary:
 *   Vitest   -- unit, integration, and Vitest e2e smoke tests (tests/e2e/)
 *   Playwright -- Electron runtime flow validation (this file)
 *
 * Prerequisites: `npm run test:e2e:playwright` runs `npm run build` automatically via the
 * pretest script. To run manually first: `npm run build && npm run test:e2e:playwright`.
 */

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { PdfImportPage } from "./pom/PdfImportPage.js";
import { DashboardPage } from "./pom/DashboardPage.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");
const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-statement.txt");

/** Writes an unsupported text content to a temp file and returns the absolute path. */
function writeUnsupportedFixture(): string {
  const dir = join(tmpdir(), "budget-playwright-pdf");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `unsupported-${Date.now()}.txt`);
  writeFileSync(path, "Not a supported bank statement format.\nSome other bank\n", "utf8");
  return path;
}

test.describe("PDF import renderer workflow", () => {
  let app: ElectronApplication;
  let window: Page;
  let pdfImportPage: PdfImportPage;
  let dashboardPage: DashboardPage;

  test.beforeEach(async () => {
    const databasePath = join(tmpdir(), "budget-playwright-pdf", randomUUID(), "budget.sqlite");
    app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: "test", BUDGET_DB_PATH: databasePath },
    });
    window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    pdfImportPage = new PdfImportPage(window);
    dashboardPage = new DashboardPage(window);
  });

  test.afterEach(async () => {
    await app.close();
  });

  test("Scenario 1: importing the supported synthetic text PDF fixture reports success and displays adapter identity", async () => {
    // AC-1: PDF import section is visible with file path input and button.
    await expect(pdfImportPage.importSection).toBeVisible();
    await expect(pdfImportPage.importHeading).toBeVisible();
    await expect(pdfImportPage.filePathInput).toBeVisible();
    await expect(pdfImportPage.importButton).toBeVisible();

    // Capture baseline dashboard income value before import.
    const monthSelector = dashboardPage.monthSelector;
    await monthSelector.selectOption("2026-05");
    await expect(dashboardPage.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = ((await dashboardPage.incomeValue.textContent()) ?? "").trim();

    // AC-1, AC-2: submit the fixture text path via the renderer input.
    await pdfImportPage.submitImport(FIXTURE_PATH);

    // AC-1: success status is shown after import.
    await expect(pdfImportPage.successStatus).toBeVisible({ timeout: 10_000 });
    const statusText = await pdfImportPage.successStatus.textContent();
    expect(statusText).toMatch(/transactions imported/i);

    // AC-4: adapter identity is shown in the success message.
    expect(statusText).toMatch(/rogaland-sparebank-text-v1/i);
    const firstSuccessStatusText = statusText ?? "";

    // The app reloads dashboard state after successful import and remounts the import section.
    await expect(pdfImportPage.filePathInput).toHaveValue("", { timeout: 10_000 });

    // AC-5: dashboard automatically reloads after import success.
    await expect(dashboardPage.monthlyTotalsSection).toBeVisible();
    await expect
      .poll(async () => ((await dashboardPage.incomeValue.textContent()) ?? "").trim(), {
        timeout: 10_000,
      })
      .not.toBe(beforeIncomeText);

    const beforeSecondImportIncomeText = ((await dashboardPage.incomeValue.textContent()) ?? "").trim();
    await pdfImportPage.submitImport(FIXTURE_PATH);
    await expect
      .poll(async () => (await pdfImportPage.successStatus.textContent()) ?? "", {
        timeout: 10_000,
      })
      .not.toBe(firstSuccessStatusText);
    await expect(pdfImportPage.successStatus).toBeVisible({ timeout: 10_000 });
    await expect(pdfImportPage.filePathInput).toHaveValue("", { timeout: 10_000 });
    await expect
      .poll(async () => ((await dashboardPage.incomeValue.textContent()) ?? "").trim(), {
        timeout: 10_000,
      })
      .toBe(beforeSecondImportIncomeText);
  });

  test("Scenario 2: importing an unsupported layout reports validation errors and leaves dashboard unchanged", async () => {
    // Ensure dashboard is in a known state before the invalid import.
    await expect(dashboardPage.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = (await dashboardPage.incomeValue.textContent()) ?? "";

    const unsupportedPath = writeUnsupportedFixture();

    // AC-1, AC-3: submit unsupported layout path via renderer input.
    await pdfImportPage.submitImport(unsupportedPath);

    // AC-3: alert with validation failure is shown.
    await expect(pdfImportPage.errorAlert).toBeVisible({ timeout: 10_000 });
    const alertText = await pdfImportPage.errorAlert.textContent();
    expect(alertText).toMatch(/failed/i);

    // AC-5: dashboard totals remain unchanged after a failed import.
    await expect(dashboardPage.monthlyTotalsSection).toBeVisible();
    const afterIncomeText = (await dashboardPage.incomeValue.textContent()) ?? "";
    expect(afterIncomeText).toBe(beforeIncomeText);
  });

  test("Scenario 3: PDF import workflow runs under network guard with no outbound network calls", async () => {
    // AC-5: verify the network guard is active — import:pdf must not trigger network.
    const networkErrorMessages: string[] = [];
    const onConsole = (msg: { type: () => string; text: () => string }): void => {
      if (msg.type() === "error" && msg.text().toLowerCase().includes("network")) {
        networkErrorMessages.push(msg.text());
      }
    };

    window.on("console", onConsole);

    const unsupportedPath = writeUnsupportedFixture();
    await pdfImportPage.filePathInput.fill(unsupportedPath);

    await pdfImportPage.importButton.click();

    await expect(pdfImportPage.errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(pdfImportPage.errorAlert).toContainText(/failed/i);

    window.off("console", onConsole);
    expect(networkErrorMessages).toHaveLength(0);
  });
});
