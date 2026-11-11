import { test as baseTest, expect } from "./fixtures/electron.js";
import type { Page } from "@playwright/test";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import type { ImportJob, PendingTransactionObservation, Transaction } from "../../src/domain/types.js";
import { RecurringCommitmentsPage } from "./pom/RecurringCommitmentsPage.js";
import { AppShellPage } from "./pom/AppShellPage.js";

const test = baseTest.extend({});

test.describe("local recurring commitment workflow", () => {
  test.use({ nodeEnvironment: "production" });

  test("keeps a new commitment suggested until explicit keyboard confirmation", async ({ window }) => {
    await createLocalHousehold(window, "2026-03-01T08:00:00.000Z");
    const recurring = new RecurringCommitmentsPage(window);
    await expect(recurring.section).toBeVisible();
    await expect(recurring.section).toContainText("Track bills and subscriptions that repeat.");
    await expect(recurring.section).toContainText(
      "Date the first bill is expected. It can differ from when the commitment becomes active."
    );

    await recurring.createSuggestion({
      description: "Synthetic monthly bill",
      currencyCode: "NOK",
      amount: "129.00",
      isVariable: false,
      cadence: "monthly",
      firstDueDateIso: "2026-03-31",
      activeFromIso: "2026-03-01",
    });
    const commitment = window.getByRole("group", {
      name: "Commitment Synthetic monthly bill",
      exact: true,
    });
    await expect(commitment).toContainText("Suggested");
    await expect(window.getByRole("group", {
      name: "Occurrence Synthetic monthly bill due 2026-03-31",
      exact: true,
    })).toHaveCount(0);

    await recurring.confirmWithKeyboard("Synthetic monthly bill");

    await expect(commitment).toContainText("Active");
    const occurrence = window.getByRole("group", {
      name: "Occurrence Synthetic monthly bill due 2026-03-31",
      exact: true,
    });
    await expect(occurrence).toContainText("Upcoming");
    await expect(occurrence).toContainText("Unmatched");
    await expect(occurrence).toContainText(/129,00\s*kr/);

    await window.setViewportSize({ width: 390, height: 844 });
    await expect(occurrence).toBeVisible();
    await expectNoHorizontalOverflow(window);
    const pauseButton = commitment.getByRole("button", { name: "Pause commitment" });
    await expect(pauseButton).toBeVisible();
    const pauseButtonHeight = await pauseButton.evaluate((button) =>
      button.getBoundingClientRect().height
    );
    expect(pauseButtonHeight).toBeGreaterThanOrEqual(44);
  });

  test("supports editing, pausing, and ending a commitment", async ({ window }) => {
    await createLocalHousehold(window, "2026-03-01T08:00:00.000Z");
    const recurring = new RecurringCommitmentsPage(window);
    await expect(recurring.section).toBeVisible();
    await recurring.createSuggestion({
      description: "Synthetic annual insurance",
      currencyCode: "NOK",
      amount: "900.00",
      isVariable: false,
      cadence: "annual",
      firstDueDateIso: "2026-10-15",
      activeFromIso: "2026-10-01",
    });
    await recurring.confirm("Synthetic annual insurance");

    await recurring.editDescription("Synthetic annual insurance", "Synthetic home insurance");
    const commitment = window.getByRole("group", {
      name: "Commitment Synthetic home insurance",
      exact: true,
    });
    await expect(commitment).toContainText("Active");
    await recurring.pauseWithKeyboard("Synthetic home insurance");
    await expect(commitment).toContainText("Paused");
    await recurring.endWithKeyboard("Synthetic home insurance");
    const endConfirmation = window.getByRole("alertdialog", {
      name: "End Synthetic home insurance?",
      exact: true,
    });
    await expect(endConfirmation).toBeVisible();
    await expect(endConfirmation).toContainText("Future scheduled occurrences will stop.");
    await expect(endConfirmation).toContainText("Payment history will remain.");
    await recurring.keepCommitment("Synthetic home insurance");
    await expect(commitment).toContainText("Paused");

    await recurring.endWithKeyboard("Synthetic home insurance");
    await expect(endConfirmation).toBeVisible();
    await recurring.confirmEndCommitment("Synthetic home insurance");
    await expect(commitment).toContainText("Ended");

    await window.reload();
    await new AppShellPage(window).openPlanningTools();
    await expect(window.getByRole("group", {
      name: "Commitment Synthetic home insurance",
      exact: true,
    })).toContainText("Ended");
  });

  test("reopens the end confirmation after keeping a paused commitment", async ({ window }) => {
    await createLocalHousehold(window, "2026-03-01T08:00:00.000Z");
    const recurring = new RecurringCommitmentsPage(window);
    await recurring.createSuggestion({
      description: "Synthetic annual insurance",
      currencyCode: "NOK",
      amount: "900.00",
      isVariable: false,
      cadence: "annual",
      firstDueDateIso: "2026-10-15",
      activeFromIso: "2026-10-01",
    });
    await recurring.confirm("Synthetic annual insurance");
    await recurring.pauseWithKeyboard("Synthetic annual insurance");

    const commitment = window.getByRole("group", {
      name: "Commitment Synthetic annual insurance",
      exact: true,
    });
    await expect(commitment).toContainText("Paused");
    await expect(commitment.getByRole("button", {
      name: "End commitment",
      exact: true,
    })).toBeEnabled();

    const endConfirmation = window.getByRole("alertdialog", {
      name: "End Synthetic annual insurance?",
      exact: true,
    });
    await recurring.endWithKeyboard("Synthetic annual insurance");
    await expect(endConfirmation).toBeVisible();
    await recurring.keepCommitment("Synthetic annual insurance");
    await recurring.endWithKeyboard("Synthetic annual insurance");
    await expect(endConfirmation.getByRole("button", {
      name: "End commitment",
      exact: true,
    })).toBeVisible();
    await recurring.confirmEndCommitment("Synthetic annual insurance");
    await expect(window.getByRole("group", {
      name: "Commitment Synthetic annual insurance",
      exact: true,
    })).toContainText("Ended");
  });

  test("resumes a paused commitment and keeps it active after reload", async ({ window }) => {
    await createLocalHousehold(window, "2026-03-01T08:00:00.000Z");
    const recurring = new RecurringCommitmentsPage(window);
    await expect(recurring.section).toBeVisible();
    await recurring.createSuggestion({
      description: "Synthetic resumable bill",
      currencyCode: "NOK",
      amount: "129.00",
      isVariable: false,
      cadence: "monthly",
      firstDueDateIso: "2026-03-31",
      activeFromIso: "2026-03-01",
    });
    await recurring.confirm("Synthetic resumable bill");

    const commitment = window.getByRole("group", {
      name: "Commitment Synthetic resumable bill",
      exact: true,
    });
    await recurring.pauseWithKeyboard("Synthetic resumable bill");
    await expect(commitment).toContainText("Paused");

    await recurring.resumeWithKeyboard("Synthetic resumable bill");
    await expect(commitment).toContainText("Active");

    await window.reload();
    await new AppShellPage(window).openPlanningTools();
    await expect(window.getByRole("group", {
      name: "Commitment Synthetic resumable bill",
      exact: true,
    })).toContainText("Active");
  });

  test("links a pending payment to one occurrence when it becomes booked", async ({
    databasePath,
    window,
  }) => {
    await createLocalHousehold(window, "2026-04-01T08:00:00.000Z");
    const recurring = new RecurringCommitmentsPage(window);
    await expect(recurring.section).toBeVisible();
    await recurring.createSuggestion({
      description: "Synthetic electricity",
      currencyCode: "NOK",
      amount: "129.00",
      isVariable: false,
      cadence: "monthly",
      firstDueDateIso: "2026-03-31",
      activeFromIso: "2026-03-01",
    });
    await recurring.confirm("Synthetic electricity");

    seedPendingPayment(databasePath);
    await recurring.refresh();
    await recurring.linkPayment(
      "Synthetic electricity",
      "2026-03-31",
      "Synthetic electricity",
      "pending:pending-electricity"
    );
    let occurrence = window.getByRole("group", {
      name: "Occurrence Synthetic electricity due 2026-03-31",
      exact: true,
    });
    await expect(occurrence).toContainText("Matched");
    await expect(occurrence).toContainText("Past due · payment pending");

    bookPendingPayment(databasePath);
    await recurring.refresh();

    occurrence = window.getByRole("group", {
      name: "Occurrence Synthetic electricity due 2026-03-31",
      exact: true,
    });
    await expect(occurrence).toContainText("Matched");
    await expect(window.getByRole("group", {
      name: "Occurrence Synthetic electricity due 2026-03-31",
      exact: true,
    })).toHaveCount(1);
    await expect(occurrence).toContainText("Paid on time");
    await expect(occurrence).not.toContainText("Past due");
    await window.setViewportSize({ width: 390, height: 844 });
    await expect(occurrence).toBeVisible();
    await expectNoHorizontalOverflow(window);
  });

  test("requires confirmation before applying an observed price change", async ({
    databasePath,
    window,
  }) => {
    await createLocalHousehold(window, "2026-05-01T08:00:00.000Z");
    const recurring = new RecurringCommitmentsPage(window);
    await expect(recurring.section).toBeVisible();
    await recurring.createSuggestion({
      description: "Synthetic subscription",
      currencyCode: "NOK",
      amount: "129.00",
      isVariable: false,
      cadence: "monthly",
      firstDueDateIso: "2026-03-31",
      activeFromIso: "2026-03-01",
    });
    await recurring.confirm("Synthetic subscription");
    seedBookedPayments(databasePath);
    await recurring.refresh();

    await recurring.linkPayment(
      "Synthetic subscription",
      "2026-03-31",
      "Synthetic Stream Provider",
      "transaction:transaction-march"
    );
    await recurring.linkPayment(
      "Synthetic subscription",
      "2026-04-30",
      "Synthetic Stream Provider",
      "transaction:transaction-april"
    );
    const review = window.getByRole("region", {
      name: "Price change review Synthetic subscription",
      exact: true,
    });
    await expect(review).toContainText(/129,00\s*kr/);
    await expect(review).toContainText(/179,00\s*kr/);
    await expect(review).toContainText(/50,00\s*kr/);
    await expect(review).toContainText("Previous payment");
    await expect(review).toContainText("Latest payment");
    await expect(review).toContainText(/31\.\s*mars\s*2026/);
    await expect(review).toContainText(/30\.\s*apr\.\s*2026/);
    await expect(review).toContainText("Synthetic Stream Provider");
    const schedule = recurring.section.getByRole("region", {
      name: "Recurring schedule",
      exact: true,
    });
    await window.setViewportSize({ width: 1280, height: 800 });
    const desktopReviewTop = await review.evaluate((element) =>
      element.getBoundingClientRect().top
    );
    const desktopScheduleTop = await schedule.evaluate((element) =>
      element.getBoundingClientRect().top
    );
    expect(desktopReviewTop).toBeLessThan(desktopScheduleTop);
    await window.setViewportSize({ width: 390, height: 844 });
    const compactReviewTop = await review.evaluate((element) =>
      element.getBoundingClientRect().top
    );
    const compactScheduleTop = await schedule.evaluate((element) =>
      element.getBoundingClientRect().top
    );
    expect(compactReviewTop).toBeLessThan(compactScheduleTop);

    const commitment = window.getByRole("group", {
      name: "Commitment Synthetic subscription",
      exact: true,
    });
    await expect(commitment).toContainText(/129,00\s*kr/);
    await recurring.confirmPriceChange("Synthetic subscription");

    await expect(commitment).toContainText(/179,00\s*kr/);
    await expect(review).toHaveCount(0);
  });

  test("labels variable and missing-rate states at compact width", async ({ window }) => {
    await createLocalHousehold(window, "2026-05-01T08:00:00.000Z");
    const recurring = new RecurringCommitmentsPage(window);
    await expect(recurring.section).toBeVisible();
    await recurring.createSuggestion({
      description: "Synthetic variable electricity",
      currencyCode: "EUR",
      amount: "",
      isVariable: true,
      cadence: "monthly",
      firstDueDateIso: "2026-05-31",
      activeFromIso: "2026-05-01",
    });
    await recurring.confirm("Synthetic variable electricity");
    await recurring.createSuggestion({
      description: "Synthetic missing-rate bill",
      currencyCode: "EUR",
      amount: "54.00",
      isVariable: false,
      cadence: "monthly",
      firstDueDateIso: "2026-05-30",
      activeFromIso: "2026-05-01",
    });
    await recurring.confirm("Synthetic missing-rate bill");
    await recurring.createSuggestion({
      description: "Synthetic overdue insurance",
      currencyCode: "NOK",
      amount: "54.00",
      isVariable: false,
      cadence: "monthly",
      firstDueDateIso: "2026-04-15",
      activeFromIso: "2026-04-01",
    });
    await recurring.confirm("Synthetic overdue insurance");

    await window.setViewportSize({ width: 1280, height: 800 });
    const variableOccurrence = window.getByRole("group", {
      name: "Occurrence Synthetic variable electricity due 2026-05-31",
      exact: true,
    });
    await expect(variableOccurrence).toContainText("Estimate");
    await expect(variableOccurrence).toContainText("Amount unknown");
    await expect(variableOccurrence).toContainText("Original amount (EUR)");
    await expect(variableOccurrence).toContainText(
      "NOK equivalent unavailable until an amount is known"
    );
    const missingRateOccurrence = window.getByRole("group", {
      name: "Occurrence Synthetic missing-rate bill due 2026-05-30",
      exact: true,
    });
    await expect(missingRateOccurrence).toContainText("Original amount (EUR)");
    await expect(missingRateOccurrence).toContainText(
      "NOK conversion incomplete — no local rate is available for this due date."
    );
    const overdueOccurrence = window.getByRole("group", {
      name: "Occurrence Synthetic overdue insurance due 2026-04-15",
      exact: true,
    });
    await expect(overdueOccurrence).toContainText("Past due");
    await expect(overdueOccurrence).toContainText("Unmatched");

    await window.setViewportSize({ width: 390, height: 844 });
    await expect(variableOccurrence).toBeVisible();
    await expectNoHorizontalOverflow(window);
  });

  test("finds local transaction history for an old overdue occurrence", async ({
    databasePath,
    window,
  }) => {
    await createLocalHousehold(window, "2026-05-01T08:00:00.000Z");
    const recurring = new RecurringCommitmentsPage(window);
    await expect(recurring.section).toBeVisible();
    await recurring.createSuggestion({
      description: "Synthetic historical bill",
      currencyCode: "NOK",
      amount: "129.00",
      isVariable: false,
      cadence: "monthly",
      firstDueDateIso: "2024-01-31",
      activeFromIso: "2024-01-01",
    });
    await recurring.confirm("Synthetic historical bill");
    seedOldRecurringPayment(databasePath);
    await recurring.refresh();

    const occurrence = window.getByRole("group", {
      name: "Occurrence Synthetic historical bill due 2024-01-31",
      exact: true,
    });
    await expect(occurrence).toContainText("Past due");
    await expect(occurrence).toContainText("Unmatched");
    await window.setViewportSize({ width: 390, height: 844 });
    await expect(occurrence).toBeVisible();
    await expectNoHorizontalOverflow(window);
    await recurring.linkPayment(
      "Synthetic historical bill",
      "2024-01-31",
      "Synthetic historical bill",
      "transaction:transaction-old-recurring-payment"
    );
    await expect(occurrence).toContainText("Paid late");
    await expect(occurrence).not.toContainText("Past due");
    await expect(occurrence).toContainText("Matched to booked transaction");
    await expect(occurrence).toHaveCount(1);
  });
});

