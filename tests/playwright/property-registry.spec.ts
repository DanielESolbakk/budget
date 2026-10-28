import { DatabaseSync } from "node:sqlite";
import { _electron as electron } from "@playwright/test";
import { dirname, join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import { PropertyRegistryPage } from "./pom/PropertyRegistryPage.js";
import {
  installMainProcessNetworkProbe,
  mainProcessNetworkRequests,
} from "./helpers/networkProbe.js";
import {
  installRendererNetworkAttemptBlocker,
  installRendererNetworkAttemptObserver,
  rendererNetworkBlockedAttempts,
  rendererNetworkAttempts,
} from "./helpers/rendererNetworkProbe.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

test("property history survives a restart without converting currency or using the network", async ({
  appShell,
  databasePath,
  electronApp,
  window,
}) => {
  await window.setViewportSize({ width: 1280, height: 800 });
  await installRendererNetworkAttemptBlocker(window);
  await installMainProcessNetworkProbe(electronApp);
  const rendererNetworkObservation = await installRendererNetworkAttemptObserver(window);
  await appShell.openWorkspace("Data safety");
  const registry = new PropertyRegistryPage(window);
  await expect(registry.section.getByRole("heading", { name: "Property registry" })).toBeVisible();
  await expect(registry.propertyLabelInput).toBeInViewport();
  await expect(window.evaluate(() => (
    globalThis as typeof globalThis & {
      budgetApi: { exchangeRates: { list: (currencyCode: string) => Promise<unknown[]> } };
    }
  ).budgetApi.exchangeRates.list("EUR"))).resolves.toEqual([]);

  await registry.addProperty("Home");
  await registry.addValuation("Home", {
    effectiveDate: "2026-10-01",
    amount: "5000000",
    currencyCode: "NOK",
  });
  await registry.addValuation("Home", {
    effectiveDate: "2026-11-01",
    amount: "450000",
    currencyCode: "EUR",
  });

  await expect(registry.valuationHistory("Home").getByRole("row")).toHaveCount(3);
  await expect(registry.valuationRow("Home", "2026-10-01")).toContainText("NOK");
  await expect(registry.valuationRow("Home", "2026-10-01")).toContainText(
    /5[\s\u00a0\u202f]000[\s\u00a0\u202f]000,00/
  );
  await expect(registry.valuationRow("Home", "2026-11-01")).toContainText("EUR");
  await expect(registry.valuationRow("Home", "2026-11-01")).toContainText(
    /450[\s\u00a0\u202f]000,00/
  );
  const nokValuationBeforeRestart = await registry
    .valuationRow("Home", "2026-10-01")
    .getByRole("cell")
    .allTextContents();
  const eurValuationBeforeRestart = await registry
    .valuationRow("Home", "2026-11-01")
    .getByRole("cell")
    .allTextContents();
  expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
  expect(await rendererNetworkAttempts(window)).toEqual([]);
  expect(await rendererNetworkBlockedAttempts(window)).toEqual([]);
  expect(rendererNetworkObservation.httpRequests).toEqual([]);
  expect(rendererNetworkObservation.webSocketRequests).toEqual([]);
  const propertyRecordsBeforeRestart = await window.evaluate(() => (
    globalThis as typeof globalThis & {
      budgetApi: { propertyRegistry: { list: () => Promise<unknown[]> } };
    }
  ).budgetApi.propertyRegistry.list());

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
    const restartedNetworkObservation = await installRendererNetworkAttemptObserver(restartedWindow);
    await new AppShellPage(restartedWindow).openWorkspace("Data safety");
    const restartedRegistry = new PropertyRegistryPage(restartedWindow);
    const propertyRecordsAfterRestart = await restartedWindow.evaluate(() => (
      globalThis as typeof globalThis & {
        budgetApi: { propertyRegistry: { list: () => Promise<unknown[]> } };
      }
    ).budgetApi.propertyRegistry.list());

    expect(propertyRecordsAfterRestart).toEqual(propertyRecordsBeforeRestart);
    await expect(restartedRegistry.valuationRow("Home", "2026-10-01").getByRole("cell"))
      .toHaveText(nokValuationBeforeRestart);
    await expect(restartedRegistry.valuationRow("Home", "2026-11-01").getByRole("cell"))
      .toHaveText(eurValuationBeforeRestart);
    await expect(restartedWindow.evaluate(() => (
      globalThis as typeof globalThis & {
        budgetApi: { exchangeRates: { list: (currencyCode: string) => Promise<unknown[]> } };
      }
    ).budgetApi.exchangeRates.list("EUR"))).resolves.toEqual([]);
    expect(await mainProcessNetworkRequests(restartedApp)).toEqual([]);
    expect(await rendererNetworkAttempts(restartedWindow)).toEqual([]);
    expect(await rendererNetworkBlockedAttempts(restartedWindow)).toEqual([]);
    expect(restartedNetworkObservation.httpRequests).toEqual([]);
    expect(restartedNetworkObservation.webSocketRequests).toEqual([]);
  } finally {
    await restartedApp.close();
  }
});

