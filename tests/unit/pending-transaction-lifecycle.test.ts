import { describe, expect, it } from "vitest";
import {
  CSV_COLUMN_NAMES,
  mapCsvRows,
  previewCsvRows,
} from "../../src/domain/import/csvRowMapper.js";
import { previewCsvRowsWithProgress } from "../../src/app/import/importCsv.js";
import { parseRogalandStatementText } from "../../src/domain/import/pdfTextParser.js";
import { buildBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { matchPendingTransactionObservations } from "../../src/domain/import/pendingTransactionMatching.js";

describe("pending transaction lifecycle", () => {
  it("keeps a reserved CSV observation out of booked transactions", () => {
    const result = mapCsvRows(
      [
        {
          [CSV_COLUMN_NAMES.executionDate]: "29.05.2026",
          [CSV_COLUMN_NAMES.bookedDate]: "",
          [CSV_COLUMN_NAMES.description]: "SYNTHETIC SHOP",
          [CSV_COLUMN_NAMES.amountIn]: "",
          [CSV_COLUMN_NAMES.amountOut]: "12.34",
          [CSV_COLUMN_NAMES.currency]: "NOK",
          [CSV_COLUMN_NAMES.status]: "Reservert",
          [CSV_COLUMN_NAMES.reference]: "REF-RES-001",
        },
      ],
      {
        householdId: "hh-pending",
        accountId: "acc-pending",
        importJobId: "job-pending",
      }
    );

    expect(result).toMatchObject({
      transactions: [],
      pendingObservations: [
        {
          householdId: "hh-pending",
          accountId: "acc-pending",
          transactionDateIso: "2026-05-29T00:00:00Z",
          amountMinor: -1234,
          merchantRaw: "SYNTHETIC SHOP",
          currencyCode: "NOK",
          sourceType: "csv",
          sourceReference: "REF-RES-001",
          sourceRowIndex: 0,
          status: "reserved",
          sourceStatus: "Reservert",
          importJobId: "job-pending",
        },
      ],
      skipped: [],
    });
  });

  it("keeps a confirmed CSV observation out of booked transactions", () => {
    const result = mapCsvRows(
      [
        {
          [CSV_COLUMN_NAMES.executionDate]: "29.05.2026",
          [CSV_COLUMN_NAMES.bookedDate]: "",
          [CSV_COLUMN_NAMES.description]: "SYNTHETIC SHOP",
          [CSV_COLUMN_NAMES.amountIn]: "",
          [CSV_COLUMN_NAMES.amountOut]: "12.34",
          [CSV_COLUMN_NAMES.currency]: "NOK",
          [CSV_COLUMN_NAMES.status]: "Bekreftet",
          [CSV_COLUMN_NAMES.reference]: "REF-CONF-001",
        },
      ],
      {
        householdId: "hh-pending",
        accountId: "acc-pending",
        importJobId: "job-pending",
      }
    );

    expect(result).toMatchObject({
      transactions: [],
      pendingObservations: [
        {
          status: "confirmed",
          sourceStatus: "Bekreftet",
        },
      ],
    });
  });

  it("does not book a CSV row with an unsupported populated status", () => {
    const result = mapCsvRows(
      [
        {
          [CSV_COLUMN_NAMES.executionDate]: "29.05.2026",
          [CSV_COLUMN_NAMES.bookedDate]: "",
          [CSV_COLUMN_NAMES.description]: "SYNTHETIC SHOP",
          [CSV_COLUMN_NAMES.amountIn]: "",
          [CSV_COLUMN_NAMES.amountOut]: "12.34",
          [CSV_COLUMN_NAMES.currency]: "NOK",
          [CSV_COLUMN_NAMES.status]: "Ukjent",
          [CSV_COLUMN_NAMES.reference]: "REF-UNKNOWN-001",
        },
      ],
      {
        householdId: "hh-pending",
        accountId: "acc-pending",
      }
    );

    expect(result.transactions).toEqual([]);
    expect(result.skipped).toMatchObject([
      {
        rowIndex: 0,
        errors: [
          {
            code: "UNSUPPORTED_TRANSACTION_STATUS",
            field: CSV_COLUMN_NAMES.status,
          },
        ],
      },
    ]);
  });

  it("matches only a unique same-account non-empty source reference", () => {
    const bookedTransactions = [
      {
        id: "booked-unique",
        householdId: "hh-pending",
        accountId: "acc-pending",
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: -1200,
        merchantRaw: "SYNTHETIC UNIQUE",
        sourceType: "csv" as const,
        sourceReference: " REF-UNIQUE ",
      },
      {
        id: "booked-cross-account",
        householdId: "hh-pending",
        accountId: "acc-other",
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: -1300,
        merchantRaw: "SYNTHETIC CROSS ACCOUNT",
        sourceType: "pdf" as const,
        sourceReference: "REF-CROSS",
      },
      {
        id: "booked-ambiguous",
        householdId: "hh-pending",
        accountId: "acc-pending",
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: -1400,
        merchantRaw: "SYNTHETIC AMBIGUOUS",
        sourceType: "csv" as const,
        sourceReference: "REF-AMBIGUOUS",
      },
      {
        id: "booked-no-reference",
        householdId: "hh-pending",
        accountId: "acc-pending",
        bookedAtIso: "2026-05-28T00:00:00Z",
        amountMinor: -1500,
        merchantRaw: "SYNTHETIC NO REFERENCE",
        sourceType: "csv" as const,
      },
    ];
    const pendingObservations = [
      {
        id: "pending-unique",
        householdId: "hh-pending",
        accountId: "acc-pending",
        sourceReference: "REF-UNIQUE",
      },
      {
        id: "pending-cross-account",
        householdId: "hh-pending",
        accountId: "acc-pending",
        sourceReference: "REF-CROSS",
      },
      {
        id: "pending-ambiguous-a",
        householdId: "hh-pending",
        accountId: "acc-pending",
        sourceReference: "REF-AMBIGUOUS",
      },
      {
        id: "pending-ambiguous-b",
        householdId: "hh-pending",
        accountId: "acc-pending",
        sourceReference: "REF-AMBIGUOUS",
      },
      {
        id: "pending-no-reference",
        householdId: "hh-pending",
        accountId: "acc-pending",
      },
    ];

    expect(matchPendingTransactionObservations(bookedTransactions, pendingObservations)).toEqual([
      {
        transactionId: "booked-unique",
        pendingObservationId: "pending-unique",
      },
    ]);
  });

  it("keeps pending rows out of CSV previews' booked transaction candidates", () => {
    const preview = previewCsvRows(
      [
        {
          [CSV_COLUMN_NAMES.executionDate]: "29.05.2026",
          [CSV_COLUMN_NAMES.bookedDate]: "",
          [CSV_COLUMN_NAMES.description]: "SYNTHETIC SHOP",
          [CSV_COLUMN_NAMES.amountIn]: "",
          [CSV_COLUMN_NAMES.amountOut]: "12.34",
          [CSV_COLUMN_NAMES.currency]: "NOK",
          [CSV_COLUMN_NAMES.status]: "Reservert",
          [CSV_COLUMN_NAMES.reference]: "REF-RES-001",
        },
      ],
      {
        householdId: "hh-pending",
        accountId: "acc-pending",
        importJobId: "job-pending",
      }
    );

    expect(preview.transactions).toEqual([]);
    expect(preview.rows[0]).not.toHaveProperty("transaction");
    expect(preview.rows[0]).toMatchObject({
      pendingObservation: {
        status: "reserved",
        sourceReference: "REF-RES-001",
      },
    });
  });

  it("keeps pending rows out of the progress-enabled CSV import preview", async () => {
    const preview = await previewCsvRowsWithProgress(
      [
        {
          [CSV_COLUMN_NAMES.executionDate]: "29.05.2026",
          [CSV_COLUMN_NAMES.bookedDate]: "",
          [CSV_COLUMN_NAMES.description]: "SYNTHETIC SHOP",
          [CSV_COLUMN_NAMES.amountIn]: "",
          [CSV_COLUMN_NAMES.amountOut]: "12.34",
          [CSV_COLUMN_NAMES.currency]: "NOK",
          [CSV_COLUMN_NAMES.status]: "Reservert",
          [CSV_COLUMN_NAMES.reference]: "REF-RES-001",
        },
      ],
      {
        householdId: "hh-pending",
        accountId: "acc-pending",
        importJobId: "job-pending",
      },
      {
        isCancelled: () => false,
        onProgress: () => undefined,
      }
    );

    expect(preview?.transactions).toEqual([]);
    expect(preview?.rows[0]).not.toHaveProperty("transaction");
    expect(preview?.rows[0]).toMatchObject({
      pendingObservation: {
        status: "reserved",
        sourceReference: "REF-RES-001",
      },
    });
  });

  it("maps reserved and confirmed text-PDF rows separately from booked transactions", () => {
    const parsed = parseRogalandStatementText(
      [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 3",
        "Kontonummer: ACCT-001",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "29.05.2026 Varekjøp ACCT-001 LOCAL_USER -11,00 NOK Reservert KID: REF-RES-001 SYNTHETIC RESERVED",
        "28.05.2026 Betaling ACCT-001 LOCAL_USER -12,00 NOK Bekreftet KID: REF-CONF-001 SYNTHETIC CONFIRMED",
        "27.05.2026 Varekjøp ACCT-001 LOCAL_USER -20,00 NOK Bokført KID: REF-BOOK-001 SYNTHETIC BOOKED",
      ].join("\n"),
      {
        householdId: "hh-pending",
        accountId: "acc-pending",
        importJobId: "job-pdf",
      }
    );

    expect(parsed).toMatchObject({
      ok: true,
      transactions: [
        {
          bookedAtIso: "2026-05-27T00:00:00Z",
          amountMinor: -2000,
          merchantRaw: "SYNTHETIC BOOKED",
          sourceReference: "REF-BOOK-001",
        },
      ],
      pendingObservations: [
        {
          transactionDateIso: "2026-05-29T00:00:00Z",
          amountMinor: -1100,
          merchantRaw: "SYNTHETIC RESERVED",
          sourceReference: "REF-RES-001",
          sourceType: "pdf",
          status: "reserved",
          sourceStatus: "Reservert",
          importJobId: "job-pdf",
        },
        {
          transactionDateIso: "2026-05-28T00:00:00Z",
          amountMinor: -1200,
          merchantRaw: "SYNTHETIC CONFIRMED",
          sourceReference: "REF-CONF-001",
          sourceType: "pdf",
          status: "confirmed",
          sourceStatus: "Bekreftet",
          importJobId: "job-pdf",
        },
      ],
    });
  });

  it("extracts a bare stable source reference from the PDF message column", () => {
    const parsed = parseRogalandStatementText(
      [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 1",
        "Kontonummer: ACCT-001",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "29.05.2026 Varekjøp ACCT-001 LOCAL_USER -11,00 NOK Reservert REF-PDF-BARE-001 SYNTHETIC PDF SHOP",
      ].join("\n"),
      {
        householdId: "hh-pending",
        accountId: "acc-pending",
      }
    );

    expect(parsed).toMatchObject({
      ok: true,
      pendingObservations: [
        {
          merchantRaw: "SYNTHETIC PDF SHOP",
          sourceReference: "REF-PDF-BARE-001",
        },
      ],
    });
  });

  it("does not infer a PDF source reference from a number embedded in a message", () => {
    const parsed = parseRogalandStatementText(
      [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 1",
        "Kontonummer: ACCT-001",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "29.05.2026 Varekjøp ACCT-001 LOCAL_USER -11,00 NOK Reservert SYNTHETIC MESSAGE 1234567",
      ].join("\n"),
      {
        householdId: "hh-pending",
        accountId: "acc-pending",
      }
    );

    expect(parsed).toMatchObject({
      ok: true,
      pendingObservations: [
        {
          merchantRaw: "SYNTHETIC MESSAGE 1234567",
        },
      ],
    });
    const pendingObservation = parsed.ok ? parsed.pendingObservations?.[0] : undefined;
    expect(pendingObservation).not.toHaveProperty("sourceReference");
  });

  it("accepts a text-PDF statement containing only pending rows", () => {
    const parsed = parseRogalandStatementText(
      [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 1",
        "Kontonummer: ACCT-001",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "29.05.2026 Varekjøp ACCT-001 LOCAL_USER -11,00 NOK Reservert KID: REF-RES-001 SYNTHETIC RESERVED",
      ].join("\n"),
      {
        householdId: "hh-pending",
        accountId: "acc-pending",
      }
    );

    expect(parsed).toMatchObject({
      ok: true,
      transactions: [],
      pendingObservations: [
        {
          status: "reserved",
          sourceReference: "REF-RES-001",
        },
      ],
    });
  });

  it("assigns a stable identity to the same PDF pending source row across import jobs", () => {
    const text = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 1",
      "Kontonummer: ACCT-001",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "29.05.2026 Varekjøp ACCT-001 LOCAL_USER -11,00 NOK Reservert KID: REF-REPLAY-001 SYNTHETIC REPLAY SHOP",
    ].join("\n");
    const first = parseRogalandStatementText(text, {
      householdId: "hh-pending",
      accountId: "acc-pending",
      importJobId: "job-first",
    });
    const replay = parseRogalandStatementText(text, {
      householdId: "hh-pending",
      accountId: "acc-pending",
      importJobId: "job-replay",
    });

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(first.pendingObservations?.map(({ id }) => id)).toEqual(
      replay.pendingObservations?.map(({ id }) => id)
    );
  });

  it("includes pending observations in deterministic backup snapshots", () => {
    const pendingObservation = {
      id: "pending-csv-1",
      householdId: "hh-pending",
      accountId: "acc-pending",
      transactionDateIso: "2026-05-29T00:00:00Z",
      amountMinor: -1234,
      merchantRaw: "SYNTHETIC SHOP",
      sourceRowIndex: 0,
      sourceType: "csv" as const,
      sourceReference: "REF-PENDING-001",
      importJobId: "job-pending",
      status: "reserved" as const,
      sourceStatus: "Reservert" as const,
    };
    const snapshot = buildBackupSnapshot({
      household: {
        id: "hh-pending",
        name: "Synthetic Household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [],
      transactions: [],
      pendingObservations: [pendingObservation],
      importJobs: [],
      monthlyCategoryTargets: [],
      createdAtIso: "2026-05-29T00:00:00Z",
    });

    expect(snapshot).toMatchObject({
      pendingObservations: [pendingObservation],
    });
  });
});