async function createLocalHousehold(window: Page, frozenTimeIso: string): Promise<void> {
  await expect(window.getByRole("heading", { name: "Set up your household", exact: true }))
    .toBeVisible();
  await window.clock.install({ time: new Date(frozenTimeIso) });
  await window.getByLabel("Household name").fill("Synthetic household");
  await window.getByLabel("Account name").fill("Synthetic current account");
  await window.getByRole("button", { name: "Create local ledger", exact: true }).click();
  await expect(window.getByRole("heading", { name: "Budget Planner", exact: true }))
    .toBeVisible();
  await new AppShellPage(window).openPlanningTools();
}

async function expectNoHorizontalOverflow(window: Page): Promise<void> {
  const horizontalOverflow = await window.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(horizontalOverflow).toBe(false);
}

function seedPendingPayment(databasePath: string): void {
  const ledger = createLocalLedgerDatabase({ dbPath: databasePath });
  const metadata = ledger.loadRuntimeMetadata();
  if (metadata === null) throw new Error("Synthetic household setup failed.");
  const importJob: ImportJob = {
    id: "job-pending-electricity",
    householdId: metadata.household.id,
    sourceType: "csv",
    sourceName: "synthetic-pending.csv",
    startedAtIso: "2026-03-30T08:00:00.000Z",
  };
  const pending: PendingTransactionObservation = {
    id: "pending-electricity",
    householdId: metadata.household.id,
    accountId: metadata.accounts[0]!.id,
    transactionDateIso: "2026-03-31",
    amountMinor: -12_900,
    merchantRaw: "Synthetic electricity",
    sourceRowIndex: 1,
    currencyCode: "NOK",
    sourceType: "csv",
    sourceReference: "electricity-2026-03",
    importJobId: importJob.id,
    status: "confirmed",
    sourceStatus: "Bekreftet",
  };
  try {
    ledger.appendImportJobAndTransactions(importJob, [], [], [pending]);
  } finally {
    ledger.close();
  }
}

