import { readFile } from "node:fs/promises";
import { basename, extname } from "path";
import type { NokMonthlyReport } from "../../src/app/dashboardApi.js";
import {
  buildNokMonthlyReport,
  queryAccountCoverageAssessment,
  queryNokValuationReport,
  reloadMonthlyCategoryTargets,
  type CashflowScenarioRequest,
} from "../../src/app/dashboardApi.js";
import { parseExchangeRateCsv } from "../../src/app/exchangeRateImport.js";
import { validateCashflowScenarioRequest } from "../../src/domain/forecast/cashflowScenarios.js";
import { validateExchangeRate } from "../../src/domain/money/exchangeRates.js";
import { isCurrencyCode, validateMonthlyCategoryTargetInput } from "../../src/domain/types.js";
import type { LedgerChannelContext } from "./context.js";
import {
  parseAccountBalanceCheckpointInput,
  parseAccountStatementCoveragePeriodInput,
  parseCategoryTargetInput,
  parseMonthlyReferenceRateIds,
  parseNonEmptyString,
  parseSpendableCashEstimateRequest,
} from "./validation.js";
export function registerReportsChannels({
  ipcMain,
  assertTrustedRenderer,
  localLedgerDatabase,
  sampleTargetStore,
  spendableCashService,
  cashflowScenarioService,
  ledgerOperationCoordinator,
  getDashboardData,
  dashboardProvider,
  exchangeRateImportDialog
}: Pick<LedgerChannelContext,
  | "ipcMain"
  | "assertTrustedRenderer"
  | "localLedgerDatabase"
  | "sampleTargetStore"
  | "spendableCashService"
  | "cashflowScenarioService"
  | "ledgerOperationCoordinator"
  | "getDashboardData"
  | "dashboardProvider"
  | "exchangeRateImportDialog"
>): void {

  ipcMain.handle("dashboard:getData", (event) => {
    assertTrustedRenderer(event);
    return dashboardProvider.getData();
  });

  ipcMain.handle("dashboard:getViewData", (event, yearMonth: unknown) => {
    assertTrustedRenderer(event);
    return dashboardProvider.getViewData(parseNonEmptyString(yearMonth, "yearMonth"));
  }
  );

  ipcMain.handle("forecast:getEntries", (event) => {
    assertTrustedRenderer(event);
    return getDashboardData().forecast.entries;
  });

  ipcMain.handle("spendableCash:estimate", (event, input: unknown) => {
    assertTrustedRenderer(event);
    return spendableCashService.getEstimate(parseSpendableCashEstimateRequest(input));
  });

  ipcMain.handle("cashflowScenario:evaluate", (event, input: unknown) => {
    assertTrustedRenderer(event);
    const request: CashflowScenarioRequest = validateCashflowScenarioRequest(input);
    return cashflowScenarioService.getScenario(request);
  });

  ipcMain.handle("categoryTarget:upsert", (event, input: unknown) => {
    assertTrustedRenderer(event);
    return ledgerOperationCoordinator.runExclusive(() => {
      const validated = validateMonthlyCategoryTargetInput(parseCategoryTargetInput(input));
      const key = `${validated.yearMonth}::${validated.categoryId}`;
      const persisted = {
        yearMonth: validated.yearMonth,
        categoryId: validated.categoryId,
        targetMinor: validated.targetMinor,
      };
      localLedgerDatabase.upsertMonthlyCategoryTarget(persisted);
      sampleTargetStore.targetsByMonthAndCategory.set(key, persisted);
      return { ...persisted };
    });
  });

  ipcMain.handle("categoryTarget:listByMonth", (event, yearMonth: unknown) => {
    assertTrustedRenderer(event);
    return reloadMonthlyCategoryTargets(sampleTargetStore, parseNonEmptyString(yearMonth, "yearMonth"));
  });

  ipcMain.handle("exchangeRate:list", (event, currencyCode: unknown) => {
    assertTrustedRenderer(event);
    if (currencyCode === undefined || currencyCode === null || currencyCode === "") {
      return localLedgerDatabase.listExchangeRates();
    }
    if (!isCurrencyCode(currencyCode)) {
      throw new Error("Exchange rate currencyCode must be a three-letter currency code.");
    }
    return localLedgerDatabase.listExchangeRates(currencyCode);
  });

  ipcMain.handle("exchangeRate:record", (event, input: unknown) => {
    assertTrustedRenderer(event);
    const rate = validateExchangeRate(input);
    return ledgerOperationCoordinator.runExclusive(() => {
      localLedgerDatabase.upsertExchangeRate(rate);
      return rate;
    });
  });

  ipcMain.handle("exchangeRate:importFromFile", async (event) => {
    assertTrustedRenderer(event);
    const dialogResult = await exchangeRateImportDialog({
      properties: ["openFile"],
      filters: [{ name: "CSV files", extensions: ["csv"] }],
    });
    const filePath = dialogResult.canceled ? null : dialogResult.filePaths[0] ?? null;
    if (filePath === null) return null;
    if (extname(filePath).toLowerCase() !== ".csv") {
      throw new Error("Exchange rate import requires a CSV file.");
    }
    const rates = parseExchangeRateCsv(await readFile(filePath, "utf8"), basename(filePath));
    return ledgerOperationCoordinator.runExclusive(() => {
      localLedgerDatabase.upsertExchangeRates(rates);
      return rates;
    });
  });

  ipcMain.handle("exchangeRate:monthlyReport", (event, input: unknown): NokMonthlyReport => {
    assertTrustedRenderer(event);
    if (typeof input !== "object" || input === null) {
      throw new Error("Converted report request must be an object.");
    }
    const record = input as Record<string, unknown>;
    if (
      record.useLatestRateScenario !== undefined &&
      typeof record.useLatestRateScenario !== "boolean"
    ) {
      throw new Error("useLatestRateScenario must be a boolean when provided.");
    }
    const yearMonth = parseNonEmptyString(record.yearMonth, "yearMonth");
    const snapshot = localLedgerDatabase.loadLedgerSnapshotData();
    const monthlyReferenceRateIds = parseMonthlyReferenceRateIds(record.monthlyReferenceRateIds);
    return buildNokMonthlyReport({
      transactions: snapshot.transactions,
      accounts: snapshot.accounts,
      rates: localLedgerDatabase.listExchangeRates(),
      yearMonth,
      ...(monthlyReferenceRateIds === undefined
        ? {}
        : { monthlyReferenceRateIds }),
      ...(record.useLatestRateScenario === undefined
        ? {}
        : { useLatestRateScenario: record.useLatestRateScenario }),
    });
  });

  ipcMain.handle("exchangeRate:valuationReport", (event, input: unknown) => {
    assertTrustedRenderer(event);
    if (typeof input !== "object" || input === null) {
      throw new Error("Valuation report request must be an object.");
    }
    const record = input as Record<string, unknown>;
    const valuationDateIso = parseNonEmptyString(record.valuationDateIso, "valuationDateIso");
    const monthlyReferenceRateIds = parseMonthlyReferenceRateIds(record.monthlyReferenceRateIds);
    return queryNokValuationReport(
      localLedgerDatabase,
      valuationDateIso,
      monthlyReferenceRateIds
    );
  });

  ipcMain.handle("accountCoverage:periods:list", (event, accountId: unknown) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listAccountStatementCoveragePeriods(
      parseNonEmptyString(accountId, "accountId")
    );
  });

  ipcMain.handle("accountCoverage:period:save", (event, input: unknown) => {
    assertTrustedRenderer(event);
    const period = parseAccountStatementCoveragePeriodInput(input);
    return ledgerOperationCoordinator.runExclusive(() => {
      localLedgerDatabase.saveAccountStatementCoveragePeriod(period);
      return period;
    });
  });

  ipcMain.handle("accountCoverage:checkpoints:list", (event, accountId: unknown) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listAccountBalanceCheckpoints(
      parseNonEmptyString(accountId, "accountId")
    );
  });

  ipcMain.handle("accountCoverage:checkpoint:append", (event, input: unknown) => {
    assertTrustedRenderer(event);
    const checkpoint = parseAccountBalanceCheckpointInput(input);
    return ledgerOperationCoordinator.runExclusive(() => {
      localLedgerDatabase.appendAccountBalanceCheckpoint(checkpoint);
      return checkpoint;
    });
  });

  ipcMain.handle("accountCoverage:assessment:get", (event, input: unknown) => {
    assertTrustedRenderer(event);
    if (typeof input !== "object" || input === null) {
      throw new Error("Account coverage assessment request must be an object.");
    }
    const record = input as Record<string, unknown>;
    return queryAccountCoverageAssessment(
      localLedgerDatabase,
      parseNonEmptyString(record.periodId, "periodId"),
      parseNonEmptyString(record.evaluatedAtIso, "evaluatedAtIso")
    );
  });
}
