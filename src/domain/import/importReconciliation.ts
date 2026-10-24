import type { CurrencyCode, Transaction } from "../types.js";
import { isCurrencyCode } from "../types.js";

export type ImportReconciliationDirection = "incoming" | "outgoing";

export type ImportReconciliationDisposition =
  | "persisted"
  | "pending"
  | "unresolved"
  | "invalid"
  | "duplicate"
  | "skipped"
  | "not-persisted";

export interface ImportReconciliationSourceRow {
  importJobId: string;
  sourceRowIndex: number;
  amountMinor?: number;
  currencyCode?: CurrencyCode;
  disposition?: ImportReconciliationDisposition;
  reviewItemId?: string;
}

export interface ImportReconciliationRow {
  sourceRowIndex: number;
  amountMinor?: number;
  currencyCode: CurrencyCode;
  disposition: ImportReconciliationDisposition | "unaccounted";
  reviewItemId?: string;
}

export interface ImportReconciliationAmount {
  currencyCode: CurrencyCode;
  direction: ImportReconciliationDirection;
  sourceTotalMinor: number;
  persistedTotalMinor: number;
  differenceMinor: number;
  matched: boolean;
}

export interface ImportReconciliation {
  importJobId: string;
  amounts: ImportReconciliationAmount[];
  rows: ImportReconciliationRow[];
  fullyReconciled: boolean;
}

const DIRECTIONS: readonly ImportReconciliationDirection[] = ["incoming", "outgoing"];

function normalizedCurrencyCode(value: string | undefined, fallback: CurrencyCode): CurrencyCode {
  const currencyCode = value?.trim().toUpperCase() || fallback;
  if (!isCurrencyCode(currencyCode)) {
    throw new Error(`Invalid import reconciliation currency code: ${currencyCode}`);
  }
  return currencyCode;
}

function amountDirection(amountMinor: number): ImportReconciliationDirection | undefined {
  if (amountMinor > 0) return "incoming";
  if (amountMinor < 0) return "outgoing";
  return undefined;
}

function totalKey(currencyCode: CurrencyCode, direction: ImportReconciliationDirection): string {
  return `${currencyCode}:${direction}`;
}

function addMinorUnits(totals: Map<string, number>, key: string, amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error("Import reconciliation amounts must use safe integer minor units.");
  }
  const total = (totals.get(key) ?? 0) + amountMinor;
  if (!Number.isSafeInteger(total)) {
    throw new Error("Import reconciliation total exceeds safe integer minor units.");
  }
  totals.set(key, total);
}

export function reconcileImportJob(
  importJobId: string,
  sourceRows: readonly ImportReconciliationSourceRow[],
  persistedTransactions: readonly Transaction[],
  defaultCurrencyCode: CurrencyCode
): ImportReconciliation {
  if (!importJobId.trim()) {
    throw new Error("An import job id is required for reconciliation.");
  }
  if (!isCurrencyCode(defaultCurrencyCode)) {
    throw new Error(`Invalid default import reconciliation currency code: ${defaultCurrencyCode}`);
  }

  const jobSourceRows = sourceRows.filter((row) => row.importJobId === importJobId);
  const jobTransactions = persistedTransactions.filter(
    (transaction) => transaction.importJobId === importJobId
  );
  const currencies = new Set<CurrencyCode>();
  const sourceTotals = new Map<string, number>();
  const persistedTotals = new Map<string, number>();
  const seenSourceRowIndices = new Set<number>();

  for (const row of jobSourceRows) {
    if (!Number.isSafeInteger(row.sourceRowIndex) || row.sourceRowIndex < 0) {
      throw new Error("Import reconciliation source row indices must be non-negative integers.");
    }
    if (seenSourceRowIndices.has(row.sourceRowIndex)) {
      throw new Error(`Duplicate import reconciliation source row index: ${row.sourceRowIndex}`);
    }
    seenSourceRowIndices.add(row.sourceRowIndex);

    const currencyCode = normalizedCurrencyCode(row.currencyCode, defaultCurrencyCode);
    currencies.add(currencyCode);
    if (row.amountMinor === undefined) continue;
    const direction = amountDirection(row.amountMinor);
    if (direction !== undefined) {
      addMinorUnits(sourceTotals, totalKey(currencyCode, direction), row.amountMinor);
    }
  }

  for (const transaction of jobTransactions) {
    const currencyCode = normalizedCurrencyCode(transaction.currencyCode, defaultCurrencyCode);
    currencies.add(currencyCode);
    const direction = amountDirection(transaction.amountMinor);
    if (direction !== undefined) {
      addMinorUnits(persistedTotals, totalKey(currencyCode, direction), transaction.amountMinor);
    }
  }

  const amounts = Array.from(currencies)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((currencyCode) =>
      DIRECTIONS.map((direction) => {
        const key = totalKey(currencyCode, direction);
        const sourceTotalMinor = sourceTotals.get(key) ?? 0;
        const persistedTotalMinor = persistedTotals.get(key) ?? 0;
        const differenceMinor = sourceTotalMinor - persistedTotalMinor;
        if (!Number.isSafeInteger(differenceMinor)) {
          throw new Error("Import reconciliation difference exceeds safe integer minor units.");
        }
        return {
          currencyCode,
          direction,
          sourceTotalMinor,
          persistedTotalMinor,
          differenceMinor,
          matched: differenceMinor === 0,
        };
      })
    );

  const rows = jobSourceRows
    .slice()
    .sort((left, right) => left.sourceRowIndex - right.sourceRowIndex)
    .map((row): ImportReconciliationRow => {
      const result: ImportReconciliationRow = {
        sourceRowIndex: row.sourceRowIndex,
        currencyCode: normalizedCurrencyCode(row.currencyCode, defaultCurrencyCode),
        disposition: row.disposition ?? "unaccounted",
      };
      if (row.amountMinor !== undefined) result.amountMinor = row.amountMinor;
      if (row.reviewItemId !== undefined) result.reviewItemId = row.reviewItemId;
      return result;
    });
  const fullyReconciled =
    rows.length > 0 &&
    rows.every((row) => row.disposition === "persisted" && row.amountMinor !== undefined) &&
    amounts.every((amount) => amount.matched);

  return { importJobId, amounts, rows, fullyReconciled };
}
