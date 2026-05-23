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