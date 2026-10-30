import { test, expect } from "./fixtures/electron.js";
import {
  installRendererNetworkAttemptBlocker,
  installRendererNetworkAttemptObserver,
  rendererNetworkAttempts,
  rendererNetworkBlockedAttempts,
} from "./helpers/rendererNetworkProbe.js";
import { LoanRegistryPage } from "./pom/LoanRegistryPage.js";
import { PropertyRegistryPage } from "./pom/PropertyRegistryPage.js";

test("property, loan, and share workflows do not attempt renderer network requests", async ({
  appShell,
  window,
}) => {
  await installRendererNetworkAttemptBlocker(window);
  const observation = await installRendererNetworkAttemptObserver(window);

  await appShell.openWorkspace("Properties");
  const properties = new PropertyRegistryPage(window);
  await properties.addProperty("Home");
  await properties.addValuation("Home", {
    effectiveDate: "2026-10-01",
    amount: "5000000",
    currencyCode: "NOK",
  });
  await expect(properties.valuationRow("Home", "2026-10-01")).toContainText("NOK");
  const property = properties.property("Home");
  await property.getByLabel("Household ownership share (%)", { exact: true })
    .fill("75");
  await property.getByRole("button", { name: "Save ownership share", exact: true }).click();
  await expect(property.getByRole("form", { name: "Edit Household ownership share (%)" })
    .getByRole("status")).toContainText("Ownership share saved");

  await appShell.openWorkspace("Loans");
  const loans = new LoanRegistryPage(window);
  await loans.addLoan({
    label: "Mortgage",
    principal: "3000000",
    annualInterestRate: "5",
    termYears: "25",
    paymentAmount: "17500",
    paymentFrequency: "monthly",
    currencyCode: "NOK",
    propertyLabel: "Home",
  });
  await loans.addBalance("Mortgage", { effectiveDate: "2026-10-01", amount: "3000000" });
  const loan = loans.loan("Mortgage");
  await loan.getByLabel("Household loan responsibility share (%)", { exact: true })
    .fill("50");
  await loan.getByRole("button", { name: "Save responsibility share", exact: true }).click();
  await expect(loan.getByRole("form", { name: "Edit Household loan responsibility share (%)" })
    .getByRole("status")).toContainText("Responsibility share saved");
  await loans.expandLoanDetails("Mortgage");
  await expect(loans.balanceRow("Mortgage", "2026-10-01")).toContainText("NOK");

  await appShell.openWorkspace("Properties");
  await expect(properties.property("Home").getByLabel(
    "Household ownership share (%)", { exact: true }
  )).toHaveValue("75");
  await appShell.openWorkspace("Loans");
  await expect(loans.loan("Mortgage").getByLabel(
    "Household loan responsibility share (%)", { exact: true }
  )).toHaveValue("50");

  expect(await rendererNetworkAttempts(window)).toEqual([]);
  expect(await rendererNetworkBlockedAttempts(window)).toEqual([]);
  expect(observation.httpRequests).toEqual([]);
  expect(observation.webSocketRequests).toEqual([]);
});

test("holding entry and history do not attempt renderer network requests", async ({
  appShell,
  window,
}) => {
  await installRendererNetworkAttemptBlocker(window);
  const observation = await installRendererNetworkAttemptObserver(window);

  await appShell.openWorkspace("Investments");
  const registry = window.getByRole("region", {
    name: "Investment holdings registry",
    exact: true,
  });
  const create = registry.getByRole("form", { name: "Add investment holding", exact: true });
  await create.getByLabel("Holding label", { exact: true }).fill("Global fund");
  await create.getByLabel("Quantity", { exact: true }).fill("10");
  await create.getByLabel("Cost basis", { exact: true }).fill("10000");
  await create.getByLabel("Currency code", { exact: true }).fill("EUR");
  await create.getByRole("button", { name: "Save holding", exact: true }).click();

  const holding = registry.getByRole("region", { name: "Holding Global fund", exact: true });
  const valuation = holding.getByRole("form", { name: "Add valuation for Global fund", exact: true });
  await valuation.getByLabel("Effective date", { exact: true }).fill("2026-10-01");
  await valuation.getByLabel("Amount", { exact: true }).fill("11000");
  await valuation.getByRole("button", { name: "Save value", exact: true }).click();
  await expect(holding.getByRole("table", { name: "Valuation history", exact: true })
    .getByRole("row").filter({ hasText: "2026-10-01" })).toContainText("EUR");

  await appShell.openWorkspace("Properties");
  await appShell.openWorkspace("Investments");
  await expect(holding.getByRole("table", { name: "Valuation history", exact: true })
    .getByRole("row").filter({ hasText: "2026-10-01" })).toContainText("EUR");

  expect(await rendererNetworkAttempts(window)).toEqual([]);
  expect(await rendererNetworkBlockedAttempts(window)).toEqual([]);
  expect(observation.httpRequests).toEqual([]);
  expect(observation.webSocketRequests).toEqual([]);
});

test("the renderer observer detects and blocks each external protocol", async ({ window }) => {
  await expect(rendererNetworkAttempts(window)).rejects.toThrow(
    "Renderer network attempt observer was not installed."
  );
  await installRendererNetworkAttemptBlocker(window);
  const observation = await installRendererNetworkAttemptObserver(window);

  const blocked = await window.evaluate(async () => {
    const outcomes: boolean[] = [];
    for (const target of ["http://example.invalid", "https://example.invalid"]) {
      try {
        await fetch(target);
        outcomes.push(false);
      } catch {
        outcomes.push(true);
      }
    }
    for (const target of ["ws://example.invalid", "wss://example.invalid"]) {
      try {
        new WebSocket(target);
        outcomes.push(false);
      } catch {
        outcomes.push(true);
      }
    }
    return outcomes;
  });

  const attemptedTargets = [
    "http://example.invalid/",
    "https://example.invalid/",
    "ws://example.invalid/",
    "wss://example.invalid/",
  ];
  expect(blocked).toEqual([true, true, true, true]);
  expect(await rendererNetworkAttempts(window)).toEqual(attemptedTargets);
  expect(await rendererNetworkBlockedAttempts(window)).toEqual(attemptedTargets);
  expect(observation.httpRequests).toEqual([]);
  expect(observation.webSocketRequests).toEqual([]);
});
