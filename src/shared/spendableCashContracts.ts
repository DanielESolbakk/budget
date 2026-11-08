

export interface SpendableCashEstimateRequest {
  selectedAccountIds: string[];
  nextIncomeDateIso: string;
  reserveMinor: number;
  monthlyReferenceRateIds?: Readonly<Record<string, string>>;
}
