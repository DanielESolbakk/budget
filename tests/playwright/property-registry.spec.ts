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
  await registry.effectiveDateInput("Home").fill("2026-02-30");
  await registry.amountInput("Home").fill("5000000");
  await registry.currencyCodeInput("Home").fill("NOK");
  await registry.addValuationButton("Home").focus();
  await window.keyboard.press("Enter");
  await expect(registry.errorMessage).toContainText("Enter a valid effective date.");
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