test("does not announce an empty registry when property loading fails", async ({
  appShell,
  databasePath,
  window,
}) => {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("DROP TABLE properties");
  } finally {
    database.close();
  }

  await appShell.openWorkspace("Data safety");
  const registry = new PropertyRegistryPage(window);

  await expect(registry.errorMessage).toContainText("properties");
  await expect(
    registry.section.getByText("No properties have been recorded.", { exact: true })
  ).toHaveCount(0);
});

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]) {
  test(`property registry states remain reachable at ${viewport.name} size`, async ({
    appShell,
    window,
  }) => {
    await window.setViewportSize({ width: viewport.width, height: viewport.height });
    await appShell.openWorkspace("Data safety");
    const registry = new PropertyRegistryPage(window);

    await expect(
      registry.section.getByText("No properties have been recorded.", { exact: true })
    ).toBeVisible();
    expect(await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    )).toBe(false);

    await registry.addProperty("Home");
    const home = registry.property("Home");
    await expect(home.getByText("No valuations have been recorded.", { exact: true }))
      .toBeVisible();
    expect(await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    )).toBe(false);

    await registry.addValuation("Home", {
      effectiveDate: "2026-10-01",
      amount: "5000000",
      currencyCode: "NOK",
    });
    await expect(registry.valuationRow("Home", "2026-10-01")).toContainText("NOK");
    expect(await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    )).toBe(false);

    await registry.addValuation("Home", {
      effectiveDate: "2026-11-01",
      amount: "450000",
      currencyCode: "EUR",
    });
    await expect(registry.valuationRow("Home", "2026-11-01")).toContainText("EUR");
    expect(await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    )).toBe(false);
  });
}

test("property validation stays keyboard-operable and responsive", async ({ appShell, window }) => {
  await window.setViewportSize({ width: 390, height: 844 });
  await appShell.openWorkspace("Data safety");
  const registry = new PropertyRegistryPage(window);
  await expect(registry.section).toBeVisible();
  await expect(registry.propertyLabelInput).toBeInViewport();

  await registry.propertyLabelInput.focus();
  await window.keyboard.press("Enter");
  await expect(registry.errorMessage).toContainText("Enter a property label.");
  await expect(registry.propertyLabelInput).toBeFocused();
  await expect(registry.property("Home")).toHaveCount(0);

  await registry.addProperty("Home");
  await registry.effectiveDateInput("Home").fill("");
  await registry.amountInput("Home").fill("5000000");
  await registry.currencyCodeInput("Home").fill("NOK");
  await registry.addValuationButton("Home").focus();
  await window.keyboard.press("Enter");
  await expect(registry.propertyError("Home")).toContainText("Enter a valid effective date.");
  await expect(registry.addValuationButton("Home")).toBeFocused();
  await expect(registry.valuationHistory("Home").getByRole("row")).toHaveCount(1);
  expect(await window.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  )).toBe(false);

  await window.setViewportSize({ width: 1280, height: 800 });
  await registry.addValuation("Home", {
    effectiveDate: "2026-10-01",
    amount: "5000000",
    currencyCode: "NOK",
  });
  await expect(registry.valuationRow("Home", "2026-10-01")).toContainText("NOK");
  expect(await window.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  )).toBe(false);
});

