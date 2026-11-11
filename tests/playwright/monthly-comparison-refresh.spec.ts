import { test, expect } from "./fixtures/electron.js";

test("qualifies an in-progress period instead of claiming spending improved against a full month", async ({
  dashboard,
  window,
}) => {
  await window.clock.setFixedTime(new Date("2026-05-15T12:00:00"));
  await dashboard.selectMonth("2026-05");
  await expect(dashboard.monthlyTotalsSection.getByText("In progress", { exact: true })).toBeVisible();
  await expect(dashboard.monthlyComparison.getByRole("group", { name: "Selected period spending" })).toContainText("In progress");
  await expect(dashboard.monthlyComparison.getByRole("group", { name: "Previous period spending" })).toContainText("Ended");
  await expect(dashboard.monthlyComparison.getByRole("group", { name: "Selected period spending" })).toContainText("1 May 2026 - 31 May 2026");
  await expect(dashboard.monthlyComparison.getByRole("group", { name: "Previous period spending" })).toContainText("1 April 2026 - 30 April 2026");
  await expect(dashboard.monthlyComparison).toContainText("not a like-for-like comparison");
  await expect(dashboard.monthlyComparison).not.toContainText(/Spending (increased|decreased)/);
});

test("refreshes the previous-month comparison after a backdated manual transaction", async ({
  appShell,
  dashboard,
  manualEntry,
}) => {
  await appShell.openWorkspace("Review");
  await dashboard.selectMonth("2026-05");
  await expect(dashboard.monthlyComparison).toContainText(/Spending increased by 13,00.*April 2026/i);

  await appShell.openWorkspace("Import");
  await manualEntry.submitEntry({
    accountId: "sample-acc",
    bookedAtIso: "2026-04-25",
    amountNok: "-10,00",
    merchantRaw: "SYNTHETIC BACKDATED GROCERY",
    categoryId: "groceries",
  });
  await expect(manualEntry.successStatus).toContainText("Added");

  await appShell.openWorkspace("Review");
  await expect(dashboard.monthlyComparison).toContainText(/Spending increased by 3,00.*April 2026/i);
});
