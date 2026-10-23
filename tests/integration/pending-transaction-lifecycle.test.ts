import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { buildDashboardViewContract } from "../../src/app/dashboardApi.js";
import { runCsvImportWorkflow } from "../../src/app/import/importCsv.js";
import { runPdfImportWorkflow } from "../../src/app/import/importPdf.js";
import { defaultParserAdapterRegistry } from "../../src/domain/import/parserAdapterRegistry.js";
import { buildForecastInput } from "../../src/domain/forecast/forecastInputAdapter.js";

describe("pending transaction lifecycle persistence", () => {
  it("does not duplicate a pending CSV source row imported from a different path", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-pending-path-replay-"));
    const ledger = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household: {
          id: "hh-pending",
          name: "Synthetic Household",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        accounts: [
          {
            id: "acc-pending",
            householdId: "hh-pending",
            name: "Synthetic Account",
            currencyCode: "NOK",
          },
        ],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });
    const rows = [
      {
        "Utført dato": "29.05.2026",
        "Bokført dato": "",
        Beskrivelse: "SYNTHETIC SHOP",
        "Beløp inn": "",
        "Beløp ut": "12.34",
        Valuta: "NOK",
        Status: "Reservert",
        "Melding/KID/Fakt.nr": "REF-PATH-REPLAY-001",
      },
    ];
    const dependencies = {
      categoryRules: new Map<string, string>(),
      loadLedgerSnapshotData: ledger.loadLedgerSnapshotData,
      getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
      appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
      getTransactionsForImportJob: ledger.getTransactionsForImportJob,
    };

    try {
      const firstResponse = runCsvImportWorkflow(
        {
          rows,
          filePath: "imports-a/pending.csv",
          householdId: "hh-pending",
          accountId: "acc-pending",
          importJobId: "job-pending-path-a",
          startedAtIso: "2026-05-29T00:00:00Z",
          finishedAtIso: "2026-05-29T00:00:01Z",
          sourceIdentity: "same-pending-csv-content",
          sourceScope: "imports-a/pending.csv",
        },
        dependencies
      );
      const secondResponse = runCsvImportWorkflow(
        {
          rows,
          filePath: "imports-b/pending-copy.csv",
          householdId: "hh-pending",
          accountId: "acc-pending",
          importJobId: "job-pending-path-b",
          startedAtIso: "2026-05-29T00:00:02Z",
          finishedAtIso: "2026-05-29T00:00:03Z",
          sourceIdentity: "same-pending-csv-content",
          sourceScope: "imports-b/pending-copy.csv",
        },
        dependencies
      );

      expect(firstResponse).toMatchObject({
        ok: true,
        transactionCount: 0,
        pendingCount: 1,
      });
      expect(secondResponse).toMatchObject({
        ok: true,
        transactionCount: 0,
        pendingCount: 1,
      });
      expect(ledger.listPendingTransactionObservations("hh-pending")).toMatchObject([
        {
          accountId: "acc-pending",
          sourceReference: "REF-PATH-REPLAY-001",
          importJobId: "job-pending-path-a",
        },
      ]);
      expect(ledger.listPendingTransactionObservations("hh-pending")).toHaveLength(1);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists one pending CSV observation separately from booked transactions on replay", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-pending-lifecycle-"));
    const ledger = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household: {
          id: "hh-pending",
          name: "Synthetic Household",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        accounts: [
          {
            id: "acc-pending",
            householdId: "hh-pending",
            name: "Synthetic Account",
            currencyCode: "NOK",
          },
        ],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const response = runCsvImportWorkflow(
        {
          rows: [
            {
              "Utført dato": "29.05.2026",
              "Bokført dato": "",
              Beskrivelse: "SYNTHETIC SHOP",
              "Beløp inn": "",
              "Beløp ut": "12.34",
              Valuta: "NOK",
              Status: "Reservert",
              "Melding/KID/Fakt.nr": "REF-RES-001",
            },
          ],
          filePath: "synthetic-pending.csv",
          householdId: "hh-pending",
          accountId: "acc-pending",
          importJobId: "job-pending",
          startedAtIso: "2026-05-29T00:00:00Z",
          finishedAtIso: "2026-05-29T00:00:01Z",
          sourceIdentity: "synthetic-pending-csv",
          sourceScope: "synthetic-pending-csv",
        },
        {
          categoryRules: new Map(),
          loadLedgerSnapshotData: ledger.loadLedgerSnapshotData,
          getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
          appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
          getTransactionsForImportJob: ledger.getTransactionsForImportJob,
        }
      );
      let replayResponse: ReturnType<typeof runCsvImportWorkflow> | undefined;
      expect(() => {
        replayResponse = runCsvImportWorkflow(
          {
            rows: [
              {
                "Utført dato": "29.05.2026",
                "Bokført dato": "",
                Beskrivelse: "SYNTHETIC SHOP",
                "Beløp inn": "",
                "Beløp ut": "12.34",
                Valuta: "NOK",
                Status: "Reservert",
                "Melding/KID/Fakt.nr": "REF-RES-001",
              },
            ],
            filePath: "synthetic-pending.csv",
            householdId: "hh-pending",
            accountId: "acc-pending",
            importJobId: "job-pending",
            startedAtIso: "2026-05-29T00:00:02Z",
            finishedAtIso: "2026-05-29T00:00:03Z",
            sourceIdentity: "synthetic-pending-csv",
            sourceScope: "synthetic-pending-csv",
          },
          {
            categoryRules: new Map(),
            loadLedgerSnapshotData: ledger.loadLedgerSnapshotData,
            getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
            appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
            getTransactionsForImportJob: ledger.getTransactionsForImportJob,
          }
        );
      }).not.toThrow();

      expect(response).toMatchObject({ ok: true, transactionCount: 0 });
      expect(replayResponse).toMatchObject({ ok: true, transactionCount: 0 });
      expect(ledger.listImportJobHistory("hh-pending")).toMatchObject([
        { id: "job-pending", importedCount: 1, undoAvailable: true },
      ]);
      expect(ledger.getTransactionsForMonth("hh-pending", "2026-05")).toEqual([]);
      expect(ledger.listMonthlyTotals("hh-pending")).toEqual([]);
      expect(buildDashboardViewContract({
        transactions: ledger.getTransactionsForMonth("hh-pending", "2026-05"),
        selectedYearMonth: "2026-05",
      }).state).toBe("empty");
      expect(buildForecastInput(ledger.listMonthlyTotals("hh-pending"), {
        fallbackStartYearMonth: "2026-05",
      }).history).toEqual([]);

      const listPendingObservations =
        "listPendingTransactionObservations" in ledger
          ? ledger.listPendingTransactionObservations
          : undefined;
      expect(listPendingObservations).toBeTypeOf("function");
      if (typeof listPendingObservations !== "function") return;

      expect(listPendingObservations("hh-pending")).toMatchObject([
        {
          householdId: "hh-pending",
          accountId: "acc-pending",
          transactionDateIso: "2026-05-29T00:00:00Z",
          amountMinor: -1234,
          merchantRaw: "SYNTHETIC SHOP",
          sourceReference: "REF-RES-001",
          sourceRowIndex: 0,
          status: "reserved",
          sourceStatus: "Reservert",
          sourceType: "csv",
          importJobId: "job-pending",
        },
      ]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("makes pending-only import jobs visible and undoable", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-pending-undo-"));
    const ledger = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household: {
          id: "hh-pending",
          name: "Synthetic Household",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        accounts: [
          {
            id: "acc-pending",
            householdId: "hh-pending",
            name: "Synthetic Account",
            currencyCode: "NOK",
          },
        ],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      runCsvImportWorkflow(
        {
          rows: [
            {
              "Utført dato": "29.05.2026",
              "Bokført dato": "",
              Beskrivelse: "SYNTHETIC UNDO PENDING",
              "Beløp inn": "",
              "Beløp ut": "12.34",
              Valuta: "NOK",
              Status: "Reservert",
              "Melding/KID/Fakt.nr": "REF-UNDO-001",
            },
          ],
          filePath: "synthetic-pending.csv",
          householdId: "hh-pending",
          accountId: "acc-pending",
          importJobId: "job-pending-undo",
          startedAtIso: "2026-05-29T00:00:00Z",
          finishedAtIso: "2026-05-29T00:00:01Z",
          sourceIdentity: "synthetic-pending-undo",
          sourceScope: "synthetic-pending-undo",
        },
        {
          categoryRules: new Map(),
          loadLedgerSnapshotData: ledger.loadLedgerSnapshotData,
          getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
          appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
          getTransactionsForImportJob: ledger.getTransactionsForImportJob,
        }
      );

      expect(ledger.listImportJobHistory("hh-pending")).toMatchObject([
        {
          id: "job-pending-undo",
          candidateCount: 1,
          importedCount: 1,
          undoAvailable: true,
        },
      ]);
      const undoResult = ledger.undoImportJob("job-pending-undo");
      expect(undoResult.removedCount).toBe(1);
      expect(ledger.listPendingTransactionObservations("hh-pending")).toEqual([]);
      expect(ledger.loadLedgerSnapshotData().pendingObservations ?? []).toEqual([]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("round-trips pending observations through a backup restore", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-pending-backup-"));
    const sourceLedger = createLocalLedgerDatabase({
      dbPath: join(directory, "source.sqlite"),
      seedData: {
        household: {
          id: "hh-pending",
          name: "Synthetic Household",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        accounts: [
          {
            id: "acc-pending",
            householdId: "hh-pending",
            name: "Synthetic Account",
            currencyCode: "NOK",
          },
        ],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });
    let restoredLedger: ReturnType<typeof createLocalLedgerDatabase> | undefined;

    try {
      runCsvImportWorkflow(
        {
          rows: [
            {
              "Utført dato": "29.05.2026",
              "Bokført dato": "",
              Beskrivelse: "SYNTHETIC SHOP",
              "Beløp inn": "",
              "Beløp ut": "12.34",
              Valuta: "NOK",
              Status: "Reservert",
              "Melding/KID/Fakt.nr": "REF-BACKUP-001",
            },
          ],
          filePath: "synthetic-pending.csv",
          householdId: "hh-pending",
          accountId: "acc-pending",
          importJobId: "job-pending",
          startedAtIso: "2026-05-29T00:00:00Z",
          finishedAtIso: "2026-05-29T00:00:01Z",
          sourceIdentity: "synthetic-pending-csv",
          sourceScope: "synthetic-pending-csv",
        },
        {
          categoryRules: new Map(),
          loadLedgerSnapshotData: sourceLedger.loadLedgerSnapshotData,
          getImportedTransactionsForSource: sourceLedger.getImportedTransactionsForSource,
          appendImportJobAndTransactions: sourceLedger.appendImportJobAndTransactions,
          getTransactionsForImportJob: sourceLedger.getTransactionsForImportJob,
        }
      );

      const backupPath = join(directory, "pending-backup.json");
      createBackupSnapshot({
        ...sourceLedger.loadLedgerSnapshotData(),
        outputPath: backupPath,
        createdAtIso: "2026-05-29T00:00:02Z",
      });
      const restoredData = restoreBackupSnapshot({ snapshotPath: backupPath });
      expect(restoredData).toMatchObject({
        pendingObservations: [
          {
            sourceReference: "REF-BACKUP-001",
            status: "reserved",
            sourceStatus: "Reservert",
            importJobId: "job-pending",
          },
        ],
      });

      restoredLedger = createLocalLedgerDatabase({
        dbPath: join(directory, "restored.sqlite"),
      });
      restoredLedger.replaceLedgerSnapshotData(restoredData);
      expect(restoredLedger.listPendingTransactionObservations("hh-pending")).toMatchObject([
        {
          sourceReference: "REF-BACKUP-001",
          status: "reserved",
          sourceStatus: "Reservert",
          importJobId: "job-pending",
        },
      ]);
    } finally {
      restoredLedger?.close();
      sourceLedger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates a pre-pending SQLite ledger without losing booked transactions", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-pending-migration-"));
    const dbPath = join(directory, "legacy.sqlite");
    const legacyDatabase = new DatabaseSync(dbPath);
    legacyDatabase.exec(`
      CREATE TABLE households (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at_iso TEXT NOT NULL
      );
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        currency_code TEXT NOT NULL
      );
      CREATE TABLE transactions (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        booked_at_iso TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        merchant_raw TEXT NOT NULL,
        category_id TEXT,
        import_job_id TEXT
      );
      INSERT INTO households VALUES ('hh-pending', 'Synthetic Household', '2026-01-01T00:00:00Z');
      INSERT INTO accounts VALUES ('acc-pending', 'hh-pending', 'Synthetic Account', 'NOK');
      INSERT INTO transactions (
        id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw
      ) VALUES (
        'legacy-booked', 'hh-pending', 'acc-pending', '2026-05-01T00:00:00Z', -5000,
        'SYNTHETIC LEGACY TRANSACTION'
      );
    `);
    legacyDatabase.close();
    const ledger = createLocalLedgerDatabase({ dbPath });

    try {
      const existing = ledger.getTransactionsForMonth("hh-pending", "2026-05");
      expect(existing).toMatchObject([
        {
          id: "legacy-booked",
          amountMinor: -5000,
          merchantRaw: "SYNTHETIC LEGACY TRANSACTION",
        },
      ]);

      const response = runCsvImportWorkflow(
        {
          rows: [
            {
              "Utført dato": "29.05.2026",
              "Bokført dato": "",
              Beskrivelse: "SYNTHETIC MIGRATED PENDING",
              "Beløp inn": "",
              "Beløp ut": "12.34",
              Valuta: "NOK",
              Status: "Reservert",
              "Melding/KID/Fakt.nr": "REF-MIGRATED-001",
            },
          ],
          filePath: "synthetic-pending.csv",
          householdId: "hh-pending",
          accountId: "acc-pending",
          importJobId: "job-migrated-pending",
          startedAtIso: "2026-05-29T00:00:00Z",
          finishedAtIso: "2026-05-29T00:00:01Z",
          sourceIdentity: "synthetic-migrated-pending",
          sourceScope: "synthetic-migrated-pending",
        },
        {
          categoryRules: new Map(),
          loadLedgerSnapshotData: ledger.loadLedgerSnapshotData,
          getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
          appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
          getTransactionsForImportJob: ledger.getTransactionsForImportJob,
        }
      );

      expect(response).toMatchObject({ ok: true, transactionCount: 0, pendingCount: 1 });
      expect(ledger.getTransactionsForMonth("hh-pending", "2026-05")).toMatchObject([
        expect.objectContaining({ id: "legacy-booked", amountMinor: -5000 }),
      ]);
      expect(ledger.listPendingTransactionObservations("hh-pending")).toMatchObject([
        { sourceReference: "REF-MIGRATED-001", status: "reserved" },
      ]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reconciles one same-account reference into a booked transaction and retains the observation", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-pending-reconciliation-"));
    const ledger = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household: {
          id: "hh-pending",
          name: "Synthetic Household",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        accounts: [
          {
            id: "acc-pending",
            householdId: "hh-pending",
            name: "Synthetic Account",
            currencyCode: "NOK",
          },
        ],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const dependencies = {
        categoryRules: new Map<string, string>(),
        loadLedgerSnapshotData: ledger.loadLedgerSnapshotData,
        getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
        appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
        getTransactionsForImportJob: ledger.getTransactionsForImportJob,
      };
      const pendingResponse = runCsvImportWorkflow(
        {
          rows: [
            {
              "Utført dato": "29.05.2026",
              "Bokført dato": "",
              Beskrivelse: "SYNTHETIC SHOP",
              "Beløp inn": "",
              "Beløp ut": "12.34",
              Valuta: "NOK",
              Status: "Reservert",
              "Melding/KID/Fakt.nr": "REF-RECON-001",
            },
          ],
          filePath: "synthetic-pending.csv",
          householdId: "hh-pending",
          accountId: "acc-pending",
          importJobId: "job-pending",
          startedAtIso: "2026-05-29T00:00:00Z",
          finishedAtIso: "2026-05-29T00:00:01Z",
          sourceIdentity: "synthetic-pending-csv",
          sourceScope: "synthetic-pending-csv",
        },
        dependencies
      );
      const bookedResponse = runCsvImportWorkflow(
        {
          rows: [
            {
              "Utført dato": "28.05.2026",
              "Bokført dato": "28.05.2026",
              Beskrivelse: "SYNTHETIC SHOP",
              "Beløp inn": "",
              "Beløp ut": "13.99",
              Valuta: "NOK",
              Status: "Bokført",
              "Melding/KID/Fakt.nr": "REF-RECON-001",
            },
          ],
          filePath: "synthetic-booked.csv",
          householdId: "hh-pending",
          accountId: "acc-pending",
          importJobId: "job-booked",
          startedAtIso: "2026-05-29T00:00:02Z",
          finishedAtIso: "2026-05-29T00:00:03Z",
          sourceIdentity: "synthetic-booked-csv",
          sourceScope: "synthetic-booked-csv",
        },
        dependencies
      );

      expect(pendingResponse).toMatchObject({ ok: true, transactionCount: 0 });
      expect(bookedResponse).toMatchObject({ ok: true, transactionCount: 1 });
      expect(ledger.getTransactionsForMonth("hh-pending", "2026-05")).toMatchObject([
        {
          accountId: "acc-pending",
          amountMinor: -1399,
          sourceReference: "REF-RECON-001",
          importJobId: "job-booked",
        },
      ]);
      expect(ledger.listPendingTransactionObservations("hh-pending")).toEqual([]);
      expect(ledger.loadLedgerSnapshotData()).toMatchObject({
        pendingObservations: [
          {
            accountId: "acc-pending",
            amountMinor: -1234,
            sourceReference: "REF-RECON-001",
            importJobId: "job-pending",
            reconciledTransactionId: ledger.getTransactionsForMonth("hh-pending", "2026-05")[0]?.id,
          },
        ],
      });

      const undoBookedResult = ledger.undoImportJob("job-booked");
      expect(undoBookedResult.removedCount).toBe(1);
      expect(ledger.getTransactionsForMonth("hh-pending", "2026-05")).toEqual([]);
      const restoredPendingObservation = ledger.listPendingTransactionObservations("hh-pending")[0];
      expect(restoredPendingObservation).toMatchObject({
        sourceReference: "REF-RECON-001",
        importJobId: "job-pending",
      });
      expect(restoredPendingObservation).not.toHaveProperty("reconciledTransactionId");
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps missing, cross-account, and ambiguous references separate", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-pending-ambiguous-"));
    const ledger = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household: {
          id: "hh-pending",
          name: "Synthetic Household",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        accounts: [
          {
            id: "acc-pending",
            householdId: "hh-pending",
            name: "Synthetic Account",
            currencyCode: "NOK",
          },
          {
            id: "acc-other",
            householdId: "hh-pending",
            name: "Other Synthetic Account",
            currencyCode: "NOK",
          },
        ],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    const dependencies = {
      categoryRules: new Map<string, string>(),
      loadLedgerSnapshotData: ledger.loadLedgerSnapshotData,
      getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
      appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
      getTransactionsForImportJob: ledger.getTransactionsForImportJob,
    };
    const makeRow = (
      date: string,
      merchant: string,
      amount: string,
      status: string,
      reference?: string
    ) => ({
      "Utført dato": date,
      "Bokført dato": status === "Bokført" ? date : "",
      Beskrivelse: merchant,
      "Beløp inn": "",
      "Beløp ut": amount,
      Valuta: "NOK",
      Status: status,
      ...(reference === undefined ? {} : { "Melding/KID/Fakt.nr": reference }),
    });
    const importRows = (
      importJobId: string,
      accountId: string,
      rows: Array<Record<string, string>>
    ) => runCsvImportWorkflow(
      {
        rows,
        filePath: `${importJobId}.csv`,
        householdId: "hh-pending",
        accountId,
        importJobId,
        startedAtIso: "2026-05-29T00:00:00Z",
        finishedAtIso: "2026-05-29T00:00:01Z",
        sourceIdentity: importJobId,
        sourceScope: importJobId,
      },
      dependencies
    );

    try {
      const pendingResponse = importRows("job-pending-ambiguous", "acc-pending", [
        makeRow("29.05.2026", "SYNTHETIC NO REFERENCE", "11.00", "Reservert"),
        makeRow("29.05.2026", "SYNTHETIC CROSS ACCOUNT", "12.00", "Reservert", "REF-CROSS"),
        makeRow("29.05.2026", "SYNTHETIC AMBIGUOUS A", "13.00", "Reservert", "REF-AMBIG"),
        makeRow("28.05.2026", "SYNTHETIC AMBIGUOUS B", "14.00", "Bekreftet", "REF-AMBIG"),
      ]);
      const missingReferenceResponse = importRows("job-booked-no-reference", "acc-pending", [
        makeRow("27.05.2026", "SYNTHETIC NO REFERENCE", "21.00", "Bokført"),
      ]);
      const crossAccountResponse = importRows("job-booked-cross-account", "acc-other", [
        makeRow("27.05.2026", "SYNTHETIC CROSS ACCOUNT", "22.00", "Bokført", "REF-CROSS"),
      ]);
      const ambiguousResponse = importRows("job-booked-ambiguous", "acc-pending", [
        makeRow("27.05.2026", "SYNTHETIC AMBIGUOUS", "23.00", "Bokført", "REF-AMBIG"),
      ]);

      expect(pendingResponse).toMatchObject({ ok: true, transactionCount: 0, pendingCount: 4 });
      expect(missingReferenceResponse).toMatchObject({ ok: true, transactionCount: 1 });
      expect(crossAccountResponse).toMatchObject({ ok: true, transactionCount: 1 });
      expect(ambiguousResponse).toMatchObject({ ok: true, transactionCount: 1 });
      expect(ledger.listPendingTransactionObservations("hh-pending")).toHaveLength(4);
      expect(ledger.getTransactionsForMonth("hh-pending", "2026-05")).toHaveLength(3);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists text-PDF pending rows without requiring excluded-row acknowledgement", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-pdf-pending-"));
    const ledger = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household: {
          id: "hh-pending",
          name: "Synthetic Household",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        accounts: [
          {
            id: "acc-pending",
            householdId: "hh-pending",
            name: "Synthetic Account",
            currencyCode: "NOK",
          },
        ],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const pdfText = [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 1",
        "Kontonummer: ACCT-001",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "29.05.2026 Varekjøp ACCT-001 LOCAL_USER -12,34 NOK Bekreftet KID: REF-PDF-PENDING-001 SYNTHETIC PDF SHOP",
      ].join("\n");
      const dependencies = {
        parserRegistry: defaultParserAdapterRegistry,
        appendImportJob: ledger.appendImportJob,
        appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
        appendTransactions: ledger.appendTransactions,
        getTransactionsForImportJob: ledger.getTransactionsForImportJob,
      };
      const response = runPdfImportWorkflow(
        {
          pdfText,
          filePath: "synthetic-pending.pdf",
          householdId: "hh-pending",
          accountId: "acc-pending",
          importJobId: "job-pdf-pending",
          startedAtIso: "2026-05-29T00:00:00Z",
          finishedAtIso: "2026-05-29T00:00:01Z",
        },
        dependencies
      );
      const replayResponse = runPdfImportWorkflow(
        {
          pdfText,
          filePath: "synthetic-pending.pdf",
          householdId: "hh-pending",
          accountId: "acc-pending",
          importJobId: "job-pdf-pending-replay",
          startedAtIso: "2026-05-29T00:00:02Z",
          finishedAtIso: "2026-05-29T00:00:03Z",
        },
        dependencies
      );

      expect(response).toMatchObject({ ok: true, transactionCount: 0 });
      expect(replayResponse).toMatchObject({ ok: true, transactionCount: 0 });
      expect(ledger.listPendingTransactionObservations("hh-pending")).toHaveLength(1);
      expect(ledger.listPendingTransactionObservations("hh-pending")).toMatchObject([
        {
          accountId: "acc-pending",
          amountMinor: -1234,
          sourceReference: "REF-PDF-PENDING-001",
          status: "confirmed",
          sourceStatus: "Bekreftet",
          sourceType: "pdf",
          importJobId: "job-pdf-pending",
        },
      ]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