test("refreshes property history after restoring a local backup", async ({
  databasePath,
  recovery,
  window,
}) => {
  const registry = new PropertyRegistryPage(window);
  const recoveryPage = recovery;
  await expect(registry.propertyLabelInput).toBeInViewport();
  await registry.addProperty("Home");
  await registry.addValuation("Home", {
    effectiveDate: "2026-10-01",
    amount: "5000000",
    currencyCode: "NOK",
  });
  const valuationBeforeRestore = await registry
    .valuationRow("Home", "2026-10-01")
    .getByRole("cell")
    .allTextContents();

  const snapshotPath = join(dirname(databasePath), "property-registry-backup.json");
  await recoveryPage.backupPathInput.fill(snapshotPath);
  await recoveryPage.backupCreateButton.click();
  await expect(recoveryPage.backupSuccess).toBeVisible();

  await registry.addProperty("Cabin");
  await expect(registry.property("Cabin")).toBeVisible();
  await recoveryPage.restorePathInput.fill(snapshotPath);
  await recoveryPage.reviewSnapshotButton.click();
  await expect(recoveryPage.snapshotReviewSuccess).toBeVisible();

  window.once("dialog", async (dialog) => await dialog.accept());
  await recoveryPage.restoreButton.click();

  await expect(recoveryPage.restoreSuccess).toBeVisible();
  await expect(registry.property("Home")).toBeVisible();
  await expect(registry.property("Cabin")).toHaveCount(0);
  await expect(registry.valuationRow("Home", "2026-10-01").getByRole("cell"))
    .toHaveText(valuationBeforeRestore);
});

test("renderer network observer fails closed while the interceptor blocks HTTP, HTTPS, WS, and WSS", async ({
  window,
}) => {
  await expect(rendererNetworkAttempts(window)).rejects.toThrow(
    "Renderer network attempt observer was not installed."
  );
  await installRendererNetworkAttemptBlocker(window);
  const rendererNetworkObservation = await installRendererNetworkAttemptObserver(window);

  const blocked = await window.evaluate(async () => {
    const outcomes: boolean[] = [];
    for (const target of [
      "http://example.invalid",
      "https://example.invalid",
    ]) {
      try {
        await fetch(target);
        outcomes.push(false);
      } catch {
        outcomes.push(true);
      }
    }
    for (const target of [
      "http://example.invalid",
      "https://example.invalid",
    ]) {
      const requestBlocked = await new Promise<boolean>((resolve) => {
        const request = new XMLHttpRequest();
        request.addEventListener("error", () => resolve(true), { once: true });
        request.addEventListener("load", () => resolve(false), { once: true });
        try {
          request.open("GET", target);
          request.send();
        } catch {
          resolve(true);
        }
      });
      outcomes.push(requestBlocked);
    }
    for (const target of [
      "ws://example.invalid",
      "wss://example.invalid",
    ]) {
      try {
        new WebSocket(target);
        outcomes.push(false);
      } catch {
        outcomes.push(true);
      }
    }
    return outcomes;
  });

  expect(blocked).toEqual([true, true, true, true, true, true]);
  expect(await rendererNetworkAttempts(window)).toEqual([
    "http://example.invalid/",
    "https://example.invalid/",
    "http://example.invalid/",
    "https://example.invalid/",
    "ws://example.invalid/",
    "wss://example.invalid/",
  ]);
  expect(await rendererNetworkBlockedAttempts(window)).toEqual([
    "http://example.invalid/",
    "https://example.invalid/",
    "http://example.invalid/",
    "https://example.invalid/",
    "ws://example.invalid/",
    "wss://example.invalid/",
  ]);
  expect(rendererNetworkObservation.httpRequests).toEqual([]);
  expect(rendererNetworkObservation.webSocketRequests).toEqual([]);
});

test("keeps valuation errors beside the property that needs attention", async ({
  appShell,
  window,
}) => {
  await window.setViewportSize({ width: 390, height: 844 });
  await appShell.openWorkspace("Data safety");
  const registry = new PropertyRegistryPage(window);

  for (let index = 1; index <= 8; index += 1) {
    await registry.addProperty(`Property ${index}`);
    await expect(registry.property(`Property ${index}`)).toBeVisible();
  }

  await registry.addValuation("Property 8", {
    effectiveDate: "2026-10-01",
    amount: "",
    currencyCode: "NOK",
  });

  const error = registry.propertyError("Property 8");
  await expect(error).toContainText("Enter a non-negative amount");
  await expect(error).toBeInViewport();
  await expect(registry.amountInput("Property 8")).toHaveAttribute("aria-invalid", "true");
  const errorId = await error.getAttribute("id");
  const describedBy = await registry.amountInput("Property 8").getAttribute("aria-describedby");
  expect(describedBy?.split(/\s+/)).toContain(errorId);
});

