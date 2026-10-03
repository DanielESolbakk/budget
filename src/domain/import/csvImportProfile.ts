import type { CsvColumnMapping } from "./csvRowMapper.js";

export interface CsvImportProfile {
  id: string;
  householdId: string;
  name: string;
  accountId: string;
  columnMapping: CsvColumnMapping;
  createdAtIso: string;
  updatedAtIso: string;
}