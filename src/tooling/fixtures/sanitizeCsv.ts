import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readFixtureCsv, stringifyFixtureCsv } from "./fixtureCsv.js";

export interface SanitizeCsvOptions {
  inputPath: string;
  outputPath: string;
  mapPath: string;
  seed: string;
  dryRun: boolean;
}

export interface SanitizationMapEntry {
  kind: string;
  original: string;
  token: string;
}

export interface SanitizationResult {
  outputText: string;
  mapEntries: SanitizationMapEntry[];
  rowCount: number;
}

const accountColumns = new Set(["Fra konto", "Til konto"]);
const partyColumns = new Set(["Avsender", "Mottakernavn"]);
const merchantColumns = new Set(["Beskrivelse"]);
const referenceColumns = new Set(["Melding/KID/Fakt.nr"]);

function buildToken(kind: string, value: string, seed: string): string {
  const digest = createHash("sha256").update(`${seed}:${kind}:${value}`).digest("hex");
  return `${kind}-${digest.slice(0, 10).toUpperCase()}`;
}

function getColumnKind(columnName: string): string | null {
  if (accountColumns.has(columnName)) {
    return "ACCT";
  }

  if (partyColumns.has(columnName)) {
    return "PARTY";
  }

  if (merchantColumns.has(columnName)) {
    return "MERCHANT";
  }

  if (referenceColumns.has(columnName)) {
    return "REF";
  }

  return null;
}

export function sanitizeFixtureCsv(options: SanitizeCsvOptions): SanitizationResult {
  const parsed = readFixtureCsv(options.inputPath);
  const map = new Map<string, SanitizationMapEntry>();

  const sanitizedRows = parsed.rows.map((row) => {
    return row.map((value, index) => {
      const columnName = parsed.header[index] ?? "";
      const kind = getColumnKind(columnName);
      const trimmedValue = value.trim();

      if (!kind || trimmedValue.length === 0) {
        return value;
      }

      const mapKey = `${kind}:${trimmedValue}`;
      const existing = map.get(mapKey);
      if (existing) {
        return existing.token;
      }

      const token = buildToken(kind, trimmedValue, options.seed);
      map.set(mapKey, {
        kind,
        original: trimmedValue,
        token
      });

      return token;
    });
  });

  const outputText = stringifyFixtureCsv({
    header: parsed.header,
    rows: sanitizedRows
  });

  const mapEntries = [...map.values()].sort((left, right) => {
    return left.token.localeCompare(right.token);
  });

  if (!options.dryRun) {
    mkdirSync(dirname(resolve(options.outputPath)), { recursive: true });
    mkdirSync(dirname(resolve(options.mapPath)), { recursive: true });
    writeFileSync(options.outputPath, outputText, "utf8");
    writeFileSync(options.mapPath, JSON.stringify(mapEntries, null, 2), "utf8");
  }

  return {
    outputText,
    mapEntries,
    rowCount: sanitizedRows.length
  };
}