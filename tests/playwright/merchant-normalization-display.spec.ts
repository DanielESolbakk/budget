import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { LedgerPage } from "./pom/LedgerPage.js";
import { ReviewQueuePage } from "./pom/ReviewQueuePage.js";

const temporaryDirectories = new Set<string>();

async function expectTextNotClipped(locator: ReturnType<LedgerPage["transaction"]>): Promise<void> {
  await expect.poll(() => locator.evaluate((element) =>
    element.scrollWidth <= element.clientWidth &&
    element.scrollHeight <= element.clientHeight
  )).toBe(true);
}

function writeMerchantFixture(merchantRaw: string): string {
  const directory = mkdtempSync(join(tmpdir(), "budget-playwright-merchant-alias-"));
  temporaryDirectories.add(directory);
  const filePath = join(directory, "merchant-alias.csv");
  writeFileSync(
    filePath,
    `Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta\n15.11.2026;;${merchantRaw};;-12.00;NOK\n`,
    "utf8"
  );
  return filePath;
}

test.afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

test.describe("standardized merchant display", () => {
  test("shows the unchanged source and standardized merchant in the ledger", async ({
    appShell,
    csvImport,
    window,
  }) => {
    const merchantRaw = "Fjord   Syntetisk AS";
    await window.setViewportSize({ width: 1280, height: 800 });
    await csvImport.submitImport(writeMerchantFixture(merchantRaw));
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });

    await appShell.openWorkspace("Transactions");
    const ledger = new LedgerPage(window);
    const transaction = ledger.transaction(merchantRaw);
    const standardizedMerchant = transaction.getByText(
      "Normalized from description: FJORD SYNTETISK",
      { exact: true }
    );

    await expect(transaction).toContainText(merchantRaw);
    await expect(standardizedMerchant).toBeVisible();
    await expectTextNotClipped(standardizedMerchant);

    await window.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => ledger.tableScrollContainer.evaluate((element) =>
      element.scrollWidth > element.clientWidth
    )).toBe(true);

    await ledger.tableScrollContainer.evaluate((element) => {
      element.scrollLeft = 0;
    });
    await ledger.tableScrollContainer.focus();
    await expect(ledger.tableScrollContainer).toBeFocused();
    await ledger.tableScrollContainer.press("ArrowRight");
    await expect.poll(() => ledger.tableScrollContainer.evaluate((element) =>
      element.scrollLeft
    )).toBeGreaterThan(0);
    await ledger.tableScrollContainer.press("ArrowLeft");
    await expect.poll(() => ledger.tableScrollContainer.evaluate((element) =>
      element.scrollLeft
    )).toBe(0);

    await standardizedMerchant.scrollIntoViewIfNeeded();
    await expect(transaction.getByText(merchantRaw, { exact: true })).toBeVisible();
    await expect(standardizedMerchant).toBeVisible();
    await expectTextNotClipped(standardizedMerchant);
  });

  test("does not repeat a merchant when normalization leaves its source unchanged", async ({
    appShell,
    csvImport,
    window,
  }) => {
    const merchantRaw = "KIWI";
    await window.setViewportSize({ width: 1280, height: 800 });
    await csvImport.submitImport(writeMerchantFixture(merchantRaw));
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });

    await appShell.openWorkspace("Transactions");
    const transaction = new LedgerPage(window).transaction(merchantRaw);

    await expect(transaction.getByText(merchantRaw, { exact: true })).toBeVisible();
    await expect(transaction.getByText(/^Normalized from description:/)).toHaveCount(0);
  });

  test("explains an empty standardized merchant while preserving the source in mobile review", async ({
    appShell,
    csvImport,
    window,
  }) => {
    const merchantRaw = "ASA";
    await window.setViewportSize({ width: 390, height: 844 });
    await csvImport.submitImport(writeMerchantFixture(merchantRaw));
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });

    await appShell.openWorkspace("Transactions");
    const reviewQueue = new ReviewQueuePage(window);
    const reviewItem = reviewQueue.reviewItem(merchantRaw);
    const standardizedMerchant = reviewItem.getByText(
      "Normalized from description: No name remains after normalization.",
      { exact: true }
    );

    await expect(reviewItem.getByText(merchantRaw, { exact: true })).toBeVisible();
    await expect(standardizedMerchant).toBeVisible();
    await expectTextNotClipped(standardizedMerchant);
  });
});
