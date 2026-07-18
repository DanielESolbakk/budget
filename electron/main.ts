import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import {
  buildDashboardData,
  buildDashboardViewContract,
  createMonthlyCategoryTargetStore,
  type DashboardData,
  type DashboardViewContract,
} from "../src/app/dashboardApi.js";
import type { MonthlyTotal, Transaction } from "../src/domain/types.js";

const sampleMonthlyTotals: MonthlyTotal[] = [
  { yearMonth: "2026-03", totalMinor: 48000 },
  { yearMonth: "2026-04", totalMinor: 51000 },
  { yearMonth: "2026-05", totalMinor: 54000 },
];

// Sample transactions used to build monthly view contracts with income/expense/category breakdown.
const sampleTransactions: Transaction[] = [
  {
    id: "sample-tx-1",
    householdId: "sample-hh",
    accountId: "sample-acc",
    bookedAtIso: "2026-04-15T10:00:00Z",
    amountMinor: 51000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
  {
    id: "sample-tx-2",
    householdId: "sample-hh",
    accountId: "sample-acc",
    bookedAtIso: "2026-04-20T10:00:00Z",
    amountMinor: -7200,
    merchantRaw: "Kiwi",
    categoryId: "groceries",
  },
  {
    id: "sample-tx-3",
    householdId: "sample-hh",
    accountId: "sample-acc",
    bookedAtIso: "2026-05-02T10:00:00Z",
    amountMinor: 54000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
  {
    id: "sample-tx-4",
    householdId: "sample-hh",
    accountId: "sample-acc",
    bookedAtIso: "2026-05-15T10:00:00Z",
    amountMinor: -8500,
    merchantRaw: "Rema 1000",
    categoryId: "groceries",
  },
];

const sampleTargetStore = createMonthlyCategoryTargetStore([
  {
    yearMonth: "2026-04",
    categoryId: "groceries",
    targetMinor: 7000,
  },
  {
    yearMonth: "2026-05",
    categoryId: "groceries",
    targetMinor: 9000,
  },
]);

function getDashboardData(): DashboardData {
  return buildDashboardData({ monthlyTotals: sampleMonthlyTotals });
}

function getViewData(yearMonth: string): DashboardViewContract {
  return buildDashboardViewContract({
    transactions: sampleTransactions,
    selectedYearMonth: yearMonth,
    monthlyCategoryTargetStore: sampleTargetStore,
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  ipcMain.handle("dashboard:getData", () => {
    return getDashboardData();
  });

  ipcMain.handle("dashboard:getViewData", (_event, yearMonth: string) => {
    return getViewData(yearMonth);
  });

  ipcMain.handle("forecast:getEntries", () => {
    return getDashboardData().forecast.entries;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
