import { DatabaseSync } from "node:sqlite";
import { _electron as electron, type Locator, type Page, type Request } from "@playwright/test";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";
import { installMainProcessFetchProbe, mainProcessFetchRequests } from "./helpers/networkProbe.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");
const COVERAGE_IMPORT_JOB_ID = "coverage-provenance-job";

interface CoverageTestAccount {
  id: string;
  household_id: string;
  currency_code: string;
}

interface CoveragePeriodFixture {
  id: string;
  startDateIso: string;
  endDateIso: string;
  sourceName: string;
  sourceType: "manual" | "csv";
  confirmed: boolean;
  confirmedAtIso?: string;
  importJobId?: string;
  importedAtIso?: string;
}

function getCoverageTestAccount(database: DatabaseSync): CoverageTestAccount {
  const account = database.prepare(`
    SELECT id, household_id, currency_code
    FROM accounts
    WHERE id = ?
  `).get("sample-acc") as CoverageTestAccount | undefined;
  if (account === undefined) {
    throw new Error("Expected the synthetic account coverage test account.");
  }
  return account;
}

function insertCoverageImportJob(
  database: DatabaseSync,
  account: CoverageTestAccount,
  id: string,
  sourceName: string,
  startedAtIso: string,
  finishedAtIso: string,
  transactionId: string,
  bookedAtIso: string
): void {
  database.prepare(`
    INSERT INTO import_jobs (
      id, household_id, source_type, source_name, started_at_iso, finished_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, account.household_id, "csv", sourceName, startedAtIso, finishedAtIso);
  database.prepare(`
    INSERT INTO transactions (
      id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
      merchant_search, currency_code, source_type, source_reference, category_id,
      import_job_id, categorization_json, category_allocations_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    transactionId,
    account.household_id,
    account.id,
    bookedAtIso,
    -100,
    `Synthetic coverage import ${id}`,
    `SYNTHETIC COVERAGE IMPORT ${id}`.toUpperCase(),
    account.currency_code,
    "csv",
    `source-${id}`,
    "groceries",
    id,
    null,
    null
  );
  database.prepare(`
    INSERT INTO import_job_operations (
      import_job_id, household_id, account_id, candidate_count, imported_count, duplicate_count
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, account.household_id, account.id, 1, 1, 0);
}

function seedCoverageImportProvenance(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    const account = getCoverageTestAccount(database);
    insertCoverageImportJob(
      database,
      account,
      COVERAGE_IMPORT_JOB_ID,
      "synthetic-coverage-import.csv",
      "2026-03-20T09:00:00Z",
      "2026-03-20T09:05:00Z",
      "tx-coverage-provenance",
      "2026-01-15T00:00:00Z"
    );
  } finally {
    database.close();
  }
}

function seedCoverageReviewStates(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    const account = getCoverageTestAccount(database);
    insertCoverageImportJob(
      database,
      account,
      "coverage-late-job",
      "synthetic-late-coverage.csv",
      "2026-07-02T09:00:00Z",
      "2026-07-03T09:00:00Z",
      "tx-coverage-late",
      "2026-05-15T00:00:00Z"
    );
    const insertPeriod = database.prepare(`
      INSERT INTO account_statement_coverage_periods (
        id, account_id, start_date_iso, end_date_iso, currency_code, source_name,
        source_type, import_job_id, imported_at_iso, confirmed, confirmed_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const periods: CoveragePeriodFixture[] = [
      {
        id: "coverage-overlap-a",
        startDateIso: "2026-03-01",
        endDateIso: "2026-03-31",
        sourceName: "Synthetic March statement A",
        sourceType: "manual",
        confirmed: true,
        confirmedAtIso: "2026-04-01T09:00:00Z",
      },
      {
        id: "coverage-overlap-b",
        startDateIso: "2026-03-15",
        endDateIso: "2026-04-15",
        sourceName: "Synthetic March statement B",
        sourceType: "manual",
        confirmed: true,
        confirmedAtIso: "2026-04-02T09:00:00Z",
      },
      {
        id: "coverage-late-period",
        startDateIso: "2026-06-01",
        endDateIso: "2026-06-30",
        sourceName: "synthetic-late-coverage.csv",
        sourceType: "csv",
        importJobId: "coverage-late-job",
        importedAtIso: "2026-07-03T09:00:00Z",
        confirmed: true,
        confirmedAtIso: "2026-07-02T09:00:00Z",
      },
      {
        id: "coverage-stale-period",
        startDateIso: "2026-09-01",
        endDateIso: "2026-09-30",
        sourceName: "Synthetic stale statement",
        sourceType: "manual",
        confirmed: true,
        confirmedAtIso: "2026-10-01T09:00:00Z",
      },
      {
        id: "coverage-missing-period",
        startDateIso: "2026-02-01",
        endDateIso: "2026-02-28",
        sourceName: "Synthetic missing statement",
        sourceType: "manual",
        confirmed: true,
        confirmedAtIso: "2026-03-01T09:00:00Z",
      },
      {
        id: "coverage-keyboard-desktop",
        startDateIso: "2026-11-01",
        endDateIso: "2026-11-10",
        sourceName: "Synthetic desktop keyboard statement",
        sourceType: "manual",
        confirmed: false,
      },
      {
        id: "coverage-keyboard-compact",
        startDateIso: "2026-12-01",
        endDateIso: "2026-12-10",
        sourceName: "Synthetic compact keyboard statement",
        sourceType: "manual",
        confirmed: false,
      },
    ];
    for (const period of periods) {
      insertPeriod.run(
        period.id,
        account.id,
        period.startDateIso,
        period.endDateIso,
        account.currency_code,
        period.sourceName,
        period.sourceType,
        period.importJobId ?? null,
        period.importedAtIso ?? null,
        period.confirmed ? 1 : 0,
        period.confirmedAtIso ?? null
      );
    }

    const insertCheckpoint = database.prepare(`
      INSERT INTO account_balance_checkpoints (
        id, account_id, date_iso, currency_code, balance_minor, source, recorded_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [id, dateIso, balanceMinor, source] of [
      ["coverage-stale-checkpoint", "2026-08-31", 99_500, "Synthetic old checkpoint"],
      ["coverage-desktop-opening", "2026-11-01", 100_000, "Synthetic opening checkpoint"],
      ["coverage-desktop-closing", "2026-11-10", 100_500, "Synthetic closing checkpoint"],
      ["coverage-compact-opening", "2026-12-01", 100_000, "Synthetic opening checkpoint"],
      ["coverage-compact-closing", "2026-12-10", 100_500, "Synthetic closing checkpoint"],
    ] as const) {
      insertCheckpoint.run(
        id,
        account.id,
        dateIso,
        account.currency_code,
        balanceMinor,
        source,
        `${dateIso}T09:00:00Z`
      );
    }
  } finally {
    database.close();
  }
}

async function tabTo(window: Page, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await window.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Keyboard tab navigation did not reach the expected coverage control.");
}

test.describe("account statement coverage and checkpoints", () => {
  test("surfaces account coverage status from monthly review", async ({ window }) => {
    const coverage = window.getByRole("region", { name: "Account statement coverage" });
    const coverageSummary = window.getByRole("region", { name: "Account coverage status" });
    await expect(coverage).not.toBeVisible();
    await expect(coverageSummary).toBeVisible();
    await expect(coverageSummary).toContainText("Brukskonto");
    await expect(coverageSummary).toContainText("No statement periods recorded");

    await coverageSummary.getByRole("button", { name: "Review account coverage", exact: true }).click();
    await expect(coverage).toBeVisible();
  });

  test("groups workspace navigation into four task areas", async ({ appShell, window }) => {
    await window.setViewportSize({ width: 390, height: 844 });
    const navigation = appShell.primaryNavigation;
    await expect(navigation.getByRole("button")).toHaveCount(4);
    await expect(navigation.getByRole("button", { name: "Review", exact: true })).toBeVisible();
    await expect(navigation.getByRole("button", { name: "Activity", exact: true })).toBeVisible();
    await expect(navigation.getByRole("button", { name: "Accounts", exact: true })).toBeVisible();
    await expect(navigation.getByRole("button", { name: "Household", exact: true })).toBeVisible();

    const navigationRows = await navigation.locator("button").evaluateAll((buttons) =>
      [...new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top)))]
    );
    expect(navigationRows).toHaveLength(1);

    await appShell.openWorkspace("Pending");
    await expect(window.getByRole("region", { name: "Pending transactions workspace" })).toBeVisible();
    await expect(navigation.getByRole("button", { name: "Activity", exact: true }))
      .toHaveAttribute("aria-current", "page");

    await appShell.openWorkspace("Settings");
    await expect(window.getByRole("region", { name: "Exchange rates", exact: true })).toBeVisible();
    await expect(navigation.getByRole("button", { name: "Household", exact: true }))
      .toHaveAttribute("aria-current", "page");
  });

  test("presents statement capture before balance checkpoints on desktop", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Coverage");
    await window.setViewportSize({ width: 1280, height: 800 });
    const coverage = window.getByRole("region", { name: "Account statement coverage" });
    const statementForm = coverage.locator('form[aria-label="Record statement coverage"]');
    const checkpointForm = coverage.locator('form[aria-label="Add balance checkpoint"]');
    await expect(statementForm).toBeVisible();
    await expect(checkpointForm).toBeVisible();
    await expect.poll(async () =>
      statementForm.evaluate((form) => getComputedStyle(form).gridTemplateColumns.split(" ").length)
    ).toBe(2);
    const statementBounds = await statementForm.boundingBox();
    const checkpointBounds = await checkpointForm.boundingBox();

    if (statementBounds === null || checkpointBounds === null) {
      throw new Error("Coverage entry forms must remain visible in the desktop workflow.");
    }
    expect(checkpointBounds.y).toBeGreaterThan(statementBounds.y + statementBounds.height);
  });

  test("@visual Visual: coverage workspace is composed for desktop and compact windows", async ({
    appShell,
    window,
  }) => {
    await appShell.openWorkspace("Coverage");
    const coverage = window.getByRole("region", { name: "Account statement coverage" });
    await expect(coverage).toContainText("No statement periods recorded.");

    await window.setViewportSize({ width: 1280, height: 800 });
    await expect(window).toHaveScreenshot("account-coverage-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await window.setViewportSize({ width: 390, height: 844 });
    await expect(window).toHaveScreenshot("account-coverage-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  });

  test("records imported statement provenance and displays an exact account reconciliation", async ({
    databasePath,
    electronApp,
  }) => {
    await electronApp.close();
    seedCoverageImportProvenance(databasePath);
    const coverageApp = await electron.launch({
      args: [MAIN_ENTRY],
      env: {
        ...process.env,
        NODE_ENV: "test",
        BUDGET_DB_PATH: databasePath,
      },
    });

    try {
      const window = await coverageApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await window.getByRole("button", { name: "Accounts", exact: true }).click();
      const coverage = window.getByRole("region", { name: "Account statement coverage" });
      const accountSelect = coverage.getByLabel("Coverage account");
      await expect(accountSelect).toHaveValue("sample-acc");
      await expect(accountSelect).toContainText("Brukskonto (NOK)");
      await coverage.getByLabel("Coverage source type").selectOption("csv");
      const importJobSelect = coverage.getByLabel("Coverage import job");
      await expect(importJobSelect).toBeVisible();
      await importJobSelect.selectOption(COVERAGE_IMPORT_JOB_ID);
      await expect(coverage.getByLabel("Statement source"))
        .toHaveValue("synthetic-coverage-import.csv");
      await coverage.getByLabel("Statement start date").fill("2026-03-01");
      await coverage.getByLabel("Statement end date").fill("2026-03-31");
      await coverage.getByRole("button", { name: "Save statement period" }).click();

      const period = coverage.getByRole("group", {
        name: "Coverage period 2026-03-01 to 2026-03-31",
      });
      await expect(period).toContainText("Unknown");
      await expect(period).toContainText("Source: synthetic-coverage-import.csv (csv)");
      await expect(period).toContainText(`Import job: ${COVERAGE_IMPORT_JOB_ID}`);
      await period.getByRole("button", { name: "Confirm coverage" }).click();

      await coverage.getByLabel("Checkpoint date").fill("2026-03-01");
      await coverage.getByLabel("Checkpoint balance").fill("1000.00");
      await coverage.getByLabel("Checkpoint source").fill("Synthetic opening balance");
      await coverage.getByRole("button", { name: "Save balance checkpoint" }).click();
      await coverage.getByLabel("Checkpoint date").fill("2026-03-31");
      await coverage.getByLabel("Checkpoint balance").fill("1000.00");
      await coverage.getByLabel("Checkpoint source").fill("Synthetic closing balance");
      await coverage.getByRole("button", { name: "Save balance checkpoint" }).click();

      await expect(period).toContainText("Coverage confirmed");
      await expect(period).toContainText(/Difference.*0,00/);
      await expect(period.getByRole("list", { name: "Balance checkpoint history" }))
        .toContainText("Synthetic opening balance");
      await expect(period.getByRole("list", { name: "Balance checkpoint history" }))
        .toContainText("Synthetic closing balance");
    } finally {
      await coverageApp.close();
    }
  });

  test("keeps an empty unconfirmed period unknown until the user confirms it", async ({ window }) => {
    await window.getByRole("button", { name: "Accounts", exact: true }).click();
    const coverage = window.getByRole("region", { name: "Account statement coverage" });
    await expect(coverage).toBeVisible();
    await coverage.getByLabel("Coverage account").selectOption("sample-acc");
    await coverage.getByLabel("Statement start date").fill("2026-03-01");
    await coverage.getByLabel("Statement end date").fill("2026-03-31");
    await coverage.getByLabel("Statement source").fill("Synthetic March statement");
    await coverage.getByRole("button", { name: "Save statement period" }).click();

    const period = coverage.getByRole("group", { name: "Coverage period 2026-03-01 to 2026-03-31" });
    await expect(period).toContainText("Unknown");
    await expect(period).toContainText("No booked transactions in this period");
    await expect(period).not.toContainText("Missing statement");

    await period.getByRole("button", { name: "Confirm coverage" }).click();
    await expect(period).toContainText("Coverage confirmed");
  });

  test("shows the exact checkpoint difference and keeps history reachable on compact windows", async ({
    window,
  }) => {
    await window.setViewportSize({ width: 1280, height: 800 });
    await window.getByRole("button", { name: "Accounts", exact: true }).click();
    const coverage = window.getByRole("region", { name: "Account statement coverage" });
    await coverage.getByLabel("Coverage account").selectOption("sample-acc");
    await expect(coverage.getByLabel("Coverage account")).toContainText("Brukskonto (NOK)");
    await coverage.getByLabel("Statement start date").fill("2026-03-01");
    await coverage.getByLabel("Statement end date").fill("2026-03-31");
    await coverage.getByLabel("Statement source").fill("Synthetic March statement");
    await coverage.getByRole("button", { name: "Save statement period" }).click();
    const period = coverage.getByRole("group", { name: "Coverage period 2026-03-01 to 2026-03-31" });
    await period.getByRole("button", { name: "Confirm coverage" }).click();

    await coverage.getByLabel("Checkpoint date").fill("2026-03-01");
    await coverage.getByLabel("Checkpoint balance").fill("1000.00");
    await coverage.getByLabel("Checkpoint source").fill("Synthetic opening balance");
    await coverage.getByRole("button", { name: "Save balance checkpoint" }).click();

    await coverage.getByLabel("Checkpoint date").fill("2026-03-31");
    await coverage.getByLabel("Checkpoint balance").fill("1005.00");
    await coverage.getByLabel("Checkpoint source").fill("Synthetic closing balance");
    await coverage.getByRole("button", { name: "Save balance checkpoint" }).click();
    await expect(period).toContainText(/Difference:\s*NOK\s*5,00/);
    const checkpointHistory = period.getByRole("list", { name: "Balance checkpoint history" });
    await expect(checkpointHistory.locator('time[datetime="2026-03-01"]')).toBeVisible();
    await expect(checkpointHistory).toContainText("Synthetic opening balance");
    await expect(checkpointHistory.locator('time[datetime="2026-03-31"]')).toBeVisible();
    await expect(checkpointHistory).toContainText("Synthetic closing balance");

    await window.setViewportSize({ width: 390, height: 844 });
    await expect(period.getByRole("list", { name: "Balance checkpoint history" })).toBeVisible();
    const horizontalOverflow = await window.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBe(false);
  });

  test("shows overlapping, late-arriving, stale, and missing states distinctly", async ({
    databasePath,
    electronApp,
  }) => {
    await electronApp.close();
    seedCoverageReviewStates(databasePath);
    const coverageApp = await electron.launch({
      args: [MAIN_ENTRY],
      env: {
        ...process.env,
        NODE_ENV: "test",
        BUDGET_DB_PATH: databasePath,
      },
    });

    try {
      const window = await coverageApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      const coverageSummary = window.getByRole("region", { name: "Account coverage status" });
      await expect(coverageSummary).toContainText("2 periods await confirmation.");
      await expect(coverageSummary).toContainText("7 statement periods need review.");
      await window.getByRole("button", { name: "Accounts", exact: true }).click();
      const coverage = window.getByRole("region", { name: "Account statement coverage" });

      const overlappingPeriod = coverage.getByRole("group", {
        name: "Coverage period 2026-03-01 to 2026-03-31",
      });
      await expect(overlappingPeriod)
        .toContainText("Overlapping statement period requires review.");
      const secondOverlappingPeriod = coverage.getByRole("group", {
        name: "Coverage period 2026-03-15 to 2026-04-15",
      });
      await expect(secondOverlappingPeriod)
        .toContainText("Overlapping statement period requires review.");

      const latePeriod = coverage.getByRole("group", {
        name: "Coverage period 2026-06-01 to 2026-06-30",
      });
      await expect(latePeriod).toContainText("Late-arriving import requires review.");

      const stalePeriod = coverage.getByRole("group", {
        name: "Coverage period 2026-09-01 to 2026-09-30",
      });
      await expect(stalePeriod).toContainText("Checkpoint status: stale");
      await expect(stalePeriod).not.toContainText("Difference:");

      const missingPeriod = coverage.getByRole("group", {
        name: "Coverage period 2026-02-01 to 2026-02-28",
      });
      await expect(missingPeriod).toContainText("No booked transactions in this period.");
      await expect(missingPeriod).toContainText("Checkpoint status: missing");
      await expect(missingPeriod).not.toContainText("Difference:");
    } finally {
      await coverageApp.close();
    }
  });

  test("keeps coverage and checkpoint entry and review keyboard-accessible at desktop and compact widths", async ({
    databasePath,
    electronApp,
  }) => {
    await electronApp.close();
    seedCoverageReviewStates(databasePath);
    const coverageApp = await electron.launch({
      args: [MAIN_ENTRY],
      env: {
        ...process.env,
        NODE_ENV: "test",
        BUDGET_DB_PATH: databasePath,
      },
    });

    try {
      const window = await coverageApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await window.getByRole("button", { name: "Accounts", exact: true }).click();
      const coverage = window.getByRole("region", { name: "Account statement coverage" });
      const focusTargets = [
        coverage.getByLabel("Statement start date"),
        coverage.getByLabel("Statement end date"),
        coverage.getByLabel("Statement source"),
        coverage.getByLabel("Coverage source type"),
        coverage.getByRole("button", { name: "Save statement period" }),
        coverage.getByLabel("Checkpoint date"),
        coverage.getByLabel("Checkpoint balance"),
        coverage.getByLabel("Checkpoint source"),
        coverage.getByRole("button", { name: "Save balance checkpoint" }),
      ];
      const workflows = [
        {
          width: 1280,
          height: 800,
          startDateIso: "2026-11-01",
          endDateIso: "2026-11-10",
        },
        {
          width: 390,
          height: 844,
          startDateIso: "2026-12-01",
          endDateIso: "2026-12-10",
        },
      ];

      for (const workflow of workflows) {
        await window.setViewportSize({ width: workflow.width, height: workflow.height });
        const accountSelect = coverage.getByLabel("Coverage account");
        await accountSelect.focus();
        await expect(accountSelect).toBeFocused();
        for (const target of focusTargets) {
          await tabTo(window, target);
          await expect(target).toBeFocused();
        }
        const focusOutlineWidth = await focusTargets[0]!.evaluate((element) =>
          getComputedStyle(element).outlineWidth
        );
        expect(focusOutlineWidth).toBe("3px");

        const period = coverage.getByRole("group", {
          name: `Coverage period ${workflow.startDateIso} to ${workflow.endDateIso}`,
        });
        await expect(period).toContainText("Unknown");
        await expect(period).toContainText(/Difference.*5,00/);
        await expect(period.getByRole("list", { name: "Balance checkpoint history" }))
          .toBeVisible();
        const confirmButton = period.getByRole("button", { name: "Confirm coverage" });
        await confirmButton.focus();
        await expect(confirmButton).toBeFocused();
        await window.keyboard.press("Enter");
        await expect(period).toContainText("Coverage confirmed");

        const horizontalOverflow = await window.evaluate(() =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth
        );
        expect(horizontalOverflow).toBe(false);
      }
    } finally {
      await coverageApp.close();
    }
  });

  test("retains coverage after relaunch without renderer or main-process network requests", async ({
    databasePath,
    electronApp,
    window,
  }) => {
    const rendererRequests: string[] = [];
    const onRequest = (request: Request): void => {
      if (/^https?:/i.test(request.url())) rendererRequests.push(request.url());
    };
    window.on("request", onRequest);
    await installMainProcessFetchProbe(electronApp);

    await window.getByRole("button", { name: "Accounts", exact: true }).click();
    const coverage = window.getByRole("region", { name: "Account statement coverage" });
    await coverage.getByLabel("Coverage account").selectOption("sample-acc");
    await coverage.getByLabel("Statement start date").fill("2026-03-01");
    await coverage.getByLabel("Statement end date").fill("2026-03-31");
    await coverage.getByLabel("Statement source").fill("Synthetic relaunch statement");
    await coverage.getByRole("button", { name: "Save statement period" }).click();
    const period = coverage.getByRole("group", { name: "Coverage period 2026-03-01 to 2026-03-31" });
    await period.getByRole("button", { name: "Confirm coverage" }).click();

    await coverage.getByLabel("Checkpoint date").fill("2026-03-01");
    await coverage.getByLabel("Checkpoint balance").fill("1000.00");
    await coverage.getByLabel("Checkpoint source").fill("Synthetic opening balance");
    await coverage.getByRole("button", { name: "Save balance checkpoint" }).click();
    await coverage.getByLabel("Checkpoint date").fill("2026-03-31");
    await coverage.getByLabel("Checkpoint balance").fill("1005.00");
    await coverage.getByLabel("Checkpoint source").fill("Synthetic closing balance");
    await coverage.getByRole("button", { name: "Save balance checkpoint" }).click();
    await expect(period).toContainText(/Difference.*5,00/);

    const originalMainProcessRequests = await mainProcessFetchRequests(electronApp);
    await electronApp.close();
    const restartedApp = await electron.launch({
      args: [MAIN_ENTRY],
      env: {
        ...process.env,
        NODE_ENV: "test",
        BUDGET_DB_PATH: databasePath,
      },
    });
    let restartedWindow: Page | undefined;

    try {
      await installMainProcessFetchProbe(restartedApp);
      restartedWindow = await restartedApp.firstWindow();
      restartedWindow.on("request", onRequest);
      await restartedWindow.waitForLoadState("domcontentloaded");
      await restartedWindow.getByRole("button", { name: "Accounts", exact: true }).click();
      const restartedCoverage = restartedWindow.getByRole("region", {
        name: "Account statement coverage",
      });
      await expect(restartedCoverage.getByLabel("Coverage account"))
        .toContainText("Brukskonto (NOK)");
      const restartedPeriod = restartedCoverage.getByRole("group", {
        name: "Coverage period 2026-03-01 to 2026-03-31",
      });

      await expect(restartedPeriod).toContainText("Coverage confirmed");
      await expect(restartedPeriod).toContainText("Synthetic relaunch statement");
      await expect(restartedPeriod).toContainText(/Difference.*5,00/);
      const restartedHistory = restartedPeriod.getByRole("list", {
        name: "Balance checkpoint history",
      });
      await expect(restartedHistory.locator('time[datetime="2026-03-01"]')).toBeVisible();
      await expect(restartedHistory).toContainText("Synthetic opening balance");
      await expect(restartedHistory.locator('time[datetime="2026-03-31"]')).toBeVisible();
      await expect(restartedHistory).toContainText("Synthetic closing balance");
      expect(rendererRequests).toEqual([]);
      expect([
        ...originalMainProcessRequests,
        ...(await mainProcessFetchRequests(restartedApp)),
      ]).toEqual([]);
    } finally {
      window.off("request", onRequest);
      restartedWindow?.off("request", onRequest);
      await restartedApp.close();
    }
  });
});
