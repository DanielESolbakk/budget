export interface Household {
  id: string;
  name: string;
  createdAtIso: string;
}

export interface Account {
  id: string;
  householdId: string;
  name: string;
  currencyCode: "NOK";
}

export interface Transaction {
  id: string;
  householdId: string;
  accountId: string;
  bookedAtIso: string;
  amountMinor: number;
  merchantRaw: string;
  merchantAlias?: string;
  categoryId?: string;
  importJobId?: string;
}

export interface ImportJob {
  id: string;
  householdId: string;
  sourceType: "csv" | "pdf" | "manual";
  sourceName: string;
  startedAtIso: string;
  finishedAtIso?: string;
}

export interface MonthlyTotal {
  /** Calendar month in YYYY-MM format, e.g. "2026-05". */
  yearMonth: string;
  totalMinor: number;
}

export type ForecastMethod = "moving-average-3m" | "fallback-zero";

export interface ForecastEntry {
  /** Calendar month in YYYY-MM format, e.g. "2026-06". */
  yearMonth: string;
  projectedMinor: number;
  method: ForecastMethod;
}

export interface ForecastResult {
  entries: ForecastEntry[];
  usedFallback: boolean;
}