function bookPendingPayment(databasePath: string): void {
  const ledger = createLocalLedgerDatabase({ dbPath: databasePath });
  const metadata = ledger.loadRuntimeMetadata();
  if (metadata === null) throw new Error("Synthetic household setup failed.");
  const importJob: ImportJob = {
    id: "job-booked-electricity",
    householdId: metadata.household.id,
    sourceType: "csv",
    sourceName: "synthetic-booked.csv",
    startedAtIso: "2026-04-01T08:00:00.000Z",
  };
  const transaction: Transaction = {
    id: "transaction-electricity",
    householdId: metadata.household.id,
    accountId: metadata.accounts[0]!.id,
    bookedAtIso: "2026-03-31T12:00:00.000Z",
    amountMinor: -12_900,
    merchantRaw: "Synthetic electricity",
    currencyCode: "NOK",
    sourceType: "csv",
    sourceReference: "electricity-2026-03",
    importJobId: importJob.id,
  };
  try {
    ledger.appendImportJobAndTransactions(importJob, [transaction]);
  } finally {
    ledger.close();
  }
}

function seedBookedPayments(databasePath: string): void {
  const ledger = createLocalLedgerDatabase({ dbPath: databasePath });
  const metadata = ledger.loadRuntimeMetadata();
  if (metadata === null) throw new Error("Synthetic household setup failed.");
  const account = metadata.accounts.find((candidate) => candidate.currencyCode === "NOK");
  if (account === undefined) throw new Error("Synthetic NOK account setup failed.");
  const transactions: Transaction[] = [
    {
      id: "transaction-march",
      householdId: metadata.household.id,
      accountId: account.id,
      bookedAtIso: "2026-03-31T12:00:00.000Z",
      amountMinor: -12_900,
      merchantRaw: "Synthetic Stream Provider",
      currencyCode: "NOK",
      sourceType: "manual",
    },
    {
      id: "transaction-april",
      householdId: metadata.household.id,
      accountId: account.id,
      bookedAtIso: "2026-04-30T12:00:00.000Z",
      amountMinor: -17_900,
      merchantRaw: "Synthetic Stream Provider",
      currencyCode: "NOK",
      sourceType: "manual",
    },
  ];
  try {
    ledger.appendTransactions(transactions);
  } finally {
    ledger.close();
  }
}

function seedOldRecurringPayment(databasePath: string): void {
  const ledger = createLocalLedgerDatabase({ dbPath: databasePath });
  const metadata = ledger.loadRuntimeMetadata();
  if (metadata === null) throw new Error("Synthetic household setup failed.");
  const account = metadata.accounts.find((candidate) => candidate.currencyCode === "NOK");
  if (account === undefined) throw new Error("Synthetic NOK account setup failed.");
  const transaction: Transaction = {
    id: "transaction-old-recurring-payment",
    householdId: metadata.household.id,
    accountId: account.id,
    bookedAtIso: "2024-02-02T12:00:00.000Z",
    amountMinor: -12_900,
    merchantRaw: "Synthetic historical bill",
    currencyCode: "NOK",
    sourceType: "manual",
  };
  try {
    ledger.appendTransactions([transaction]);
  } finally {
    ledger.close();
  }
}
