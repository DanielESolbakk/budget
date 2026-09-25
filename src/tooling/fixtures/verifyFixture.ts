import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseFixtureCsv, rowsToObjects } from "./fixtureCsv.js";

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
    holdRowCount: number;
    transferRowCount: number;
    fxRowCount: number;
    kidReferenceCount: number;
    uniqueMerchantCount: number;
    merchantTokenDistribution: Record<string, number>;
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

function createEmptyStats(): VerificationReport["stats"] {
  return {
    rowCount: 0,
    nonNokRowCount: 0,
    reservedRowCount: 0,
    holdRowCount: 0,
    transferRowCount: 0,
    fxRowCount: 0,
    kidReferenceCount: 0,
    uniqueMerchantCount: 0,
    merchantTokenDistribution: {}
  };
}

function containsInvalidUtf8Characters(value: string): boolean {
  if (value.includes("\uFFFD")) {
    return true;
  }

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isAsciiControl = codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d;
    const isLatin1Control = codePoint >= 0x7f && codePoint <= 0x9f;

    if (isAsciiControl || isLatin1Control) {
      return true;
    }
  }

  return false;
}

function containsCommonMojibake(value: string): boolean {
  return /(Ã.|Â.|â.|ð.|�)/u.test(value);
}

function countOccurrences(value: string, character: string): number {
  return [...value].filter((entry) => entry === character).length;
}

function repairCommonMojibake(value: string): string {
  if (!containsCommonMojibake(value)) {
    return value;
  }

  return Buffer.from(value, "latin1").toString("utf8");
}

function normalizeMerchantKey(value: string): string {
  return value.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function createReport(
  errors: string[],
  warnings: string[],
  stats: VerificationReport["stats"],
  reportPath?: string
): VerificationReport {
  const report: VerificationReport = {
    ok: errors.length === 0,
    errors,
    warnings,
    stats
  };

  if (reportPath) {
    mkdirSync(dirname(resolve(reportPath)), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  }

  return report;
}

export function verifyFixture(options: VerifyFixtureOptions): VerificationReport {
  const rawText = readFileSync(options.inputPath, "utf8");
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = createEmptyStats();
  const normalizedText = rawText.replace(/^\uFEFF/, "").trim();

  if (normalizedText.length === 0) {
    errors.push("CSV file is empty.");
    return createReport(errors, warnings, stats, options.reportPath);
  }

  if (containsInvalidUtf8Characters(normalizedText)) {
    errors.push("Fixture text is not valid UTF-8 or contains replacement characters.");
  }

  if (containsCommonMojibake(normalizedText)) {
    errors.push("Fixture text contains mojibake sequences that should be re-sanitized.");
  }

  const headerLine = normalizedText.split(/\r?\n/, 1)[0] ?? "";
  if (countOccurrences(headerLine, ";") < expectedHeaders.length - 1) {
    errors.push("CSV must use semicolon delimiters.");
  }

  let parsed;
  try {
    parsed = parseFixtureCsv(rawText);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return createReport(errors, warnings, stats, options.reportPath);
  }

  stats.rowCount = parsed.rows.length;

  if (parsed.header.join("|") !== expectedHeaders.join("|")) {
    errors.push("CSV header does not match the expected import fixture schema.");
  }

  if (errors.includes("CSV must use semicolon delimiters.")) {
    return createReport(errors, warnings, stats, options.reportPath);
  }

  const records = rowsToObjects(parsed);
  const merchantVariants = new Map<string, Set<string>>();
  const merchantTokenDistribution = new Map<string, number>();

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
    if (currencyCode && currencyCode !== "NOK") {
      stats.nonNokRowCount += 1;
    }

    const status = (record["Status"] ?? "").toUpperCase();
    const undertype = (record["Undertype"] ?? "").toUpperCase();
    const transactionType = (record["Type"] ?? "").toUpperCase();
    const reference = (record["Melding/KID/Fakt.nr"] ?? "").toUpperCase();

    if (status.includes("RESERV")) {
      stats.reservedRowCount += 1;
    }

    if (status.includes("HOLD") || undertype.includes("HOLD")) {
      stats.holdRowCount += 1;
    }

    if (
      currencyCode !== "NOK" ||
      undertype.includes("UTLANDET") ||
      reference.includes("FX-")
    ) {
      stats.fxRowCount += 1;
    }

    if (
      transactionType.includes("BETALING") ||
      transactionType.includes("STRAKSBETALING") ||
      reference.includes("TRANSFER")
    ) {
      stats.transferRowCount += 1;
    }

    if (reference.includes("KID") || reference.includes("FAKT")) {
      stats.kidReferenceCount += 1;
    }

    const merchantName = repairCommonMojibake(record["Beskrivelse"] ?? "");
    const merchantKey = normalizeMerchantKey(merchantName);
    const variants = merchantVariants.get(merchantKey) ?? new Set<string>();
    variants.add(merchantName);
    merchantVariants.set(merchantKey, variants);

    for (const token of merchantKey.split(" ").filter((value) => value.length > 0)) {
      merchantTokenDistribution.set(
        token,
        (merchantTokenDistribution.get(token) ?? 0) + 1
      );
    }
  });

  if (records.length === 0) {
    errors.push("Fixture has no transaction rows.");
  }

  if (stats.nonNokRowCount === 0) {
    errors.push("Fixture must contain at least one non-NOK row for FX coverage.");
  }

  for (const variants of merchantVariants.values()) {
    if (variants.size > 1) {
      warnings.push(
        `Near-duplicate merchant variants detected: ${[...variants].sort().join(", ")}.`
      );
    }
  }

  stats.uniqueMerchantCount = merchantVariants.size;
  stats.merchantTokenDistribution = Object.fromEntries(
    [...merchantTokenDistribution.entries()].sort(([left], [right]) =>
      left.localeCompare(right, "en")
    )
  );

  return createReport(errors, warnings, stats, options.reportPath);
}