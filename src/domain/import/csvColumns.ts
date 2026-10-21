export const CSV_COLUMN_NAMES = {
  executionDate: "Utført dato",
  bookedDate: "Bokført dato",
  description: "Beskrivelse",
  amountIn: "Beløp inn",
  amountOut: "Beløp ut",
  currency: "Valuta",
  status: "Status",
  reference: "Melding/KID/Fakt.nr",
} as const;

export type CsvColumnKey = keyof typeof CSV_COLUMN_NAMES;
export type CsvColumnMapping = Partial<Record<CsvColumnKey, string>>;
