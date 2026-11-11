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
      "2026-11-25T00:00:00Z",
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
  await expect(review.getByLabel("Reporting mode")).toHaveValue("payday-period");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "29 October 2026 - 25 November 2026"
  );
  const monthPicker = review.getByRole("combobox", { name: "Select month" });
  await expect(monthPicker.getByRole("option", {
    name: "29 October 2026 - 25 November 2026",
    exact: true,
  })).toBeAttached();
  const monthPickerBounds = await monthPicker.boundingBox();
  expect(monthPickerBounds?.width ?? 0).toBeGreaterThan(260);
  const totals = review.getByRole("region", { name: "Payday-period totals" });
  await expect(totals.getByLabel("Income", { exact: true })).toContainText(/3\s?000,00/);
  await expect(totals.getByLabel("Expenses", { exact: true })).toContainText(/500,00/);
  await expect(totals.getByLabel("Period net", { exact: true })).toContainText(/2\s?500,00/);
  await expect(totals).toContainText("Period net is this reporting period's income minus expenses");
  await expect(review.getByRole("group", { name: "Spending by category" })).toContainText(/500,00/);
  const paydayComparison = review.getByRole("group", { name: "Payday period comparison" });
  await expect(paydayComparison.getByRole("heading", { name: "Previous payday period" })).toBeVisible();
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

  const nextPeriod = review.getByRole("button", { name: "Next period" });
  await nextPeriod.focus();
  await nextPeriod.press("Enter");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "26 November 2026 - 30 December 2026"
  );
  await expect(totals.getByLabel("Expenses", { exact: true })).toContainText(/200,00/);
  await expect(totals.getByLabel("Income", { exact: true })).toContainText(/0,00/);

  const previousPeriod = review.getByRole("button", { name: "Previous period" });
  await nextPeriod.focus();
  await nextPeriod.press("Enter");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "31 December 2026 - 27 January 2027"
  );
  await expect(review.getByText("Next boundary: 28 January 2027")).toBeVisible();

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
  const monthSelector = review.getByRole("combobox", { name: "Select month" });
  await monthSelector.selectOption("2026-11");
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
  await expect(calendarComparison.getByRole("heading", { name: "Month-to-month spending" })).toBeVisible();
  await expect(calendarComparison).toContainText(/increased by 150,00/);

  await reportingMode.press("ArrowDown");
  await expect(reportingMode).toHaveValue("payday-period");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "29 October 2026 - 25 November 2026"
  );
  await window.reload();
  const reloadedReview = window.getByRole("region", { name: "Review workspace" });
  await expect(reloadedReview.getByLabel("Reporting mode")).toHaveValue("payday-period");
  await expect(reloadedReview.getByLabel("Active reporting range")).toHaveText(
    "29 October 2026 - 25 November 2026"
  );
  await expect(
    reloadedReview.getByRole("region", { name: "Payday-period totals" })
      .getByLabel("Expenses", { exact: true })
  ).toContainText(/500,00/);
});

test("shows a visible reporting-mode label in payday review", async ({
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
  const reportingModeLabel = review.getByText("Reporting mode", { exact: true });
  await expect(reportingModeLabel).toHaveAttribute("for", "reporting-mode-select");
  const labelBounds = await reportingModeLabel.boundingBox();
  expect(labelBounds?.width ?? 0).toBeGreaterThan(1);
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

    const reportingMode = review.getByLabel("Reporting mode");
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
  await expect(review.getByLabel("Reporting mode")).toHaveValue("payday-period");
  await expect(review.getByLabel("Active reporting range")).toHaveText(
    "25 September 2026 - 24 October 2026"
  );
  const monthPicker = review.getByRole("combobox", { name: "Select month" });
  await expect(monthPicker.getByRole("option", {
    name: "25 September 2026 - 24 October 2026",
    exact: true,
  })).toBeAttached();
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
  await expect(comparison).toContainText("25 January 2026 - 14 February 2026");
  await expect(comparison).toContainText(/from .*100,00.* to .*150,00/);
  const totals = review.getByRole("region", { name: "Payday-period totals" });
  const nextPeriod = review.getByRole("button", { name: "Next period" });
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
