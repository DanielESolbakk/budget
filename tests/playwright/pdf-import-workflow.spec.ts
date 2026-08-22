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

import { test, expect } from "./fixtures/electron.js";
import type { Request } from "@playwright/test";
import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-statement.txt");

/** Writes an unsupported text content to a temp file and returns the absolute path. */
function writeUnsupportedFixture(): string {
  const dir = join(tmpdir(), "budget-playwright-pdf");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `unsupported-${randomUUID()}.txt`);
  writeFileSync(path, "Not a supported bank statement format.\nSome other bank\n", "utf8");
  return path;
}

test.describe("PDF import renderer workflow", () => {
  test("Scenario 1: importing the supported synthetic text PDF fixture reports success and displays adapter identity", async ({ pdfImport, dashboard }) => {
    // AC-1: PDF import section is visible with file path input and button.
    await expect(pdfImport.importSection).toBeVisible();
    await expect(pdfImport.importHeading).toBeVisible();
    await expect(pdfImport.filePathInput).toBeVisible();
    await expect(pdfImport.importButton).toBeVisible();

    // Capture baseline dashboard income value before import.
    const monthSelector = dashboard.monthSelector;
    await monthSelector.selectOption("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = ((await dashboard.incomeValue.textContent()) ?? "").trim();

    // AC-1, AC-2: submit the fixture text path via the renderer input.
    await pdfImport.submitImport(FIXTURE_PATH);

    // AC-1: success status is shown after import.
    await expect(pdfImport.successStatus).toBeVisible({ timeout: 10_000 });
    const statusText = await pdfImport.successStatus.textContent();
    expect(statusText).toMatch(/transactions imported/i);

    // AC-4: adapter identity is shown in the success message.
    expect(statusText).toMatch(/rogaland-sparebank-text-v1/i);

    // The app reloads dashboard state after successful import and remounts the import section.
    await expect(pdfImport.filePathInput).toHaveValue("", { timeout: 10_000 });

    // AC-5: dashboard automatically reloads after import success.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect
      .poll(async () => ((await dashboard.incomeValue.textContent()) ?? "").trim(), {
        timeout: 10_000,
      })
      .not.toBe(beforeIncomeText);

    const beforeSecondImportIncomeText = ((await dashboard.incomeValue.textContent()) ?? "").trim();
    await pdfImport.filePathInput.fill(FIXTURE_PATH);
    await pdfImport.importButton.click();
    await expect(pdfImport.filePathInput).toHaveValue("", { timeout: 10_000 });
    await expect(pdfImport.successStatus).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(async () => ((await dashboard.incomeValue.textContent()) ?? "").trim(), {
        timeout: 10_000,
      })
      .toBe(beforeSecondImportIncomeText);
  });

  test("Scenario 2: importing an unsupported layout reports validation errors and leaves dashboard unchanged", async ({ pdfImport, dashboard }) => {
    // Ensure dashboard is in a known state before the invalid import.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = (await dashboard.incomeValue.textContent()) ?? "";

    const unsupportedPath = writeUnsupportedFixture();

    // AC-1, AC-3: submit unsupported layout path via renderer input.
    await pdfImport.submitImport(unsupportedPath);

    // AC-3: alert with validation failure is shown.
    await expect(pdfImport.errorAlert).toBeVisible({ timeout: 10_000 });
    const alertText = await pdfImport.errorAlert.textContent();
    expect(alertText).toMatch(/failed/i);

    // AC-5: dashboard totals remain unchanged after a failed import.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const afterIncomeText = (await dashboard.incomeValue.textContent()) ?? "";
    expect(afterIncomeText).toBe(beforeIncomeText);
  });

  test("Scenario 3: PDF import workflow runs under network guard with no outbound network calls", async ({ pdfImport, window }) => {
    // AC-5: verify the successful import path emits no external HTTP(S) request.
    const outboundRequests: string[] = [];
    const onRequest = (request: Request): void => {
      const requestUrl = new URL(request.url());
      const isExternalHttpRequest =
        (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") &&
        requestUrl.hostname !== "localhost" &&
        requestUrl.hostname !== "127.0.0.1";

      if (isExternalHttpRequest) {
        outboundRequests.push(requestUrl.href);
      }
    };

    window.on("request", onRequest);

    await pdfImport.submitImport(FIXTURE_PATH);

    await expect(pdfImport.successStatus).toBeVisible({ timeout: 10_000 });

    window.off("request", onRequest);
    expect(outboundRequests).toHaveLength(0);
  });
});
