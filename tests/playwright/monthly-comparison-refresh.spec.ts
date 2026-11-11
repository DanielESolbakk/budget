import { test, expect } from "./fixtures/electron.js";

test("refreshes the previous-month comparison after a backdated manual transaction", async ({
  appShell,
  dashboard,
  manualEntry,
}) => {
  await appShell.openWorkspace("Review");
  await dashboard.selectMonth("2026-05");
  await expect(dashboard.monthlyComparison).toContainText(/Spending increased by 13,00.*apr\. 2026/i);

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
  await expect(dashboard.monthlyComparison).toContainText(/Spending increased by 3,00.*apr\. 2026/i);
});
