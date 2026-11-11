import { test, expect } from "./fixtures/electron.js";
import type { ManualEntryValues } from "./pom/ManualEntryPage.js";
import { DatabaseSync } from "node:sqlite";
import { _electron as electron } from "@playwright/test";
import { join } from "node:path";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

const boundaryTransactions: ManualEntryValues[] = [
  {
    accountId: "sample-acc",
    bookedAtIso: "2026-10-15",
    amountNok: "-50,00",
    merchantRaw: "Previous payday period comparison",
    categoryId: "groceries",
  },
  {
    accountId: "sample-acc",
    bookedAtIso: "2026-10-28",
    amountNok: "-100,00",
    merchantRaw: "Reporting boundary before",
    categoryId: "groceries",
  },
  {
    accountId: "sample-acc",
    bookedAtIso: "2026-10-29",
    amountNok: "3000,00",
    merchantRaw: "Reporting boundary start",
    categoryId: "groceries",
  },
  {
    accountId: "sample-acc",
    bookedAtIso: "2026-11-25",
    amountNok: "-500,00",
    merchantRaw: "Reporting period final day",
    categoryId: "groceries",
  },
  {
    accountId: "sample-acc",
    bookedAtIso: "2026-11-26",
    amountNok: "-200,00",
    merchantRaw: "Reporting boundary after",
    categoryId: "groceries",
  },
  {
    accountId: "sample-acc",
    bookedAtIso: "2026-12-31",
    amountNok: "-1,00",
    merchantRaw: "Synthetic year-rollover activity",
    categoryId: "groceries",
  },
];

