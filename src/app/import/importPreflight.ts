export type ImportPreflightFormat = "csv" | "pdf";

export interface ImportPreflightProgress {
  requestId: string;
  format: ImportPreflightFormat;
  phase: string;
  completedRows: number;
  totalRows: number;
}