test("shows the amount and currency in the initial mobile history view", async ({
  appShell,
  window,
}) => {
  await window.setViewportSize({ width: 390, height: 844 });
  await appShell.openWorkspace("Data safety");
  const registry = new PropertyRegistryPage(window);
  await registry.addProperty("Home");
  await registry.addValuation("Home", {
    effectiveDate: "2026-10-01",
    amount: "5000000",
    currencyCode: "NOK",
  });

  const valueCell = registry.valuationValueCell("Home", "2026-10-01");
  const viewport = registry.valuationHistoryViewport("Home");
  await expect(valueCell).toContainText("NOK");
  const geometry = await valueCell.evaluate((cell) => {
    const wrapper = cell.closest(".property-history-table-wrap");
    if (!wrapper) throw new Error("Valuation history viewport was not found.");
    const cellBounds = cell.getBoundingClientRect();
    const viewportBounds = wrapper.getBoundingClientRect();
    return {
      cellLeft: cellBounds.left,
      cellRight: cellBounds.right,
      viewportLeft: viewportBounds.left,
      viewportRight: viewportBounds.left + wrapper.clientWidth,
    };
  });

  expect(geometry.cellLeft).toBeGreaterThanOrEqual(geometry.viewportLeft);
  expect(geometry.cellRight).toBeLessThanOrEqual(geometry.viewportRight);
  await expect(registry.correctionToggle("Home", "2026-10-01")).toBeInViewport();
  await expect(viewport).toBeVisible();
});

test("explains local storage and backup coverage for property records", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Data safety");
  const registry = new PropertyRegistryPage(window);

  await expect(registry.section).toContainText(
    /property labels and valuations stay on this device and are included in local backup snapshots/i
  );
  await expect(window.getByRole("region", { name: "Data safety workspace" }))
    .toContainText(/property values.*back up.*export.*restore/i);
});

test("wraps a maximum-length unbroken property label on mobile", async ({
  appShell,
  window,
}) => {
  await window.setViewportSize({ width: 390, height: 844 });
  await appShell.openWorkspace("Data safety");
  const registry = new PropertyRegistryPage(window);
  const label = "W".repeat(100);
  await registry.addProperty(label);

  const heading = registry.property(label).getByRole("heading", { level: 4 });
  for (const width of [390, 320]) {
    await window.setViewportSize({ width, height: width === 390 ? 844 : 780 });
    const dimensions = await heading.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      documentWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentWidth);
  }
});

test("uses a native date picker for valuation effective dates", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Data safety");
  const registry = new PropertyRegistryPage(window);
  await registry.addProperty("Home");

  await expect(registry.effectiveDateInput("Home")).toHaveAttribute("type", "date");
  await registry.effectiveDateInput("Home").fill("2026-10-01");
  await expect(registry.effectiveDateInput("Home")).toHaveValue("2026-10-01");
});

test("renames a property without changing its valuation history", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Data safety");
  const registry = new PropertyRegistryPage(window);
  await registry.addProperty("Home");
  await registry.addValuation("Home", {
    effectiveDate: "2026-10-01",
    amount: "5000000",
    currencyCode: "NOK",
  });

  await registry.changePropertyLabel("Home", "Primary home");

  await expect(registry.property("Primary home")).toBeVisible();
  await expect(registry.property("Home")).toHaveCount(0);
  await expect(registry.valuationRow("Primary home", "2026-10-01")).toContainText("NOK");
});