function addSyntheticForeignCurrencyReportingActivity(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.prepare(`
      INSERT INTO accounts (id, household_id, name, currency_code)
      VALUES (?, ?, ?, ?)
    `).run("acc-reporting-eur", "sample-hh", "Synthetic EUR reporting account", "EUR");
    database.prepare(`
      INSERT INTO accounts (id, household_id, name, currency_code)
      VALUES (?, ?, ?, ?)
    `).run("acc-reporting-sek", "sample-hh", "Synthetic SEK reporting account", "SEK");
    const insertTransaction = database.prepare(`
      INSERT INTO transactions (
        id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        merchant_search, currency_code, source_type, source_reference, category_id,
        import_job_id, categorization_json, category_allocations_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertTransaction.run(
      "tx-reporting-eur",
      "sample-hh",
      "acc-reporting-eur",
      "2026-11-25T23:30:00-02:00",
      -10_000,
      "Synthetic EUR reporting expense",
      "SYNTHETIC EUR REPORTING EXPENSE",
      "EUR",
      "manual",
      null,
      "groceries",
      null,
      null,
      null
    );
    insertTransaction.run(
      "tx-reporting-sek",
      "sample-hh",
      "acc-reporting-sek",
      "2026-11-25T00:00:00Z",
      -5_000,
      "Synthetic SEK reporting expense",
      "SYNTHETIC SEK REPORTING EXPENSE",
      "SEK",
      "manual",
      null,
      "groceries",
      null,
      null,
      null
    );
  } finally {
    database.close();
  }
}

test("saves a last-weekday rule and ignores a superseded period response", async ({
  appShell,
  electronApp,
  manualEntry,
  window,
}) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
  });
  await window.clock.install({ time: new Date("2026-11-10T12:00:00") });

  for (const transaction of boundaryTransactions) {
    await manualEntry.submitEntry(transaction);
    await expect(manualEntry.successStatus).toHaveText(
      `Added ${transaction.merchantRaw} to your ledger.`
    );
  }

  const householdButton = appShell.destination("Household");
  await householdButton.focus();
  await householdButton.press("Enter");
  const settingsButton = window
    .getByRole("navigation", { name: "Household tools" })
    .getByRole("button", { name: "Settings", exact: true });
  await settingsButton.focus();
  await settingsButton.press("Enter");

  const settings = window.getByRole("region", { name: "Settings workspace" });
  await expect(settings.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  const reportingPeriod = settings
    .getByRole("region", { name: "Reporting period" })
    .getByRole("combobox")
    .first();
  await reportingPeriod.focus();
  await reportingPeriod.press("ArrowDown");
  await reportingPeriod.press("ArrowDown");
  await expect(reportingPeriod).toHaveValue("weekday-occurrence");
  const occurrence = settings.getByRole("combobox").nth(1);
  await occurrence.focus();
  await occurrence.press("End");
  await expect(occurrence).toHaveValue("last");
  const weekday = settings.getByRole("combobox").nth(2);
  await weekday.focus();
  await weekday.press("ArrowUp");
  await weekday.press("ArrowDown");
  await expect(weekday).toHaveValue("4");
  const preview = settings.getByLabel("Reporting period preview");
  await expect(preview).toContainText("29 October 2026 - 25 November 2026");
  await expect(preview).toContainText("26 November 2026 - 30 December 2026");
  const saveButton = settings.getByRole("button", { name: "Save reporting preference" });
  await saveButton.focus();
  await saveButton.press("Enter");
  await expect(settings.getByRole("status")).toContainText("Reporting period saved.");

  const reviewButton = appShell.destination("Review");
  await reviewButton.focus();
  await reviewButton.press("Enter");
  const review = window.getByRole("region", { name: "Review workspace" });
  await review.getByText("Change period", { exact: true }).click();
  await review.getByText("Reporting basis", { exact: true }).click();
  await expect(review.getByLabel("Reporting mode")).toHaveValue("payday-period");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "29 October 2026 - 25 November 2026"
  );
  const monthPicker = review.getByLabel("Select month", { exact: true });
  await expect(monthPicker).toHaveValue("2026-10");
  const monthPickerBounds = await monthPicker.boundingBox();
  expect(monthPickerBounds?.width ?? 0).toBeGreaterThan(260);
  const totals = review.getByRole("region", { name: "Payday-period totals" });
  await expect(totals.getByLabel("Income", { exact: true })).toContainText(/3\s?000,00/);
  await expect(totals.getByLabel("Expenses", { exact: true })).toContainText(/500,00/);
  await expect(totals.getByLabel("Period net", { exact: true })).toContainText(/2\s?500,00/);
  await expect(totals).toContainText("Income minus expenses; not spendable cash until your next income.");
  await expect(review.getByRole("group", { name: "Spending by category" })).toContainText(/500,00/);
  const paydayComparison = review.getByRole("group", { name: "Payday period comparison" });
  await paydayComparison.getByText("Comparison details", { exact: true }).click();
  await expect(paydayComparison).toContainText("24 September 2026 - 28 October 2026");
  await expect(review.getByRole("region", { name: "Target vs Actual" })).toHaveCount(0);
  await expect(review.getByText(
    "Target comparisons are shown only in Calendar month mode. Switch to Calendar month to compare actuals with those targets.",
    { exact: true }
  )).toBeVisible();
  await expect(review.getByText(
    "Calendar-month basis: forecast, recurring commitments, spendable cash, and cashflow scenarios",
    { exact: true }
  )).toBeVisible();
  const desktopDimensions = await window.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(desktopDimensions.scrollWidth).toBeLessThanOrEqual(desktopDimensions.clientWidth);

  const nextPeriod = review.getByRole("button", { name: /^Next period/ });
  await nextPeriod.focus();
  await nextPeriod.press("Enter");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "26 November 2026 - 30 December 2026"
  );
  await expect(totals.getByLabel("Expenses", { exact: true })).toContainText(/200,00/);
  await expect(totals.getByLabel("Income", { exact: true })).toContainText(/0,00/);

  const previousPeriod = review.getByRole("button", { name: /^Previous period/ });
  await nextPeriod.focus();
  await nextPeriod.press("Enter");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "31 December 2026 - 27 January 2027"
  );

  await previousPeriod.focus();
  await previousPeriod.press("Enter");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "26 November 2026 - 30 December 2026"
  );
  await previousPeriod.press("Enter");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "29 October 2026 - 25 November 2026"
  );

  const reportingMode = review.getByLabel("Reporting mode");
  await electronApp.evaluate(() => {
    process.env["BUDGET_TEST_SLOW_DASHBOARD_MONTH"] = "2026-11";
    process.env["BUDGET_TEST_DASHBOARD_VIEW_DELAY_MS"] = "750";
  });
  const monthSelector = review.getByLabel("Select month", { exact: true });
  await monthSelector.fill("2026-11");
  const updatingStatus = review.getByRole("status")
    .filter({ hasText: "Updating reporting period..." });
  await expect(updatingStatus).toBeVisible();
  await expect(monthSelector).toBeDisabled();
  await expect(reportingMode).toBeEnabled();
  await reportingMode.selectOption("calendar-month");
  await expect(reportingMode).toHaveValue("calendar-month");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "1 October 2026 - 31 October 2026"
  );
  const calendarTotals = review.getByRole("region", { name: "Monthly Totals" });
  await expect(calendarTotals.getByLabel("Expenses", { exact: true })).toContainText(/150,00/);
  await expect(calendarTotals.getByLabel("Monthly net", { exact: true })).toContainText(/2\s?850,00/);
  await window.evaluate(() => globalThis.window.budgetApi.dashboard.getViewData("2026-11"));
  await expect(reportingMode).toHaveValue("calendar-month");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "1 October 2026 - 31 October 2026"
  );
  await electronApp.evaluate(() => {
    delete process.env["BUDGET_TEST_SLOW_DASHBOARD_MONTH"];
    delete process.env["BUDGET_TEST_DASHBOARD_VIEW_DELAY_MS"];
  });
  const calendarComparison = review.getByRole("group", { name: "Monthly comparison" });
  await expect(calendarComparison).toBeVisible();
  await expect(calendarComparison).toContainText("No recorded activity");
  await expect(calendarComparison).not.toContainText("Spending increased");

  await reportingMode.press("ArrowDown");
  await expect(reportingMode).toHaveValue("payday-period");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "29 October 2026 - 25 November 2026"
  );
  await window.reload();
  const reloadedReview = window.getByRole("region", { name: "Review workspace" });
  await reloadedReview.getByText("Change period", { exact: true }).click();
  await reloadedReview.getByText("Reporting basis", { exact: true }).click();
  await expect(reloadedReview.getByLabel("Reporting mode")).toHaveValue("payday-period");
  await expect(reloadedReview.getByLabel("Active reporting range")).toHaveText(
    "29 October 2026 - 25 November 2026"
  );
  await expect(
    reloadedReview.getByRole("region", { name: "Payday-period totals" })
      .getByLabel("Expenses", { exact: true })
  ).toContainText(/500,00/);
});

test("separates current-period navigation from the saved reporting basis without changing Settings", async ({
  appShell,
  electronApp,
  window,
}) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
  });
  await window.clock.install({ time: new Date("2026-11-10T12:00:00") });
  await appShell.openWorkspace("Settings");

  const settings = window.getByRole("region", { name: "Settings workspace" });
  const reportingPeriod = settings
    .getByRole("region", { name: "Reporting period" })
    .getByRole("combobox")
    .first();
  await reportingPeriod.selectOption("fixed-day");
  await settings.getByLabel("Day of month", { exact: true }).fill("25");
  await settings.getByRole("button", { name: "Save reporting preference" }).click();
  await expect(settings.getByRole("status")).toContainText("Reporting period saved.");

  await appShell.openWorkspace("Review");
  const review = window.getByRole("region", { name: "Review workspace" });
  const totals = review.getByRole("region", { name: "Payday-period totals" });
  await expect(totals.getByLabel("Active reporting range")).toHaveText(
    "25 October 2026 - 24 November 2026"
  );
  const changePeriod = totals.getByText("Change period", { exact: true });
  await expect(changePeriod).toBeVisible();
  await expect(review.getByLabel("Reporting mode")).not.toBeVisible();
  await expect(review.getByRole("button", { name: /^Next period/ })).not.toBeVisible();
  await changePeriod.focus();
  await changePeriod.press("Enter");
  await expect(review.getByLabel("Reporting mode")).not.toBeVisible();
  await review.getByText("Reporting basis", { exact: true }).click();
  const reportingModeLabel = review.getByText("Reporting mode", { exact: true });
  await expect(reportingModeLabel).toHaveAttribute("for", "reporting-mode-select");
  await expect(reportingModeLabel).toBeVisible();
  await expect(totals.getByText(/Totals, categories, and checks follow these dates/))
    .toBeVisible();
  await review.getByLabel("Reporting mode").selectOption("calendar-month");
  const calendarTotals = review.getByRole("region", { name: "Monthly Totals" });
  await expect(calendarTotals.getByText("Using calendar months instead of saved payday periods", { exact: true })).toBeVisible();
  await expect(calendarTotals.getByLabel("Active reporting range")).toHaveText(
    "1 October 2026 - 31 October 2026"
  );
  expect(await window.evaluate(() => globalThis.window.budgetApi.reportingPreferences.getPeriodRule()))
    .toEqual({ type: "fixed-day", dayOfMonth: 25 });
  await appShell.openWorkspace("Settings");
  await expect(reportingPeriod).toHaveValue("fixed-day");
  await expect(settings.getByLabel("Day of month", { exact: true })).toHaveValue("25");
  await appShell.openWorkspace("Review");
  await calendarTotals.getByRole("button", { name: "Use saved payday periods" }).click();
  await expect(totals.getByLabel("Active reporting range")).toHaveText(
    "25 October 2026 - 24 November 2026"
  );
  await expect(totals.getByText("Using calendar months instead of saved payday periods", { exact: true })).toHaveCount(0);
  await totals.getByRole("button", { name: /^Previous period/ }).click();
  await expect(totals.getByLabel("Active reporting range")).toHaveText(
    "25 September 2026 - 24 October 2026"
  );
  await expect(totals.getByLabel("Active reporting range")).toHaveText("25 September 2026 - 24 October 2026");
  await expect(totals.getByText("Using calendar months instead of saved payday periods", { exact: true })).toHaveCount(0);
  await review.getByLabel("Reporting mode").selectOption("calendar-month");
  await expect(calendarTotals.getByLabel("Active reporting range")).toHaveText(
    "1 September 2026 - 30 September 2026"
  );
  await calendarTotals.getByRole("button", { name: "Use saved payday periods" }).click();
  await expect(totals.getByLabel("Active reporting range")).toHaveText(
    "25 September 2026 - 24 October 2026"
  );
  await review.getByLabel("Reporting mode").selectOption("calendar-month");
  await calendarTotals.getByRole("button", { name: "Current month", exact: true }).click();
  await expect(calendarTotals.getByLabel("Active reporting range")).toHaveText(
    "1 November 2026 - 30 November 2026"
  );
  await expect(calendarTotals.getByText("Using calendar months instead of saved payday periods", { exact: true })).toBeVisible();
  await calendarTotals.getByRole("button", { name: "Use saved payday periods" }).click();
  await expect(totals.getByLabel("Active reporting range")).toHaveText(
    "25 November 2026 - 24 December 2026"
  );
  await totals.getByRole("button", { name: "Current payday period", exact: true }).click();
  await expect(totals.getByLabel("Active reporting range")).toHaveText(
    "25 October 2026 - 24 November 2026"
  );
  await totals.getByRole("button", { name: /^Previous period/ }).click();
  await changePeriod.click();
  await expect(totals.getByRole("button", { name: /^Previous period/ })).not.toBeVisible();
  await expect(totals.getByLabel("Active reporting range")).toBeVisible();
  await changePeriod.click();
  await totals.getByRole("button", { name: "Current payday period", exact: true }).click();
  await expect(totals.getByLabel("Active reporting range")).toHaveText(
    "25 October 2026 - 24 November 2026"
  );
});

test("requires a fresh report before claiming its ledger totals reconcile after a failed refresh", async ({
  appShell,
  dashboard,
  electronApp,
  manualEntry,
  window,
}) => {
  await appShell.openWorkspace("Review");
  await dashboard.selectMonth("2026-05");
  await expect(dashboard.expenseValue).toContainText("85,00");
  const drilldown = dashboard.monthlyTotalsSection.getByRole("button", {
    name: "View transactions for this period", exact: true,
  });
  await drilldown.click();
  const summary = window.getByRole("region", { name: "Filtered transaction totals", exact: true });
  await expect(summary.getByLabel("Filtered expenses", { exact: true })).toContainText("85,00");
  await expect(summary).toContainText("These transactions produce the selected report's totals.");

  await electronApp.evaluate(() => {
    process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"] = "1";
  });
  await appShell.openWorkspace("Import");
  await manualEntry.submitEntry({
    accountId: "sample-acc",
    bookedAtIso: "2026-05-10",
    amountNok: "-100,00",
    merchantRaw: "SYNTHETIC REFRESH FAILURE EXPENSE",
    categoryId: "groceries",
  });
  await expect(manualEntry.successStatus).toContainText("Added");
  await appShell.openWorkspace("Review");
  const review = window.getByRole("region", { name: "Review workspace", exact: true });
  const refreshFailure = review.getByRole("alert").filter({ hasText: "Review refresh failed" });
  await expect(refreshFailure).toBeVisible();
  await expect(dashboard.expenseValue).toContainText("85,00");
  await expect(drilldown).toBeDisabled();
  await expect(dashboard.monthlyTotalsSection).toContainText(
    "Refresh the report before opening its contributing transactions."
  );

  await appShell.openWorkspace("Transactions");
  await expect(summary.getByLabel("Filtered expenses", { exact: true })).toContainText("185,00");
  await expect(summary).not.toContainText("These transactions produce the selected report's totals.");
  await expect(summary).toContainText("Refresh the report to verify these totals against it.");
  await expect(window.getByRole("status", { name: "Report filter context" })).toContainText("Report dates applied");

  await electronApp.evaluate(() => {
    delete process.env["BUDGET_TEST_DASHBOARD_REFRESH_FAILURE"];
  });
  await window.getByRole("alert").filter({ hasText: "Review refresh failed" })
    .getByRole("button", { name: "Try again", exact: true }).click();
  await expect(summary).toContainText("These transactions produce the selected report's totals.");
  await expect(summary).not.toContainText("Refresh the report to verify these totals against it.");
  await window.getByRole("button", { name: "Back to period review", exact: true }).click();
  await expect(dashboard.expenseValue).toContainText("185,00");
  await expect(drilldown).toBeEnabled();
  await drilldown.click();
  await expect(summary.getByLabel("Filtered expenses", { exact: true })).toContainText("185,00");
});

test("opens only the report's exact transactions and replaces old ledger filters on repeated drill-down", async ({
  appShell,
  ledger,
  manualEntry,
  window,
}) => {
  await window.clock.setFixedTime(new Date("2026-11-10T12:00:00"));
  for (const transaction of boundaryTransactions) {
    await manualEntry.submitEntry(transaction);
    await expect(manualEntry.successStatus).toContainText(`Added ${transaction.merchantRaw}`);
  }
  await appShell.openWorkspace("Settings");
  const settings = window.getByRole("region", { name: "Settings workspace" });
  await settings.getByRole("region", { name: "Reporting period" }).getByRole("combobox").first()
    .selectOption("fixed-day");
  await settings.getByLabel("Day of month", { exact: true }).fill("29");
  await settings.getByRole("button", { name: "Save reporting preference" }).click();
  await expect(settings.getByRole("status")).toContainText("Reporting period saved.");
  await appShell.openWorkspace("Review");
  const review = window.getByRole("region", { name: "Review workspace" });
  await review.getByRole("button", { name: "View transactions for this period", exact: true }).click();
  await expect(ledger.fromDateInput).toHaveValue("2026-10-29");
  await expect(ledger.toDateInput).toHaveValue("2026-11-28");
  await expect(ledger.table).toContainText("Reporting boundary start");
  await expect(ledger.table).toContainText("Reporting period final day");
  await expect(ledger.table).not.toContainText("Reporting boundary before");
  await expect(ledger.table).not.toContainText("Synthetic year-rollover activity");
  await expect(ledger.workspace).toContainText("29 October 2026 - 28 November 2026");
  await expect(ledger.workspace.getByRole("heading", { name: "Transactions", exact: true })).toBeFocused();
  const summary = ledger.workspace.getByRole("region", { name: "Filtered transaction totals", exact: true });
  await expect(summary).toContainText("All pages");
  await expect(summary.getByLabel("Filtered income", { exact: true })).toContainText("3 000,00");
  await expect(summary.getByLabel("Filtered expenses", { exact: true })).toContainText("700,00");
  await expect(summary.getByLabel("Filtered net", { exact: true })).toContainText("2 300,00");
  await expect(ledger.workspace.getByRole("status", { name: "Report filter context" })).toContainText("Report dates applied");
  await ledger.merchantInput.fill("no matching merchant");
  await expect(ledger.workspace.getByRole("status", { name: "Report filter context" })).toContainText("Filters changed");
  await expect(ledger.resultStatus).toHaveText("0 ledger transactions");
  await expect(summary.getByLabel("Filtered expenses", { exact: true })).toContainText("0,00");
  await ledger.workspace.getByRole("button", { name: "Restore report dates", exact: true }).click();
  await expect(ledger.merchantInput).toHaveValue("");
  await expect(ledger.table).toContainText("Reporting boundary start");
  await expect(summary.getByLabel("Filtered expenses", { exact: true })).toContainText("700,00");
  await expect(ledger.workspace.getByRole("status", { name: "Report filter context" })).toContainText("Report dates applied");
  await ledger.openMoreFilters();
  await ledger.amountFromInput.fill("not an amount");
  await expect(summary).not.toBeVisible();
  await expect(ledger.workspace.getByRole("status", { name: "Report filter context" })).toContainText("Filters changed");
  await ledger.workspace.getByRole("button", { name: "Restore report dates", exact: true }).click();
  await expect(ledger.amountFromInput).toHaveValue("");
  await expect(ledger.merchantInput).toBeFocused();
  await expect(summary.getByLabel("Filtered expenses", { exact: true })).toContainText("700,00");
  await ledger.sortByMerchant();
  await expect(summary.getByLabel("Filtered expenses", { exact: true })).toContainText("700,00");
  await expect(ledger.workspace.getByRole("status", { name: "Report filter context" })).toContainText("Report dates applied");
  await ledger.workspace.getByRole("button", { name: "Back to period review", exact: true }).click();
  await expect(review.getByRole("heading", { name: "Payday-period review", exact: true })).toBeFocused();
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "29 October 2026 - 28 November 2026"
  );
  await review.getByText("Change period", { exact: true }).click();
  await review.getByText("Reporting basis", { exact: true }).click();
  await review.getByRole("button", { name: /^Previous period/ }).click();
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "29 September 2026 - 28 October 2026"
  );
  await review.getByRole("button", { name: "View transactions for this period", exact: true }).click();
  await expect(ledger.fromDateInput).toHaveValue("2026-09-29");
  await expect(ledger.toDateInput).toHaveValue("2026-10-28");
  await expect(ledger.merchantInput).toHaveValue("");
  await expect(ledger.table).toContainText("Reporting boundary before");
  await expect(ledger.table).not.toContainText("Reporting boundary start");
  await ledger.clearFiltersButton.click();
  await expect(ledger.table).toContainText("Synthetic year-rollover activity");
  await ledger.workspace.getByRole("button", { name: "Back to period review", exact: true }).click();
  await review.getByRole("combobox", { name: "Reporting mode" }).selectOption("calendar-month");
  await expect(review.getByLabel("Active reporting range")).toHaveText("1 September 2026 - 30 September 2026");
  await review.getByLabel("Select month", { exact: true }).fill("2026-10");
  await expect(review.getByLabel("Active reporting range")).toHaveText("1 October 2026 - 31 October 2026");
  await review.getByRole("button", { name: "View transactions for this period", exact: true }).click();
  await expect(ledger.fromDateInput).toHaveValue("2026-10-01");
  await expect(ledger.toDateInput).toHaveValue("2026-10-31");
  await expect(ledger.table).toContainText("Reporting boundary before");
  await expect(ledger.table).toContainText("Reporting boundary start");
  await expect(ledger.table).not.toContainText("Reporting period final day");
});

test("keeps payday actuals in range with native amounts and transaction-date FX", async ({
  databasePath,
  electronApp,
}) => {
  await electronApp.close();
  addSyntheticForeignCurrencyReportingActivity(databasePath);
  const reportingApp = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      NODE_ENV: "test",
      BUDGET_DB_PATH: databasePath,
    },
  });

  try {
    const window = await reportingApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.setViewportSize({ width: 1280, height: 800 });
    await window.clock.install({ time: new Date("2026-11-10T12:00:00") });
    await window.getByRole("button", { name: "Household", exact: true }).click();
    await window
      .getByRole("navigation", { name: "Household tools" })
      .getByRole("button", { name: "Settings", exact: true })
      .click();

    const settings = window.getByRole("region", { name: "Settings workspace" });
    const exchangeRates = settings.getByRole("region", { name: "Exchange rates", exact: true }).last();
    const rateForm = exchangeRates.getByRole("form", { name: "Record exchange rate" });
    const rates = [
      { amount: "11.50", date: "2026-11-25", source: "Synthetic transaction-date rate" },
      { amount: "12.00", date: "2026-11-26", source: "Synthetic later rate" },
    ];
    for (const rate of rates) {
      await rateForm.getByLabel("Rate currency").selectOption("EUR");
      await rateForm.getByLabel("Rate NOK per 1 unit").fill(rate.amount);
      await rateForm.getByLabel("Rate effective date").fill(rate.date);
      await rateForm.getByLabel("Rate type").selectOption("dated");
      await rateForm.getByLabel("Rate source").fill(rate.source);
      await rateForm.getByRole("button", { name: "Save local exchange rate" }).click();
      await expect(exchangeRates.getByText(rate.source, { exact: true })).toBeVisible();
    }

    const reportingPeriodSection = settings.getByRole("region", { name: "Reporting period" });
    const reportingPeriod = reportingPeriodSection.getByRole("combobox").first();
    await reportingPeriod.selectOption("weekday-occurrence");
    await reportingPeriodSection.getByRole("combobox").nth(1)
      .selectOption("last");
    await reportingPeriodSection.getByRole("combobox").nth(2)
      .selectOption("4");
    await reportingPeriodSection.getByRole("button", { name: "Save reporting preference" }).click();
    await expect(reportingPeriodSection.getByRole("status")).toContainText("Reporting period saved.");

    await window.getByRole("button", { name: "Review", exact: true }).click();
    const review = window.getByRole("region", { name: "Review workspace" });
    await expect(review.getByLabel("Active reporting range")).toHaveText(
      "29 October 2026 - 25 November 2026"
    );
    const totals = review.getByRole("region", { name: "Payday-period totals" });
    await expect(totals.getByLabel("Expenses", { exact: true })).toContainText(/1\s?150,00/);
    await expect(totals.getByText(/Missing dated rates: SEK/)).toBeVisible();
    const nativeSubtotals = totals.getByRole("list", { name: "Native currency subtotals" });
    await expect(nativeSubtotals.getByRole("listitem")).toHaveCount(2);
    await expect(nativeSubtotals.getByRole("listitem").filter({ hasText: "EUR" }))
      .toContainText("100,00");
    await expect(nativeSubtotals.getByRole("listitem").filter({ hasText: "SEK" }))
      .toContainText("50,00");
    await review.getByRole("button", { name: "Record exchange rates", exact: true }).click();
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("heading", { name: "Exchange rates", exact: true })).toBeVisible();
    await window.getByRole("button", { name: "Review", exact: true }).click();

    await review.getByRole("button", { name: "View transactions for this period", exact: true }).click();
    const ledgerWorkspace = window.getByRole("region", { name: "Transactions workspace", exact: true });
    const ledgerSummary = ledgerWorkspace.getByRole("region", { name: "Filtered transaction totals", exact: true });
    await expect(ledgerSummary.getByLabel("Filtered expenses", { exact: true })).toContainText(/1\s?150,00/);
    await expect(ledgerSummary).toContainText("Missing dated rates: SEK");
    await expect(ledgerSummary).toContainText("partial NOK subtotals");
    await ledgerSummary.getByText("Native net subtotals", { exact: true }).click();
    await expect(ledgerSummary.getByRole("list", { name: "Filtered native currency subtotals" })).toContainText("EUR");
    await expect(ledgerSummary.getByRole("list", { name: "Filtered native currency subtotals" })).toContainText("SEK");
    await ledgerWorkspace.getByRole("button", { name: "More filters", exact: true }).click();
    await ledgerWorkspace.getByLabel("Minimum amount (NOK)", { exact: true }).fill("-1200");
    await ledgerWorkspace.getByLabel("Maximum amount (NOK)", { exact: true }).fill("-1100");
    await expect(ledgerSummary).toContainText("1 matching transactions");
    await expect(ledgerSummary.getByLabel("Filtered expenses", { exact: true })).toContainText(/1\s?150,00/);
    await expect(ledgerWorkspace.getByRole("status", { name: "Amount filter exclusions" })).toContainText("SEK");
    await ledgerWorkspace.getByLabel("Minimum amount (NOK)", { exact: true }).fill("-200");
    await ledgerWorkspace.getByLabel("Maximum amount (NOK)", { exact: true }).fill("-50");
    await expect(ledgerSummary).toContainText("0 matching transactions");
    await expect(ledgerWorkspace.getByRole("status", { name: "Amount filter exclusions" })).toContainText("1 transaction excluded");
    await ledgerWorkspace.getByRole("button", { name: "Restore report dates", exact: true }).click();
    await expect(ledgerSummary).toContainText("partial NOK subtotals");
    await expect(ledgerWorkspace.getByRole("status", { name: "Amount filter exclusions" })).not.toBeVisible();
    await ledgerWorkspace.getByRole("button", { name: "Back to period review", exact: true }).click();

    const reportingMode = review.getByLabel("Reporting mode");
    await review.getByText("Change period", { exact: true }).click();
    await review.getByText("Reporting basis", { exact: true }).click();
    await reportingMode.selectOption("calendar-month");
    await expect(review.getByLabel("Active reporting range")).toHaveText(
      "1 October 2026 - 31 October 2026"
    );
    await reportingMode.selectOption("payday-period");
    await expect(review.getByRole("region", { name: "Payday-period totals" })
      .getByLabel("Expenses", { exact: true })).toContainText(/1\s?150,00/);
  } finally {
    await reportingApp.close();
  }
});

test("supports keyboard payday setup without horizontal overflow at compact size", async ({
  appShell,
  electronApp,
  window,
}) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
  });
  await window.clock.install({ time: new Date("2026-10-10T12:00:00") });

  const householdButton = appShell.destination("Household");
  await householdButton.focus();
  await householdButton.press("Enter");
  const settingsButton = window
    .getByRole("navigation", { name: "Household tools" })
    .getByRole("button", { name: "Settings", exact: true });
  await settingsButton.focus();
  await settingsButton.press("Enter");

  const settings = window.getByRole("region", { name: "Settings workspace" });
  const reportingPeriod = settings
    .getByRole("region", { name: "Reporting period" })
    .getByRole("combobox")
    .first();
  await reportingPeriod.focus();
  await reportingPeriod.press("ArrowDown");
  await expect(reportingPeriod).toHaveValue("fixed-day");
  await settings.getByLabel("Day of month").fill("25");
  await expect(settings.getByLabel("Reporting period preview")).toContainText(
    "25 September 2026 - 24 October 2026"
  );
  const saveButton = settings.getByRole("button", { name: "Save reporting preference" });
  await saveButton.focus();
  await saveButton.press("Enter");
  await expect(settings.getByRole("status")).toContainText("Reporting period saved.");

  const reviewButton = appShell.destination("Review");
  await reviewButton.focus();
  await reviewButton.press("Enter");
  const review = window.getByRole("region", { name: "Review workspace" });
  const changePeriod = review.getByText("Change period", { exact: true });
  const disclosureBounds = await changePeriod.boundingBox();
  expect(disclosureBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
  await changePeriod.focus();
  await changePeriod.press("Enter");
  await review.getByText("Reporting basis", { exact: true }).click();
  await expect(review.getByLabel("Reporting mode")).toHaveValue("payday-period");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "25 September 2026 - 24 October 2026"
  );
  const monthPicker = review.getByLabel("Select month", { exact: true });
  await expect(monthPicker).toHaveValue("2026-09");
  const monthPickerBounds = await monthPicker.boundingBox();
  expect(monthPickerBounds?.width ?? 0).toBeGreaterThan(260);
  await expect(review.getByRole("note").filter({
    hasText: "Category targets, forecasts, spendable cash, and cashflow scenarios",
  })).toHaveCount(0);
  await expect(review.getByRole("note").filter({
    hasText: "Target comparisons are shown only in Calendar month mode.",
  })).toBeVisible();
  await expect(review.getByText(
    "Calendar-month basis: forecast, recurring commitments, spendable cash, and cashflow scenarios",
    { exact: true }
  )).toBeVisible();
  const dimensions = await window.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await appShell.openWorkspace("Settings");
  const reportingSettings = settings.getByRole("region", { name: "Reporting period" });
  await reportingSettings.getByRole("combobox").first().selectOption("two-fixed-days");
  await reportingSettings.getByLabel("Earlier date", { exact: true }).fill("15");
  await reportingSettings.getByLabel("Later date", { exact: true }).fill("31");
  await expect(reportingSettings.getByLabel("Reporting period preview"))
    .toContainText("30 September 2026 - 14 October 2026");
  const compactSettingsDimensions = await window.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(compactSettingsDimensions.scrollWidth)
    .toBeLessThanOrEqual(compactSettingsDimensions.clientWidth);
});

test("previews independent fixed-day clamping across February and March", async ({
  appShell,
  electronApp,
  window,
}) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
  });
  await window.clock.install({ time: new Date("2026-02-01T12:00:00") });
  await appShell.openWorkspace("Settings");

  const settings = window.getByRole("region", { name: "Settings workspace" });
  const reportingPeriod = settings
    .getByRole("region", { name: "Reporting period" })
    .getByRole("combobox")
    .first();
  await reportingPeriod.selectOption("fixed-day");
  await settings.getByLabel("Day of month", { exact: true }).fill("31");

  const preview = settings.getByLabel("Reporting period preview");
  await expect(preview).toContainText("31 January 2026 - 27 February 2026");
  await expect(preview).toContainText("28 February 2026 - 30 March 2026");
  await expect(preview).toContainText("Next boundary: 31 March 2026");
});

test("chooses a weekday occurrence and previews the selected boundary", async ({
  appShell,
  electronApp,
  window,
}) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
  });
  await window.clock.install({ time: new Date("2026-10-10T12:00:00") });
  await appShell.openWorkspace("Settings");

  const settings = window.getByRole("region", { name: "Settings workspace" });
  const reportingSettings = settings.getByRole("region", { name: "Reporting period" });
  await reportingSettings.getByRole("combobox").first().selectOption("weekday-occurrence");
  await reportingSettings.getByRole("combobox").nth(1).selectOption("2");
  await reportingSettings.getByRole("combobox").nth(2).selectOption("3");

  const preview = reportingSettings.getByLabel("Reporting period preview");
  await expect(preview).toContainText("9 September 2026 - 13 October 2026");
  await expect(preview).toContainText("14 October 2026 - 10 November 2026");
  await reportingSettings.getByRole("button", {
    name: "Save reporting preference",
  }).click();
  await expect(reportingSettings.getByRole("status"))
    .toContainText("Reporting period saved.");

  await appShell.openWorkspace("Review");
  const review = window.getByRole("region", { name: "Review workspace" });
  await expect(review.getByLabel("Active reporting range"))
    .toHaveText("9 September 2026 - 13 October 2026");
});

test("reviews and navigates two fixed reporting dates within one month", async ({
  appShell,
  electronApp,
  ledger,
  manualEntry,
  window,
}) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
  });
  await window.clock.install({ time: new Date("2026-02-20T12:00:00") });

  const transactions: ManualEntryValues[] = [
    {
      accountId: "sample-acc",
      bookedAtIso: "2026-01-24",
      amountNok: "-50,00",
      merchantRaw: "Previous period boundary before",
      categoryId: "groceries",
    },
    {
      accountId: "sample-acc",
      bookedAtIso: "2026-01-25",
      amountNok: "-100,00",
      merchantRaw: "Previous period boundary start",
      categoryId: "groceries",
    },
    {
      accountId: "sample-acc",
      bookedAtIso: "2026-02-15",
      amountNok: "-100,00",
      merchantRaw: "First two-date period",
      categoryId: "groceries",
    },
    {
      accountId: "sample-acc",
      bookedAtIso: "2026-02-24",
      amountNok: "-50,00",
      merchantRaw: "First two-date period end",
      categoryId: "groceries",
    },
    {
      accountId: "sample-acc",
      bookedAtIso: "2026-02-25",
      amountNok: "-200,00",
      merchantRaw: "Second two-date period",
      categoryId: "groceries",
    },
    {
      accountId: "sample-acc",
      bookedAtIso: "2026-03-14",
      amountNok: "-300,00",
      merchantRaw: "Second two-date period end",
      categoryId: "groceries",
    },
    {
      accountId: "sample-acc",
      bookedAtIso: "2026-03-15",
      amountNok: "-400,00",
      merchantRaw: "Next period start",
      categoryId: "groceries",
    },
  ];
  for (const transaction of transactions) {
    await manualEntry.submitEntry(transaction);
    await expect(manualEntry.successStatus).toHaveText(
      `Added ${transaction.merchantRaw} to your ledger.`
    );
  }

  await appShell.openWorkspace("Settings");
  const settings = window.getByRole("region", { name: "Settings workspace" });
  const reportingSettings = settings.getByRole("region", { name: "Reporting period" });
  await reportingSettings.getByRole("combobox").first().selectOption("two-fixed-days");
  const earlierDate = reportingSettings.getByLabel("Earlier date", { exact: true });
  const laterDate = reportingSettings.getByLabel("Later date", { exact: true });
  const savePreference = reportingSettings.getByRole("button", {
    name: "Save reporting preference",
  });
  await earlierDate.fill("28");
  await expect(reportingSettings.getByLabel("Reporting period preview"))
    .toContainText("Choose an earlier date from 1 through 27 and a later date after it.");
  await expect(savePreference).toBeDisabled();
  await earlierDate.fill("15");
  await laterDate.fill("25");
  const preview = reportingSettings.getByLabel("Reporting period preview");
  await expect(preview).toContainText("15 February 2026 - 24 February 2026");
  await expect(preview).toContainText("25 February 2026 - 14 March 2026");
  await savePreference.click();
  await expect(reportingSettings.getByRole("status"))
    .toContainText("Reporting period saved.");

  await appShell.openWorkspace("Review");
  const review = window.getByRole("region", { name: "Review workspace" });
  await expect(review.getByLabel("Active reporting range"))
    .toHaveText("15 February 2026 - 24 February 2026");
  const comparison = review.getByRole("group", { name: "Payday period comparison" });
  await comparison.getByText("Comparison details", { exact: true }).click();
  await expect(comparison).toContainText("25 January 2026 - 14 February 2026");
  await expect(comparison.getByRole("group", { name: "Selected period spending" })).toContainText("150,00");
  await expect(comparison.getByRole("group", { name: "Previous period spending" })).toContainText("100,00");
  await expect(comparison).toContainText("not a like-for-like comparison");
  const totals = review.getByRole("region", { name: "Payday-period totals" });
  const nextPeriod = review.getByRole("button", { name: /^Next period/ });
  await review.getByText("Change period", { exact: true }).click();
  await nextPeriod.click();
  await expect(review.getByLabel("Active reporting range"))
    .toHaveText("25 February 2026 - 14 March 2026");
  await expect(totals.getByLabel("Expenses", { exact: true })).toContainText(/500,00/);
  await review.getByRole("combobox", { name: "Select period" })
    .selectOption("2026-02-25");
  await expect(review.getByLabel("Active reporting range"))
    .toHaveText("25 February 2026 - 14 March 2026");
  await expect(totals.getByLabel("Expenses", { exact: true })).toContainText(/500,00/);
  await expect(totals.getByLabel("Income", { exact: true })).toContainText(/0,00/);
  await totals.getByRole("button", { name: "View transactions for this period", exact: true }).click();
  await expect(ledger.fromDateInput).toHaveValue("2026-02-25");
  await expect(ledger.toDateInput).toHaveValue("2026-03-14");
  await expect(ledger.table).toContainText("Second two-date period");
  await expect(ledger.table).toContainText("Second two-date period end");
  await expect(ledger.table).not.toContainText("First two-date period");
  await expect(ledger.table).not.toContainText("Next period start");
  await ledger.workspace.getByRole("button", { name: "Back to period review", exact: true }).click();
  await totals.getByRole("button", { name: "Current payday period", exact: true }).click();
  await expect(review.getByRole("combobox", { name: "Select period" }))
    .toHaveValue("2026-02-15");
  await expect(review.getByLabel("Active reporting range"))
    .toHaveText("15 February 2026 - 24 February 2026");
  await expect(totals.getByLabel("Expenses", { exact: true })).toContainText(/150,00/);
});

test("a failed local preference save keeps the draft without activating it", async ({
  appShell,
  databasePath,
  window,
}) => {
  const database = new DatabaseSync(databasePath);
  try {
    await appShell.openWorkspace("Settings");
    const settings = window.getByRole("region", { name: "Settings workspace" });
    const reportingPeriod = settings
      .getByRole("region", { name: "Reporting period" })
      .getByRole("combobox")
      .first();
    await reportingPeriod.selectOption("fixed-day");
    const dayOfMonth = settings.getByLabel("Day of month", { exact: true });
    await dayOfMonth.fill("31");

    database.exec("BEGIN IMMEDIATE");
    await settings.getByRole("button", { name: "Save reporting preference" }).click();
    await expect(settings.getByRole("alert")).toContainText("Unable to save reporting preference.");
    await expect(dayOfMonth).toHaveValue("31");
    await expect(settings.getByText("Reporting period saved.", { exact: true })).toHaveCount(0);
    database.exec("ROLLBACK");

    await appShell.destination("Review").click();
    const review = window.getByRole("region", { name: "Review workspace" });
    await expect(review.getByRole("heading", { name: "Monthly review" })).toBeVisible();
    await expect(review.getByText("Calendar month", { exact: true })).toBeVisible();
    await expect(review.getByLabel("Active reporting range")).toContainText(
      /^\d{1,2} [A-Za-z]+ \d{4} - \d{1,2} [A-Za-z]+ \d{4}$/
    );
  } finally {
    database.close();
  }
});

test("a failed calendar save preserves the draft and keeps the saved payday rule active", async ({
  appShell,
  databasePath,
  window,
}) => {
  const database = new DatabaseSync(databasePath);
  try {
    database.prepare(`
      INSERT INTO household_preferences (household_id, reporting_period_rule_json)
      VALUES (?, ?)
      ON CONFLICT(household_id) DO UPDATE
      SET reporting_period_rule_json = excluded.reporting_period_rule_json
    `).run("sample-hh", JSON.stringify({ type: "fixed-day", dayOfMonth: 25 }));
  } finally {
    database.close();
  }

  await window.reload();
  await appShell.openWorkspace("Settings");
  const settings = window.getByRole("region", { name: "Settings workspace" });
  const reportingPeriod = settings
    .getByRole("region", { name: "Reporting period" })
    .getByRole("combobox")
    .first();
  await expect(reportingPeriod).toHaveValue("fixed-day");
  await reportingPeriod.selectOption("calendar-month");

  const lockedDatabase = new DatabaseSync(databasePath);
  try {
    lockedDatabase.exec("BEGIN IMMEDIATE");
    await settings.getByRole("button", { name: "Save reporting preference" }).click();
    await expect(settings.getByRole("alert"))
      .toContainText("Unable to save reporting preference.");
    await expect(reportingPeriod).toHaveValue("calendar-month");
    await expect(settings.getByRole("button", { name: "Save reporting preference" }))
      .toBeVisible();
    await expect(settings.getByText("Reporting period saved.", { exact: true }))
      .toHaveCount(0);
    lockedDatabase.exec("ROLLBACK");
  } finally {
    lockedDatabase.close();
  }

  await appShell.openWorkspace("Review");
  await window.getByRole("region", { name: "Review workspace" })
    .getByText("Change period", { exact: true }).click();
  await window.getByRole("region", { name: "Review workspace" })
    .getByText("Reporting basis", { exact: true }).click();
  await expect(window.getByRole("region", { name: "Review workspace" })
    .getByLabel("Reporting mode")).toHaveValue("payday-period");
});

test("shows a visible error when a saved reporting preference is malformed", async ({
  databasePath,
  electronApp,
}) => {
  await electronApp.close();
  const database = new DatabaseSync(databasePath);
  try {
    database.prepare(`
      INSERT INTO household_preferences (household_id, reporting_period_rule_json)
      VALUES (?, ?)
      ON CONFLICT(household_id) DO UPDATE
      SET reporting_period_rule_json = excluded.reporting_period_rule_json
    `).run("sample-hh", JSON.stringify({ type: "unsupported" }));
  } finally {
    database.close();
  }

  const malformedPreferenceApp = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      NODE_ENV: "test",
      BUDGET_DB_PATH: databasePath,
    },
  });
  try {
    const malformedPreferenceWindow = await malformedPreferenceApp.firstWindow();
    await expect(malformedPreferenceWindow.getByRole("heading", {
      name: "Household ledger unavailable",
    })).toBeVisible();
    await expect(malformedPreferenceWindow.getByRole("alert")).toContainText(
      "Reporting period preference is malformed."
    );
  } finally {
    await malformedPreferenceApp.close();
  }
});
