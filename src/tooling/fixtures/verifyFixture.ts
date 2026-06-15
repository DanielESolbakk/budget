import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readFixtureCsv, rowsToObjects } from "./fixtureCsv.js";

export interface VerifyFixtureOptions {
  inputPath: string;
  reportPath?: string;
}

export interface VerificationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    rowCount: number;
    nonNokRowCount: number;
    reservedRowCount: number;
    transferRowCount: number;
    fxRowCount: number;
    kidReferenceCount: number;
    uniqueMerchantCount: number;
  };
}

const expectedHeaders = [
  "Utført dato",
  "Bokført dato",
  "Rentedato",
  "Beskrivelse",
  "Type",
  "Undertype",
  "Fra konto",
  "Avsender",
  "Til konto",
  "Mottakernavn",
  "Beløp inn",
  "Beløp ut",
  "Valuta",
  "Status",
  "Melding/KID/Fakt.nr"
];

function isValidNorwegianDate(value: string): boolean {
  const dateMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!dateMatch) {
    return false;
  }

  const day = Number(dateMatch[1] ?? "0");
  const month = Number(dateMatch[2] ?? "0");
  const year = Number(dateMatch[3] ?? "0");
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isNumericAmount(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value);
}

function normalizeMerchantKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

export function verifyFixture(options: VerifyFixtureOptions): VerificationReport {
  const parsed = readFixtureCsv(options.inputPath);
  const records = rowsToObjects(parsed);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (parsed.header.join("|") !== expectedHeaders.join("|")) {
    errors.push("CSV header does not match the expected import fixture schema.");
  }

  const merchantVariants = new Map<string, Set<string>>();
  let nonNokRowCount = 0;
  let reservedRowCount = 0;
  let transferRowCount = 0;
  let fxRowCount = 0;
  let kidReferenceCount = 0;

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const dateColumns = ["Utført dato", "Bokført dato", "Rentedato"] as const;

    for (const columnName of dateColumns) {
      const value = record[columnName];
      if (value && !isValidNorwegianDate(value)) {
        errors.push(`Row ${rowNumber}: ${columnName} is not a valid dd.MM.yyyy date.`);
      }
    }

    const amountIn = record["Beløp inn"];
    const amountOut = record["Beløp ut"];

    if (amountIn && !isNumericAmount(amountIn)) {
      errors.push(`Row ${rowNumber}: Beløp inn is not numeric.`);
    }

    if (amountOut && !isNumericAmount(amountOut)) {
      errors.push(`Row ${rowNumber}: Beløp ut is not numeric.`);
    }

    if (!amountIn && !amountOut) {
      warnings.push(`Row ${rowNumber}: both amount columns are empty.`);
    }

    const currencyCode = record["Valuta"];
    if (currencyCode !== "NOK") {
      nonNokRowCount += 1;
    }

    const status = (record["Status"] ?? "").toUpperCase();
    const undertype = (record["Undertype"] ?? "").toUpperCase();
    const transactionType = (record["Type"] ?? "").toUpperCase();
    const reference = (record["Melding/KID/Fakt.nr"] ?? "").toUpperCase();

    if (status === "RESERVENT" || status === "RESERVERT" || status === "RESERVERT" || undertype.includes("HOLDT")) {
      reservedRowCount += 1;
    }

    if (
      currencyCode !== "NOK" ||
      undertype.includes("UTLANDET") ||
      reference.includes("FX-")
    ) {
      fxRowCount += 1;
    }

    if (
      transactionType.includes("BETALING") ||
      transactionType.includes("STRAKSBETALING") ||
      reference.includes("TRANSFER")
    ) {
      transferRowCount += 1;
    }

    if (reference.includes("KID") || reference.includes("FAKT")) {
      kidReferenceCount += 1;
    }

    const merchantName = record["Beskrivelse"] ?? "";
    const merchantKey = normalizeMerchantKey(merchantName);
    const variants = merchantVariants.get(merchantKey) ?? new Set<string>();
    variants.add(merchantName);
    merchantVariants.set(merchantKey, variants);
  });

  if (records.length === 0) {
    errors.push("Fixture has no transaction rows.");
  }

  if (nonNokRowCount === 0) {
    errors.push("Fixture must contain at least one non-NOK row for FX coverage.");
  }

  for (const variants of merchantVariants.values()) {
    if (variants.size > 1) {
      warnings.push(
        `Near-duplicate merchant variants detected: ${[...variants].sort().join(", ")}.`
      );
    }
  }

  const report: VerificationReport = {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      rowCount: records.length,
      nonNokRowCount,
      reservedRowCount,
      transferRowCount,
      fxRowCount,
      kidReferenceCount,
      uniqueMerchantCount: merchantVariants.size
    }
  };

  if (options.reportPath) {
    mkdirSync(dirname(resolve(options.reportPath)), { recursive: true });
    writeFileSync(options.reportPath, JSON.stringify(report, null, 2), "utf8");
  }

  return report;
}