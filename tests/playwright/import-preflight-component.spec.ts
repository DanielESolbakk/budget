import { test as base, expect } from "@playwright/test";
import { resolve } from "node:path";
import type { mountImportComponent } from "./fixtures/importComponentHarness.js";

type Harness = ReturnType<typeof mountImportComponent>;
declare global {
  interface Window { importComponentHarness: Harness }
}

const test = base.extend<{ format: "csv" | "pdf"; component: void }>({
  format: ["csv", { option: true }],
  component: [async ({ page, format }, use) => {
    await page.goto("/");
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const modulePath = `/@fs/${resolve("tests", "playwright", "fixtures", "importComponentHarness.ts").replaceAll("\\", "/")}`;
    await page.evaluate(async ({ selectedFormat, modulePath }) => {
      const { mountImportComponent } = await import(modulePath);
      window.importComponentHarness = mountImportComponent(selectedFormat);
    }, { selectedFormat: format, modulePath });
    await use();
    await page.evaluate(() => window.importComponentHarness.dispose());
    expect(pageErrors).toEqual([]);
  }, { auto: true }],
});

for (const format of ["csv", "pdf"] as const) {
  test.describe(`${format} renderer preflight contract`, () => {
    test.use({ format });
    const previewLabel = format === "csv" ? "Preview CSV" : "Preview statement";

    test("success finalizes progress and displays the preview", async ({ page }) => {
      await page.getByRole("button", { name: previewLabel, exact: true }).click();
      await page.evaluate(() => {
        const harness = window.importComponentHarness;
        harness.settle(harness.requests[0]!, "success");
      });
      await expect(page.getByRole("button", { name: "Hide preview", exact: true })).toBeVisible();
      await expect(page.getByRole("status", { name: "Import preflight progress" })).toHaveCount(0);
    });

    test("cancelled response finalizes with cancellation feedback", async ({ page }) => {
      await page.getByRole("button", { name: previewLabel, exact: true }).click();
      await page.getByRole("button", { name: "Cancel preview", exact: true }).click();
      await page.evaluate(() => {
        const harness = window.importComponentHarness;
        harness.settle(harness.requests[0]!, "cancelled");
      });
      await expect(page.getByRole("status", { name: "Import preflight progress" }))
        .toContainText("Preview cancelled. No transactions were saved.");
      await expect(page.getByRole("button", { name: previewLabel, exact: true })).toBeEnabled();
    });

    test("failed response permits retry without leftover progress", async ({ page }) => {
      await page.getByRole("button", { name: previewLabel, exact: true }).click();
      await page.evaluate(() => {
        const harness = window.importComponentHarness;
        harness.settle(harness.requests[0]!, "error");
      });
      await expect(page.getByRole("alert")).toContainText("Synthetic preview failure");
      await expect(page.getByRole("button", { name: previewLabel, exact: true })).toBeEnabled();
      await expect(page.getByRole("status", { name: "Import preflight progress" })).toHaveCount(0);
    });

    test("cancellation failure is visible without losing the active preview", async ({ page }) => {
      await page.getByRole("button", { name: previewLabel, exact: true }).click();
      await page.evaluate(() => window.importComponentHarness.failCancellation());
      await page.getByRole("button", { name: "Cancel preview", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Synthetic cancellation failure");
      await expect(page.getByRole("button", { name: "Cancel preview", exact: true })).toBeVisible();
      await page.evaluate(() => {
        const harness = window.importComponentHarness;
        harness.settle(harness.requests[0]!, "success");
      });
      await expect(page.getByRole("button", { name: "Hide preview", exact: true })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
    });

    for (const context of ["file", "account"] as const) {
      test(`ignores a late preview after ${context} changes`, async ({ page }) => {
        await page.getByRole("button", { name: previewLabel, exact: true }).click();
        await page.evaluate((change) => {
          const harness = window.importComponentHarness;
          if (change === "file") harness.changeFile();
          else harness.changeAccount("synthetic-second-account");
        }, context);
        await expect(page.getByRole("button", { name: previewLabel, exact: true })).toBeEnabled();
        await expect.poll(() => page.evaluate(() => {
          const harness = window.importComponentHarness;
          return harness.cancelled.includes(harness.requests[0]!);
        })).toBe(true);
        await page.evaluate(() => {
          const harness = window.importComponentHarness;
          harness.settle(harness.requests[0]!, "success");
        });
        await expect(page.getByRole("button", { name: previewLabel, exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Hide preview", exact: true })).toHaveCount(0);
      });
    }

    test("an old rejection cannot finalize or overwrite a newer request", async ({ page }) => {
      await page.getByRole("button", { name: previewLabel, exact: true }).click();
      await page.evaluate(() => window.importComponentHarness.changeFile());
      await expect(page.getByRole("button", { name: previewLabel, exact: true })).toBeEnabled();
      await page.getByRole("button", { name: previewLabel, exact: true }).click();
      await page.evaluate((currentFormat) => {
        const harness = window.importComponentHarness;
        harness.progress(harness.requests[1]!, "New request");
        harness.progress(harness.requests[0]!, "Obsolete progress");
        harness.progress(harness.requests[1]!, "Other format", currentFormat === "csv" ? "pdf" : "csv");
        harness.settle(harness.requests[0]!, "error");
      }, format);
      await expect(page.getByRole("status", { name: "Import preflight progress" })).toContainText("New request");
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page.evaluate(() => {
        const harness = window.importComponentHarness;
        harness.settle(harness.requests[1]!, "success");
      });
      await expect(page.getByRole("button", { name: "Hide preview", exact: true })).toBeVisible();
    });

    test("unmount cancels the active request and removes progress subscription", async ({ page }) => {
      await page.getByRole("button", { name: previewLabel, exact: true }).click();
      await page.evaluate(() => window.importComponentHarness.unmount());
      await expect.poll(() => page.evaluate(() => {
        const harness = window.importComponentHarness;
        return harness.cancelled.includes(harness.requests[0]!);
      })).toBe(true);
      expect(await page.evaluate(() => window.importComponentHarness.listenerCount())).toBe(0);
      await page.evaluate(() => {
        const harness = window.importComponentHarness;
        harness.settle(harness.requests[0]!, "success");
      });
    });
  });
}

test("CSV mapping changes cancel an active update and permit a new preview", async ({ page }) => {
  await page.getByRole("button", { name: "Preview CSV", exact: true }).click();
  await page.evaluate(() => {
    const harness = window.importComponentHarness;
    harness.settle(harness.requests[0]!, "success");
  });
  await page.getByRole("combobox", { name: "Map Description", exact: true }).selectOption("Description");
  await page.getByRole("button", { name: "Update preview", exact: true }).click();
  await page.getByRole("combobox", { name: "Map Description", exact: true }).selectOption("");
  await expect(page.getByRole("button", { name: "Update preview", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const harness = window.importComponentHarness;
    harness.settle(harness.requests[1]!, "success");
  });
  await expect(page.getByRole("button", { name: "Update preview", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Update preview", exact: true }).click();
  await page.evaluate(() => {
    const harness = window.importComponentHarness;
    harness.settle(harness.requests[2]!, "success");
  });
  await expect(page.getByRole("button", { name: "Hide preview", exact: true })).toBeVisible();
});

for (const outcome of ["success", "error"] as const) {
  test(`CSV mapping stays locked until confirmation finishes with ${outcome}`, async ({ page }) => {
    await page.getByRole("button", { name: "Preview CSV", exact: true }).click();
    await page.evaluate(() => {
      const harness = window.importComponentHarness;
      harness.settle(harness.requests[0]!, "success");
      harness.holdCsvConfirmation();
    });
    const confirmation = page.getByRole("button", { name: "Confirm CSV import", exact: true });
    const mapping = page.getByRole("combobox", { name: "Map Description", exact: true });
    await confirmation.click();
    await expect(confirmation).toBeDisabled();
    await expect(mapping).toBeDisabled();
    await expect(page.getByRole("button", { name: "Hide preview", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel preview", exact: true })).toHaveCount(0);
    await page.evaluate((result) => window.importComponentHarness.settleCsvConfirmation(result), outcome);
    if (outcome === "success") {
      await expect(page.getByRole("heading", { name: "Import complete", exact: true })).toBeVisible();
      await expect(mapping).toHaveCount(0);
    } else {
      await expect(page.getByRole("alert")).toContainText("Synthetic confirmation failure");
      await expect(mapping).toBeEnabled();
      await mapping.selectOption("Description");
      await expect(confirmation).toBeDisabled();
      await expect(page.getByRole("button", { name: "Update preview", exact: true })).toBeEnabled();
    }
  });
}
