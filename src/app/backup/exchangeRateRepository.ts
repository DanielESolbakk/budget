import { DatabaseSync } from "node:sqlite";
import { validateExchangeRate } from "../../domain/money/exchangeRates.js";
import type { ExchangeRate, CurrencyCode } from "../../domain/types.js";
import { isCurrencyCode } from "../../domain/types.js";
import type { LocalLedgerDatabase } from "./localLedgerContracts.js";

type ExchangeRateRepository = Pick<LocalLedgerDatabase,
  | "upsertExchangeRate"
  | "upsertExchangeRates"
  | "listExchangeRates"
>;

export function createExchangeRateRepository(db: DatabaseSync): ExchangeRateRepository {
  function upsertExchangeRate(rate: ExchangeRate): void {
    const validated = validateExchangeRate(rate);
    db.prepare(`
      INSERT INTO exchange_rates (
        id, currency_code, rate_nok_per_unit, effective_date, kind, source, provenance
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        currency_code = excluded.currency_code,
        rate_nok_per_unit = excluded.rate_nok_per_unit,
        effective_date = excluded.effective_date,
        kind = excluded.kind,
        source = excluded.source,
        provenance = excluded.provenance
    `).run(
      validated.id,
      validated.currencyCode,
      validated.rateNokPerUnit,
      validated.effectiveDate,
      validated.kind,
      validated.source,
      validated.provenance
    );
  }

  function upsertExchangeRates(rates: ExchangeRate[]): void {
    const validatedRates = rates.map(validateExchangeRate);
    const keys = new Set<string>();
    for (const rate of validatedRates) {
      const key = `${rate.currencyCode}/${rate.effectiveDate}/${rate.kind}`;
      if (keys.has(key)) {
        throw new Error(`Duplicate exchange rate for ${key}.`);
      }
      keys.add(key);
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const rate of validatedRates) upsertExchangeRate(rate);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listExchangeRates(currencyCode?: CurrencyCode): ExchangeRate[] {
    if (currencyCode !== undefined && !isCurrencyCode(currencyCode)) {
      throw new Error("Exchange rate currency code is invalid.");
    }
    const rows = currencyCode === undefined
      ? db.prepare(`
          SELECT id, currency_code, rate_nok_per_unit, effective_date, kind, source, provenance
          FROM exchange_rates
          ORDER BY currency_code, effective_date, kind, id
        `).all()
      : db.prepare(`
          SELECT id, currency_code, rate_nok_per_unit, effective_date, kind, source, provenance
          FROM exchange_rates
          WHERE currency_code = ?
          ORDER BY effective_date, kind, id
        `).all(currencyCode);
    return rows.map((row) => {
      const rate = row as {
        id: string;
        currency_code: string;
        rate_nok_per_unit: string;
        effective_date: string;
        kind: ExchangeRate["kind"];
        source: string;
        provenance: ExchangeRate["provenance"];
      };
      return {
        id: rate.id,
        currencyCode: rate.currency_code,
        rateNokPerUnit: rate.rate_nok_per_unit,
        effectiveDate: rate.effective_date,
        kind: rate.kind,
        source: rate.source,
        provenance: rate.provenance,
      };
    });
  }

  return { upsertExchangeRate, upsertExchangeRates, listExchangeRates };
}