test("appends a superseding valuation and preserves the earlier snapshot", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Data safety");
  const registry = new PropertyRegistryPage(window);
  await registry.addProperty("Home");
  await registry.addValuation("Home", {
    effectiveDate: "2026-10-01",
    amount: "5000000",
    currencyCode: "NOK",
  });

  await registry.correctionToggle("Home", "2026-10-01").focus();
  await window.keyboard.press("Enter");
  const correctionForm = registry.correctionForm("Home", "2026-10-01");
  await expect(correctionForm).toBeVisible();
  await correctionForm.getByLabel("Effective date").fill("2026-10-01");
  await correctionForm.getByLabel("Amount").fill("4800000");
  await correctionForm.getByLabel("Currency code").fill("NOK");
  await correctionForm.getByRole("button", { name: "Save correction", exact: true }).click();

  await expect(registry.valuationHistory("Home").getByRole("row")).toHaveCount(3);
  await expect(registry.valuationRow("Home", "2026-10-01", 0)).toContainText("Superseded");
  await expect(registry.valuationRow("Home", "2026-10-01", 1)).toContainText(
    /current corrected value/i
  );
  await expect(registry.valuationRow("Home", "2026-10-01", 1)).toContainText(
    /4[\s\u00a0\u202f]800[\s\u00a0\u202f]000/
  );
});

test("appends a void record instead of deleting a valuation", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Data safety");
  const registry = new PropertyRegistryPage(window);
  await registry.addProperty("Home");
  await registry.addValuation("Home", {
    effectiveDate: "2026-10-01",
    amount: "5000000",
    currencyCode: "NOK",
  });
  window.once("dialog", async (dialog) => await dialog.accept());

  await registry.correctionToggle("Home", "2026-10-01").click({ timeout: 5000 });
  await registry.voidValuationButton("Home", "2026-10-01").click({ timeout: 5000 });

  await expect(registry.valuationHistory("Home").getByRole("row")).toHaveCount(3);
  await expect(registry.valuationRow("Home", "2026-10-01", 0)).toContainText("Voided");
  await expect(registry.valuationRow("Home", "2026-10-01", 1)).toContainText("Void record");
});

test("property label and correction workflows remain local-only", async ({
  appShell,
  electronApp,
  window,
}) => {
  await installRendererNetworkAttemptBlocker(window);
  await installMainProcessNetworkProbe(electronApp);
  const rendererNetworkObservation = await installRendererNetworkAttemptObserver(window);
  await appShell.openWorkspace("Data safety");
  const registry = new PropertyRegistryPage(window);
  await registry.addProperty("Home");
  await registry.addValuation("Home", {
    effectiveDate: "2026-10-01",
    amount: "5000000",
    currencyCode: "NOK",
  });
  await registry.changePropertyLabel("Home", "Primary home");

  await registry.correctionToggle("Primary home", "2026-10-01", 0).click();
  const correctionForm = registry.correctionForm("Primary home", "2026-10-01", 0);
  await correctionForm.getByLabel("Effective date").fill("2026-10-01");
  await correctionForm.getByLabel("Amount").fill("4800000");
  await correctionForm.getByRole("button", { name: "Save correction", exact: true }).click();
  await expect(registry.valuationHistory("Primary home").getByRole("row")).toHaveCount(3);

  window.once("dialog", async (dialog) => await dialog.accept());
  await registry.correctionToggle("Primary home", "2026-10-01", 1).click();
  await registry.voidValuationButton("Primary home", "2026-10-01", 1).click();

  expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
  expect(await rendererNetworkAttempts(window)).toEqual([]);
  expect(await rendererNetworkBlockedAttempts(window)).toEqual([]);
  expect(rendererNetworkObservation.httpRequests).toEqual([]);
  expect(rendererNetworkObservation.webSocketRequests).toEqual([]);
});

test("keeps functional status text legible at desktop and mobile widths", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Data safety");

  for (const viewport of [
    { width: 320, height: 780 },
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await window.setViewportSize(viewport);
    const onDevice = await window.getByText("On device", { exact: true })
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    const readyStatus = await window.getByText("Ready for review", { exact: true })
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));

    expect(onDevice).toBeGreaterThanOrEqual(12);
    expect(readyStatus).toBeGreaterThanOrEqual(12);
    expect(await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    )).toBe(false);
  }
});

test("keeps collapsed snapshot catalog content out of the scan layout", async ({
  appShell,
  window,
}) => {
  await appShell.openWorkspace("Data safety");
  const catalog = window.locator(".snapshot-catalog");
  const catalogContent = catalog.locator('[role="group"]');

  await expect(catalog.getByText("Recent snapshots", { exact: false })).toBeVisible();
  await expect(catalogContent).toBeHidden();
  await expect(catalogContent).toHaveCSS("display", "none");

  await catalog.getByText("Recent snapshots", { exact: false }).click();
  await expect(catalogContent).toBeVisible();
});
