import { parse } from "csv-parse/sync";
import type { ExchangeRate } from "../domain/types.js";
import { validateExchangeRate } from "../domain/money/exchangeRates.js";

export function parseExchangeRateCsv(csvText: string, sourceName: string): ExchangeRate[] {
  if (sourceName.trim().length === 0) {
    throw new Error("Exchange rate CSV source name must be non-empty.");
  }

  const parsedRows: unknown = parse(csvText, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
    throw new Error("Exchange rate CSV must contain at least one data row.");
  }

  const seenRateKeys = new Set<string>();
  return parsedRows.map((row, index) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error(`Exchange rate CSV row ${index + 2} is invalid.`);
    }

    const values = row as Record<string, unknown>;
    const currencyCode = values["currencyCode"];
    const rateNokPerUnit = values["rateNokPerUnit"];
    const effectiveDate = values["effectiveDate"];
    const kind = values["kind"];
    if (
      typeof currencyCode !== "string" ||
      typeof rateNokPerUnit !== "string" ||
      typeof effectiveDate !== "string" ||
      typeof kind !== "string"
    ) {
      throw new Error(`Exchange rate CSV row ${index + 2} is missing a required field.`);
    }

    const rate = validateExchangeRate({
      id: `rate-${currencyCode.trim().toUpperCase()}-${effectiveDate}-${kind}`,
      currencyCode,
      rateNokPerUnit,
      effectiveDate,
      kind,
      source: sourceName,
      provenance: "local-file",
    });
    const rateKey = `${rate.currencyCode}/${rate.effectiveDate}/${rate.kind}`;
    if (seenRateKeys.has(rateKey)) {
      throw new Error(
        `Exchange rate CSV contains duplicate ${rate.currencyCode} ${rate.kind} rates for ${rate.effectiveDate}.`
      );
    }
    seenRateKeys.add(rateKey);
    return rate;
  });
}
