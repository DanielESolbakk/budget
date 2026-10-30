import { test, expect } from "./fixtures/electron.js";

for (const width of [1440, 390]) {
  test.describe(`visual polish at ${width}px`, () => {
    test.beforeEach(async ({ electronApp, window }) => {
      await electronApp.evaluate(({ BrowserWindow }, width) => {
        const browser = BrowserWindow.getAllWindows()[0];
        if (browser === undefined) throw new Error("Electron window is unavailable.");
        browser.setContentSize(width, 1000);
      }, width);
      await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(width);
    });

    test("an empty category queue leaves room for the ledger and retains its explanation", async ({
      ledger, window,
    }) => {
      await expect(ledger.table).toBeVisible();
      const review = window.getByRole("region", { name: "Categorization Review", exact: true });
      const confirmation = review.getByText("No category decisions need review.", { exact: true });
      await expect(confirmation).toBeVisible();
      expect(await review.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThanOrEqual(180);
      const explanation = review.getByText(
        "Uncategorized transactions and low-confidence categorizations from CSV/PDF imports or manual entry will appear here.",
        { exact: true },
      );
      await expect(explanation).toBeHidden();
      await review.locator("summary").focus();
      await window.keyboard.press("Enter");
      await expect(explanation).toBeVisible();
      await expect(ledger.resultStatus).toContainText("4 ledger transactions");
    });

    test("statement import has stronger emphasis than manual entry and row actions", async ({
      appShell, ledger, window,
    }) => {
      const allocation = ledger.section.getByRole("button", {
        name: "Edit category allocations for Rema 1000", exact: true,
      });
      await expect(allocation).toBeVisible();
      const rowBackground = await allocation.evaluate((node) => getComputedStyle(node).backgroundColor);
      await appShell.openWorkspace("Import");
      const primary = window.getByRole("button", { name: "Choose statement file", exact: true });
      const manual = window.getByRole("button", { name: "Enter transaction manually", exact: true });
      await expect(manual).toBeVisible();
      const primaryBackground = await primary.evaluate((node) => getComputedStyle(node).backgroundColor);
      expect.soft(rowBackground).not.toBe(primaryBackground);
      expect(await manual.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(primaryBackground);
      await manual.click();
      await expect(window.getByRole("button", { name: "Add transaction", exact: true })).toBeVisible();
    });

    test("workspace descriptions stay directly beneath their titles", async ({ appShell }) => {
      for (const name of ["Transactions", "Import", "Properties", "Loans", "Investments", "Coverage", "Pending", "Data safety", "Settings"] as const) {
        await appShell.openWorkspace(name);
        const header = appShell.workspace(name).locator(".destination-heading");
        const title = await header.getByRole("heading").boundingBox();
        const description = await header.locator("p").boundingBox();
        if (title === null || description === null) throw new Error(`${name} header is not visible.`);
        expect.soft(description.y, `${name} description must follow its title`).toBeGreaterThanOrEqual(title.y + title.height + 4);
        expect.soft(Math.abs(description.x - title.x), `${name} header must share a left edge`).toBeLessThanOrEqual(1);
      }
    });

    test("financial comparisons and supporting lists align their amounts", async ({ dashboard, window }) => {
      await dashboard.monthSelector.selectOption("2026-05");
      const values = dashboard.targetVsActualSection.locator('tbody td:not([data-label="Category"])');
      await expect(values.first()).toBeVisible();
      const comparison = await dashboard.targetVsActualSection.boundingBox();
      if (comparison === null) throw new Error("The category comparison must be visible.");
      for (const value of await values.all()) {
        expect.soft(await value.evaluate((node) => getComputedStyle(node).textAlign)).toBe("right");
        const bounds = await value.boundingBox();
        if (bounds === null) throw new Error("Every comparison amount must be visible.");
        expect.soft(bounds.x + bounds.width, `${await value.getAttribute("data-label")} must fit the comparison`)
          .toBeLessThanOrEqual(comparison.x + comparison.width);
      }
      const categories = dashboard.categoryEntries;
      await expect(categories).toHaveCount(2);
      for (const row of await categories.all()) {
        await expect(row.locator("span")).toHaveCount(2);
        const label = await row.locator("span").first().boundingBox();
        const amount = await row.locator("span").last().boundingBox();
        expect.soft(await row.evaluate((node) => getComputedStyle(node).listStyleType)).toBe("none");
        if (label === null || amount === null) throw new Error("Category amounts must be visible.");
        expect.soft(amount.x).toBeGreaterThan(label.x + label.width);
      }
      const forecastRows = window.getByRole("region", { name: "Forecast", exact: true }).getByRole("listitem");
      await expect(forecastRows).toHaveCount(3);
      for (const row of await forecastRows.all()) {
        expect.soft(await row.evaluate((node) =>
          Array.from(node.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent).join("").trim(),
        )).toBe("");
      }
    });

    test("quick filters form aligned rows and keep their selection behavior", async ({ ledger }) => {
      const filters = ledger.filterForm.locator(".ledger-quick-filters");
      await expect(ledger.table).toBeVisible();
      const heights = await filters.locator(":scope > *").evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().height),
      );
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
      const income = filters.getByRole("button", { name: "Quick filter Income", exact: true });
      await income.click();
      await expect(income).toHaveAttribute("aria-pressed", "true");
      await expect(ledger.resultStatus).toContainText("2 ledger transactions");
      await income.click();
      await expect(income).toHaveAttribute("aria-pressed", "false");
      await expect(ledger.resultStatus).toContainText("4 ledger transactions");
      const bounds = await filters.boundingBox();
      if (bounds === null) throw new Error("Quick filters must be visible.");
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    });

    test("empty household registries group their message with the existing creation action", async ({
      appShell, window,
    }) => {
      for (const [name, message, action] of [
        ["Properties", "No properties have been recorded.", "Add property"],
        ["Loans", "No loans have been recorded.", "Add loan"],
      ] as const) {
        await appShell.openWorkspace(name);
        const setup = appShell.workspace(name).locator(".registry-empty-state");
        await expect(setup.getByText(message, { exact: true })).toBeVisible();
        await setup.getByRole("button", { name: action, exact: true }).click();
        const form = window.getByRole("form", { name: action, exact: true });
        await expect(form).toBeVisible();
        await form.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(setup.getByRole("button", { name: action, exact: true })).toBeFocused();
      }
      await appShell.openWorkspace("Investments");
      const setup = appShell.workspace("Investments").locator(".registry-empty-state");
      await expect(setup.getByText("No investment holdings have been recorded.", { exact: true })).toBeVisible();
      await expect(setup.getByRole("form", { name: "Add investment holding", exact: true })).toBeVisible();
    });
  });
}
