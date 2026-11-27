import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { createLoanRegistry } from "../../src/app/loanRegistry.js";
import { exportLedgerCsvToFile } from "../../src/app/exportCsv.js";
import {
  createMortgageBankImportService,
  previewMortgageDocumentPair,
  previewMortgageScheduleFile,
  readBoundedMortgageHtmlFile,
} from "../../src/app/mortgageBankImportService.js";

const VALID_DETAILS_HTML = `
  <h1>Lånedetaljer</h1>
  <dl>
    <dt>Lånenummer</dt><dd>loan-123</dd>
    <dt>Lånevaluta</dt><dd>NOK</dd>
    <dt>Opprinnelig lånebeløp</dt><dd>100 000,00</dd>
    <dt>Restgjeld</dt><dd>99 000,00</dd>
  </dl>
`;
const VALID_SCHEDULE_HTML = `
  <h1>Nedbetalingsplan</h1>
  <dl>
    <dt>Inngående saldo</dt><dd>100 000,00</dd>
    <dt>Lånenummer</dt><dd>loan-123</dd>
    <dt>Lånevaluta</dt><dd>NOK</dd>
  </dl>
  <table>
    <tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th><th>Source account</th></tr>
    <tr><td>Januar 2026</td><td>1 000,00</td><td>90,00</td><td>10,00</td><td>1 100,00</td><td>99 000,00</td><td>loan-123</td></tr>
    <tr><td>Februar 2026</td><td>1 000,00</td><td>89,00</td><td>10,00</td><td>1 099,00</td><td>98 000,00</td><td>loan-123</td></tr>
  </table>
`;
const ZERO_PRINCIPAL_SCHEDULE_HTML = `
  <h1>Nedbetalingsplan</h1>
  <dl>
    <dt>Inngående saldo</dt><dd>100 000,00</dd>
    <dt>Lånenummer</dt><dd>loan-123</dd>
    <dt>Lånevaluta</dt><dd>NOK</dd>
  </dl>
  <table>
    <tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th></tr>
    <tr><td>Januar 2026</td><td>0,00</td><td>90,00</td><td>10,00</td><td>100,00</td><td>100 000,00</td></tr>
  </table>
`;
const SELECTED_LOAN_IDENTITY = {
  loanReference: "loan-123",
  currencyCode: "NOK",
  loanReferenceValues: [],
  currencyValues: [],
  conflicts: [],
} as const;

function getRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${name} to be an object.`);
  }
  return value as Record<string, unknown>;
}

describe("bounded mortgage HTML file reads", () => {
  it("uses a saved loan currency for amount comparisons only after attachment confirmation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-selected-currency-"));
    const databasePath = join(directory, "ledger.sqlite");
    const detailsFilePath = join(
      process.cwd(),
      "tests",
      "fixtures",
      "synthetic",
      "rogaland-2026-11-mortgage-details-bank-layout.html"
    );
    const scheduleFilePath = join(
      process.cwd(),
      "tests",
      "fixtures",
      "synthetic",
      "rogaland-2026-11-mortgage-schedule-bank-layout.html"
    );
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: {
          id: "household-mortgage-selected-currency",
          name: "Synthetic household",
          createdAtIso: "2026-01-01T00:00:00.000Z",
        },
        accounts: [{
          id: "account-mortgage-selected-currency",
          householdId: "household-mortgage-selected-currency",
          name: "Current",
          currencyCode: "NOK",
        }],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const loans = createLoanRegistry(database, {
        createId: () => "loan-selected-currency",
        now: () => new Date("2026-11-21T12:00:00.000Z"),
      });
      const loan = loans.create({
        label: "Synthetic mortgage",
        principalMinor: 10_000_000,
        annualInterestRateBasisPoints: 500,
        termMonths: 120,
        paymentAmountMinor: 100_000,
        paymentFrequency: "monthly",
        currencyCode: "NOK",
      });
      const service = createMortgageBankImportService(database, {
        maxBytesPerFile: 10_000,
        parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
        createId: () => "mortgage-selected-currency-evidence",
        now: () => new Date("2026-11-21T12:30:00.000Z"),
      });
      const preview = await service.previewFiles({
        filePaths: [detailsFilePath, scheduleFilePath],
        target: { kind: "existing", loanId: loan.id },
        attachmentConfirmed: false,
      });

      expect(preview.reviewState).toBe("attachment-confirmation-required");
      expect(preview.termComparisons).toEqual([]);
      expect(preview.documents.map((document) =>
        document.parsedDocument.identityDisplay.currencyCode
      )).toEqual([null, null]);

      const confirmedPreview = service.confirmAttachmentPreview(preview.previewId);
      expect(confirmedPreview.termComparisons).toContainEqual({
        field: "originalPrincipalMinor",
        sourceLabel: "Opprinnelig lånebeløp",
        sourceValueMinor: 10_000_000,
        savedValueMinor: 10_000_000,
        currencyCode: "NOK",
        status: "matches",
      });
      const evidence = service.acceptPreview(confirmedPreview.previewId, true);

      expect(evidence.documents.map((document) =>
        document.parsedDocument.identityEvidence.currencyCode
      )).toEqual([null, null]);
      expect(evidence.termComparisons).toEqual(confirmedPreview.termComparisons);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses a user-selected currency for source-only evidence when the HTML omits currency", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-source-currency-"));
    const databasePath = join(directory, "ledger.sqlite");
    const detailsFilePath = join(
      process.cwd(),
      "tests",
      "fixtures",
      "synthetic",
      "rogaland-2026-11-mortgage-details-bank-layout.html"
    );
    const scheduleFilePath = join(
      process.cwd(),
      "tests",
      "fixtures",
      "synthetic",
      "rogaland-2026-11-mortgage-schedule-bank-layout.html"
    );
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: {
          id: "household-mortgage-source-currency",
          name: "Synthetic household",
          createdAtIso: "2026-01-01T00:00:00.000Z",
        },
        accounts: [{
          id: "account-mortgage-source-currency",
          householdId: "household-mortgage-source-currency",
          name: "Current",
          currencyCode: "NOK",
        }],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const service = createMortgageBankImportService(database, {
        maxBytesPerFile: 10_000,
        parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
        createId: () => "mortgage-source-currency-evidence",
        now: () => new Date("2026-11-21T12:30:00.000Z"),
      });
      const preview = await service.previewFiles({
        filePaths: [detailsFilePath, scheduleFilePath],
        target: {
          kind: "new-source-only",
          label: "Synthetic mortgage",
          currencyCode: "NOK",
        },
        attachmentConfirmed: false,
      });
      const confirmedPreview = service.confirmAttachmentPreview(preview.previewId);
      const evidence = service.acceptPreview(confirmedPreview.previewId, true);

      expect(database.listSourceOnlyLoanRecords("household-mortgage-source-currency"))
        .toMatchObject([{ label: "Synthetic mortgage", currencyCode: "NOK" }]);
      expect(evidence.documents.map((document) =>
        document.parsedDocument.identityEvidence.currencyCode
      )).toEqual([null, null]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts paired evidence as an immutable version without changing the existing loan", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-acceptance-"));
    const databasePath = join(directory, "ledger.sqlite");
    const snapshotPath = join(directory, "backup.json");
    const detailsFilePath = join(directory, "details.html");
    const scheduleFilePath = join(directory, "schedule.html");
    writeFileSync(detailsFilePath, VALID_DETAILS_HTML, "utf8");
    writeFileSync(scheduleFilePath, VALID_SCHEDULE_HTML, "utf8");
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: {
          id: "household-mortgage-import",
          name: "Synthetic household",
          createdAtIso: "2026-01-01T00:00:00.000Z",
        },
        accounts: [{
          id: "account-mortgage-import",
          householdId: "household-mortgage-import",
          name: "Current",
          currencyCode: "NOK",
        }],
        transactions: [{
          id: "transaction-before-mortgage-import",
          householdId: "household-mortgage-import",
          accountId: "account-mortgage-import",
          bookedAtIso: "2026-10-15T12:00:00.000Z",
          amountMinor: -12_500,
          merchantRaw: "Synthetic grocery",
          currencyCode: "NOK",
          sourceType: "manual",
        }],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const loans = createLoanRegistry(database, {
        createId: () => "loan-existing",
        now: () => new Date("2026-11-21T12:00:00.000Z"),
      });
      const loan = loans.create({
        label: "Existing mortgage",
        principalMinor: 10_000_000,
        annualInterestRateBasisPoints: 500,
        termMonths: 120,
        paymentAmountMinor: 100_000,
        paymentFrequency: "monthly",
        currencyCode: "NOK",
      });
      const balance = loans.appendBalance({
        loanId: loan.id,
        effectiveDateIso: "2026-10-01",
        amountMinor: 9_900_000,
      });
      const ledgerCsvBefore = exportLedgerCsvToFile({
        ledger: database,
        outputPath: join(directory, "ledger.csv"),
      });
      const service = createMortgageBankImportService(database, {
        maxBytesPerFile: 10_000,
        parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
        createId: () => "mortgage-evidence-v1",
        now: () => new Date("2026-11-21T12:30:00.000Z"),
      });

      const preview = await service.previewFiles({
        filePaths: [detailsFilePath, scheduleFilePath],
        target: { kind: "existing", loanId: loan.id },
        attachmentConfirmed: true,
      });
      expect(preview.reviewState).toBe("paired-schedule-checks-passed");

      const evidence = service.acceptPreview(preview.previewId);
      expect(evidence).toMatchObject({
        id: "mortgage-evidence-v1",
        loanId: loan.id,
        householdId: "household-mortgage-import",
        versionNumber: 1,
        sourceAsOfDateIso: null,
        importedAtIso: "2026-11-21T12:30:00.000Z",
        pairing: { status: "verified" },
        attachment: { status: "confirmed", verification: "explicit-user-attachment" },
        scheduleValidation: { status: "valid" },
      });
      expect(evidence.documents.map((document) => document.role)).toEqual(["details", "schedule"]);
      expect(evidence.documents[0]).not.toHaveProperty("sourceHtml");
      expect(evidence.documents[1]).not.toHaveProperty("sourceHtml");
      expect(evidence.documents[0]?.sourceHashSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(evidence.documents[0]?.parsedDocument.detailsFields[0]?.sourceValue)
        .toBe("100 000,00");
      expect(evidence.documents[1]?.parsedDocument.scheduleRows[0]?.paymentMinor).toBe(110_000);
      expect(JSON.stringify(evidence)).not.toContain("<h1>");
      expect(database.listMortgageEvidenceVersions(
        "household-mortgage-import",
        loan.id
      )).toEqual([evidence]);
      expect(loans.list()).toEqual([{ ...loan, balances: [balance] }]);
      const ledgerCsvAfter = exportLedgerCsvToFile({
        ledger: database,
        outputPath: join(directory, "ledger.csv"),
      });
      expect(ledgerCsvAfter.rowCount).toBe(1);
      expect(ledgerCsvAfter.csvText).toBe(ledgerCsvBefore.csvText);

      createBackupSnapshot({
        ...database.loadLedgerSnapshotData(),
        outputPath: snapshotPath,
        createdAtIso: "2026-11-21T12:31:00.000Z",
      });
      expect(restoreBackupSnapshot({ snapshotPath }).mortgageEvidenceVersions).toEqual([evidence]);

      const liveStateBeforeRejectedRestore = database.loadLedgerSnapshotData();
      const rawHtmlSnapshot = getRecord(
        JSON.parse(readFileSync(snapshotPath, "utf8")) as unknown,
        "snapshot"
      );
      const mortgageVersions = rawHtmlSnapshot["mortgageEvidenceVersions"];
      if (!Array.isArray(mortgageVersions)) throw new Error("Expected mortgage evidence versions.");
      const firstVersion = getRecord(mortgageVersions[0], "mortgage evidence version");
      const documents = firstVersion["documents"];
      if (!Array.isArray(documents)) throw new Error("Expected mortgage evidence documents.");
      const firstDocument = getRecord(documents[0], "mortgage evidence document");
      getRecord(firstDocument["parsedDocument"], "parsed mortgage document")["sourceHtml"] =
        VALID_DETAILS_HTML;
      const rawHtmlSnapshotPath = join(directory, "raw-html-backup.json");
      writeFileSync(rawHtmlSnapshotPath, JSON.stringify(rawHtmlSnapshot), "utf8");
      expect(() => database.replaceLedgerSnapshotData(
        restoreBackupSnapshot({ snapshotPath: rawHtmlSnapshotPath })
      )).toThrow(/Invalid snapshot mortgage evidence documents/);
      expect(database.loadLedgerSnapshotData()).toEqual(liveStateBeforeRejectedRestore);

      const incompatibleSnapshotPath = join(directory, "incompatible-backup.json");
      const incompatibleSnapshot = getRecord(
        JSON.parse(readFileSync(snapshotPath, "utf8")) as unknown,
        "snapshot"
      );
      getRecord(incompatibleSnapshot["metadata"], "snapshot metadata")["version"] = "999";
      writeFileSync(incompatibleSnapshotPath, JSON.stringify(incompatibleSnapshot), "utf8");
      expect(() => database.replaceLedgerSnapshotData(
        restoreBackupSnapshot({ snapshotPath: incompatibleSnapshotPath })
      )).toThrow(/Unsupported snapshot version/);
      expect(database.loadLedgerSnapshotData()).toEqual(liveStateBeforeRejectedRestore);

      const liveStateBeforeInterruptedRestore = database.loadLedgerSnapshotData();
      const faultDatabase = new DatabaseSync(databasePath);
      try {
        faultDatabase.exec(`
          CREATE TRIGGER reject_mortgage_evidence_restore
          BEFORE INSERT ON mortgage_evidence_versions
          WHEN NEW.id = 'mortgage-evidence-v1'
          BEGIN
            SELECT RAISE(ABORT, 'synthetic mortgage restore failure');
          END;
        `);
      } finally {
        faultDatabase.close();
      }
      expect(() => database.replaceLedgerSnapshotData(restoreBackupSnapshot({ snapshotPath })))
        .toThrow("synthetic mortgage restore failure");
      expect(database.loadLedgerSnapshotData()).toEqual(liveStateBeforeInterruptedRestore);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains unsupported product-type evidence through acceptance and backup restore", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-product-type-"));
    const databasePath = join(directory, "ledger.sqlite");
    const snapshotPath = join(directory, "backup.json");
    const detailsFilePath = join(directory, "details.html");
    const scheduleFilePath = join(directory, "schedule.html");
    const unsupportedProductType = {
      field: "unsupportedProductType",
      sourceLabel: "Lånetype",
      sourceValue: "Rammelån",
    };
    const detailsWithProductType = VALID_DETAILS_HTML.replace(
      "<dt>Opprinnelig lånebeløp</dt>",
      "<dt>Lånetype</dt><dd>Rammelån</dd><dt>Opprinnelig lånebeløp</dt>"
    );
    writeFileSync(detailsFilePath, detailsWithProductType, "utf8");
    writeFileSync(scheduleFilePath, VALID_SCHEDULE_HTML, "utf8");
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: {
          id: "household-mortgage-product-type",
          name: "Synthetic household",
          createdAtIso: "2026-01-01T00:00:00.000Z",
        },
        accounts: [{
          id: "account-mortgage-product-type",
          householdId: "household-mortgage-product-type",
          name: "Current",
          currencyCode: "NOK",
        }],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const loans = createLoanRegistry(database, {
        createId: () => "loan-product-type",
        now: () => new Date("2026-11-21T12:00:00.000Z"),
      });
      const loan = loans.create({
        label: "Existing mortgage",
        principalMinor: 10_000_000,
        annualInterestRateBasisPoints: 500,
        termMonths: 120,
        paymentAmountMinor: 100_000,
        paymentFrequency: "monthly",
        currencyCode: "NOK",
      });
      const service = createMortgageBankImportService(database, {
        maxBytesPerFile: 10_000,
        parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
        createId: () => "mortgage-evidence-product-type",
        now: () => new Date("2026-11-21T12:30:00.000Z"),
      });
      const preview = await service.previewFiles({
        filePaths: [detailsFilePath, scheduleFilePath],
        target: { kind: "existing", loanId: loan.id },
        attachmentConfirmed: true,
      });

      expect(preview.reviewState).toBe("review-required");
      expect(preview.documents[0]?.parsedDocument.detailsFields)
        .toContainEqual(unsupportedProductType);
      const accepted = service.acceptPreview(preview.previewId, true);
      const acceptedDetails = accepted.documents.find((document) => document.role === "details");
      expect(acceptedDetails?.parsedDocument.detailsFields).toContainEqual(unsupportedProductType);

      createBackupSnapshot({
        ...database.loadLedgerSnapshotData(),
        outputPath: snapshotPath,
        createdAtIso: "2026-11-21T12:31:00.000Z",
      });
      const snapshot = getRecord(
        JSON.parse(readFileSync(snapshotPath, "utf8")) as unknown,
        "snapshot"
      );
      const metadata = getRecord(snapshot["metadata"], "snapshot metadata");
      expect(metadata["version"]).toBe("17");
      const restored = restoreBackupSnapshot({ snapshotPath });
      const restoredDetails = restored.mortgageEvidenceVersions[0]?.documents.find(
        (document) => document.role === "details"
      );
      expect(restoredDetails?.parsedDocument.detailsFields).toContainEqual(unsupportedProductType);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists an explicit source date separately from import time", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-source-date-"));
    const databasePath = join(directory, "ledger.sqlite");
    const detailsFilePath = join(directory, "details.html");
    const scheduleFilePath = join(directory, "schedule.html");
    const datedDetails = VALID_DETAILS_HTML.replace(
      "<dt>Lånenummer</dt>",
      "<dt>Utskriftsdato</dt><dd>21.11.2026</dd><dt>Lånenummer</dt>"
    );
    writeFileSync(detailsFilePath, datedDetails, "utf8");
    writeFileSync(scheduleFilePath, VALID_SCHEDULE_HTML, "utf8");
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: {
          id: "household-mortgage-source-date",
          name: "Synthetic household",
          createdAtIso: "2026-01-01T00:00:00.000Z",
        },
        accounts: [{
          id: "account-mortgage-source-date",
          householdId: "household-mortgage-source-date",
          name: "Current",
          currencyCode: "NOK",
        }],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const loans = createLoanRegistry(database, {
        createId: () => "loan-source-date",
        now: () => new Date("2026-11-21T12:00:00.000Z"),
      });
      const loan = loans.create({
        label: "Existing mortgage",
        principalMinor: 10_000_000,
        annualInterestRateBasisPoints: 500,
        termMonths: 120,
        paymentAmountMinor: 100_000,
        paymentFrequency: "monthly",
        currencyCode: "NOK",
      });
      const service = createMortgageBankImportService(database, {
        maxBytesPerFile: 10_000,
        parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
        createId: () => "dated-evidence",
        now: () => new Date("2026-11-22T09:00:00.000Z"),
      });
      const preview = await service.previewFiles({
        filePaths: [detailsFilePath, scheduleFilePath],
        target: { kind: "existing", loanId: loan.id },
        attachmentConfirmed: true,
      });
      const evidence = service.acceptPreview(preview.previewId);

      expect(evidence.sourceAsOfDateIso).toBe("2026-11-21");
      expect(evidence.importedAtIso).toBe("2026-11-22T09:00:00.000Z");
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("surfaces and records acknowledgement of imported values that differ from saved loan terms", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-term-conflict-"));
    const databasePath = join(directory, "ledger.sqlite");
    const detailsFilePath = join(directory, "details.html");
    const scheduleFilePath = join(directory, "schedule.html");
    const datedDetails = VALID_DETAILS_HTML
      .replace(
        "<dt>Lånenummer</dt>",
        "<dt>Utskriftsdato</dt><dd>21.11.2026</dd><dt>Lånenummer</dt>"
      )
      .replace(
        "<dt>Restgjeld</dt><dd>99 000,00</dd>",
        "<dt>Restgjeld</dt><dd>99 000,00</dd><dt>Nominell rente</dt><dd>5,25 %</dd>"
      );
    writeFileSync(detailsFilePath, datedDetails, "utf8");
    writeFileSync(scheduleFilePath, VALID_SCHEDULE_HTML, "utf8");
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: {
          id: "household-mortgage-term-conflict",
          name: "Synthetic household",
          createdAtIso: "2026-01-01T00:00:00.000Z",
        },
        accounts: [{
          id: "account-mortgage-term-conflict",
          householdId: "household-mortgage-term-conflict",
          name: "Current",
          currencyCode: "NOK",
        }],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const loans = createLoanRegistry(database, {
        createId: () => "loan-term-conflict",
        now: () => new Date("2026-11-21T12:00:00.000Z"),
      });
      const loan = loans.create({
        label: "Existing mortgage",
        principalMinor: 300_000_000,
        annualInterestRateBasisPoints: 450,
        termMonths: 300,
        paymentAmountMinor: 1_750_000,
        paymentFrequency: "monthly",
        currencyCode: "NOK",
      });
      loans.appendBalance({
        loanId: loan.id,
        effectiveDateIso: "2026-11-21",
        amountMinor: 9_800_000,
      });
      const service = createMortgageBankImportService(database, {
        maxBytesPerFile: 10_000,
        parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
        createId: () => "term-conflict-evidence",
        now: () => new Date("2026-11-21T12:30:00.000Z"),
      });
      const preview = await service.previewFiles({
        filePaths: [detailsFilePath, scheduleFilePath],
        target: { kind: "existing", loanId: loan.id },
        attachmentConfirmed: true,
      });

      expect(preview.termComparisons).toEqual([
        {
          field: "originalPrincipalMinor",
          sourceLabel: "Opprinnelig lånebeløp",
          sourceValueMinor: 10_000_000,
          savedValueMinor: 300_000_000,
          currencyCode: "NOK",
          status: "differs",
        },
        {
          field: "remainingPrincipalMinor",
          sourceLabel: "Restgjeld",
          sourceValueMinor: 9_900_000,
          savedValueMinor: 9_800_000,
          currencyCode: "NOK",
          savedEffectiveDateIso: "2026-11-21",
          status: "differs",
        },
        {
          field: "nominalAnnualRateBasisPoints",
          sourceLabel: "Nominell rente",
          sourceValueBasisPoints: 525,
          savedValueBasisPoints: 450,
          status: "differs",
        },
      ]);
      expect(() => service.acceptPreview(preview.previewId))
        .toThrow("Review and acknowledge imported differences before acceptance.");
      const accepted = service.acceptPreview(preview.previewId, false, true);
      expect(accepted.termComparisons).toEqual(preview.termComparisons);
      expect(accepted.termDifferencesAcknowledged).toBe(true);
      expect(database.listMortgageEvidenceVersions(
        "household-mortgage-term-conflict",
        loan.id
      )[0]).toMatchObject({
        termComparisons: preview.termComparisons,
        termDifferencesAcknowledged: true,
      });
      expect(loans.list()[0]?.principalMinor).toBe(300_000_000);
      expect(loans.list()[0]?.balances[0]?.amountMinor).toBe(9_800_000);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("blocks later evidence when a paired source conflicts, even if details omit identity", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-reference-change-"));
    const databasePath = join(directory, "ledger.sqlite");
    const detailsFilePath = join(directory, "details.html");
    const scheduleFilePath = join(directory, "schedule.html");
    writeFileSync(detailsFilePath, VALID_DETAILS_HTML, "utf8");
    writeFileSync(scheduleFilePath, VALID_SCHEDULE_HTML, "utf8");
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: {
          id: "household-mortgage-reference",
          name: "Synthetic household",
          createdAtIso: "2026-01-01T00:00:00.000Z",
        },
        accounts: [{
          id: "account-mortgage-reference",
          householdId: "household-mortgage-reference",
          name: "Current",
          currencyCode: "NOK",
        }],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const loans = createLoanRegistry(database, {
        createId: () => "loan-reference-stable",
        now: () => new Date("2026-11-21T12:00:00.000Z"),
      });
      const loan = loans.create({
        label: "Existing mortgage",
        principalMinor: 10_000_000,
        annualInterestRateBasisPoints: 500,
        termMonths: 120,
        paymentAmountMinor: 100_000,
        paymentFrequency: "monthly",
        currencyCode: "NOK",
      });
      let generatedId = 0;
      const service = createMortgageBankImportService(database, {
        maxBytesPerFile: 10_000,
        parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
        createId: () => `mortgage-reference-version-${++generatedId}`,
        now: () => new Date("2026-11-21T12:30:00.000Z"),
      });
      const initialPreview = await service.previewFiles({
        filePaths: [detailsFilePath, scheduleFilePath],
        target: { kind: "existing", loanId: loan.id },
        attachmentConfirmed: true,
      });
      service.acceptPreview(initialPreview.previewId);

      const conflictingSchedule = VALID_SCHEDULE_HTML.replaceAll("loan-123", "loan-456");
      const conflictVariants = [
        {
          name: "both pages identify another loan",
          detailsHtml: VALID_DETAILS_HTML.replace("loan-123", "loan-456"),
          scheduleHtml: conflictingSchedule,
        },
        {
          name: "the schedule conflicts while details omit identity",
          detailsHtml: VALID_DETAILS_HTML.replace(
            /<dt>Lånenummer<\/dt><dd>loan-123<\/dd>/u,
            ""
          ),
          scheduleHtml: conflictingSchedule,
        },
      ];
      for (const variant of conflictVariants) {
        writeFileSync(detailsFilePath, variant.detailsHtml, "utf8");
        writeFileSync(scheduleFilePath, variant.scheduleHtml, "utf8");
        const conflictingPreview = await service.previewFiles({
          filePaths: [detailsFilePath, scheduleFilePath],
          target: { kind: "existing", loanId: loan.id },
          attachmentConfirmed: true,
        });

        expect(conflictingPreview.reviewState).toBe("identity-conflict");
        expect(() => service.acceptPreview(conflictingPreview.previewId))
          .toThrow("Mortgage import preview is not ready for acceptance.");
        expect(database.listMortgageEvidenceVersions(
          "household-mortgage-reference",
          loan.id
        )).toHaveLength(1);
      }
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      fileName: "details.html",
      source: VALID_DETAILS_HTML,
      expectedReviewState: "details-checks-passed",
      expectedRole: "details",
    },
    {
      fileName: "schedule.html",
      source: VALID_SCHEDULE_HTML,
      expectedReviewState: "schedule-checks-passed",
      expectedRole: "schedule",
    },
  ] as const)(
    "accepts a single $expectedRole document as a separate evidence version",
    async ({ fileName, source, expectedReviewState, expectedRole }) => {
      const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-single-acceptance-"));
      const databasePath = join(directory, "ledger.sqlite");
      const filePath = join(directory, fileName);
      writeFileSync(filePath, source, "utf8");
      const database = createLocalLedgerDatabase({
        dbPath: databasePath,
        seedData: {
          household: {
            id: "household-mortgage-single",
            name: "Synthetic household",
            createdAtIso: "2026-01-01T00:00:00.000Z",
          },
          accounts: [{
            id: "account-mortgage-single",
            householdId: "household-mortgage-single",
            name: "Current",
            currencyCode: "NOK",
          }],
          transactions: [],
          importJobs: [],
          monthlyCategoryTargets: [],
        },
      });

      try {
        const loans = createLoanRegistry(database, {
          createId: () => "loan-single",
          now: () => new Date("2026-11-21T12:00:00.000Z"),
        });
        const loan = loans.create({
          label: "Existing mortgage",
          principalMinor: 10_000_000,
          annualInterestRateBasisPoints: 500,
          termMonths: 120,
          paymentAmountMinor: 100_000,
          paymentFrequency: "monthly",
          currencyCode: "NOK",
        });
        const service = createMortgageBankImportService(database, {
          maxBytesPerFile: 10_000,
          parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
          createId: () => `mortgage-${expectedRole}-evidence`,
          now: () => new Date("2026-11-21T12:30:00.000Z"),
        });
        const preview = await service.previewFiles({
          filePaths: [filePath],
          target: { kind: "existing", loanId: loan.id },
          attachmentConfirmed: true,
        });

        expect(preview.reviewState).toBe(expectedReviewState);
        const evidence = service.acceptPreview(preview.previewId);
        expect(evidence.documents.map((document) => document.role)).toEqual([expectedRole]);
        expect(evidence.scheduleValidation?.status ?? null)
          .toBe(expectedRole === "schedule" ? "valid" : null);
        expect(database.listMortgageEvidenceVersions(
          "household-mortgage-single",
          loan.id
        )).toEqual([evidence]);
      } finally {
        database.close();
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it("creates an incomplete loan only in the same acceptance that stores its evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-new-source-only-"));
    const databasePath = join(directory, "ledger.sqlite");
    const detailsFilePath = join(directory, "details.html");
    const scheduleFilePath = join(directory, "schedule.html");
    writeFileSync(detailsFilePath, VALID_DETAILS_HTML, "utf8");
    writeFileSync(scheduleFilePath, VALID_SCHEDULE_HTML, "utf8");
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: {
          id: "household-mortgage-new",
          name: "Synthetic household",
          createdAtIso: "2026-01-01T00:00:00.000Z",
        },
        accounts: [{
          id: "account-mortgage-new",
          householdId: "household-mortgage-new",
          name: "Current",
          currencyCode: "NOK",
        }],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      let generatedId = 0;
      const service = createMortgageBankImportService(database, {
        maxBytesPerFile: 10_000,
        parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
        createId: () => `mortgage-record-${++generatedId}`,
        now: () => new Date("2026-11-21T12:30:00.000Z"),
      });
      const preview = await Reflect.apply(service.previewFiles, service, [{
        filePaths: [detailsFilePath, scheduleFilePath],
        target: { kind: "new-source-only", label: "Rogaland mortgage", currencyCode: "NOK" },
        attachmentConfirmed: true,
      }]) as { previewId: string; reviewState: string };
      expect(preview.reviewState).toBe("paired-schedule-checks-passed");
      const evidence = service.acceptPreview(preview.previewId);
      const sourceOnlyLoan = database.listSourceOnlyLoanRecords("household-mortgage-new");

      expect(sourceOnlyLoan).toEqual([{
        id: evidence.loanId,
        householdId: "household-mortgage-new",
        label: "Rogaland mortgage",
        currencyCode: "NOK",
        createdAtIso: "2026-11-21T12:30:00.000Z",
        responsibilityShareBasisPoints: 10_000,
        recordStatus: "source-only",
      }]);
      expect("principalMinor" in sourceOnlyLoan[0]!).toBe(false);
      expect(database.listMortgageEvidenceVersions(
        "household-mortgage-new",
        evidence.loanId
      )).toEqual([evidence]);

      const nextPreview = await service.previewFiles({
        filePaths: [detailsFilePath, scheduleFilePath],
        target: { kind: "existing", loanId: evidence.loanId },
        attachmentConfirmed: true,
      });
      const nextEvidence = service.acceptPreview(nextPreview.previewId);
      expect(nextEvidence.loanId).toBe(evidence.loanId);
      expect(nextEvidence.versionNumber).toBe(2);
      expect(database.listSourceOnlyLoanRecords("household-mortgage-new")).toEqual(sourceOnlyLoan);
      expect(database.listMortgageEvidenceVersions(
        "household-mortgage-new",
        evidence.loanId
      )).toEqual([evidence, nextEvidence]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists a supported zero-principal source period without creating an actual balance", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-zero-principal-"));
    const databasePath = join(directory, "ledger.sqlite");
    const detailsFilePath = join(directory, "details.html");
    const scheduleFilePath = join(directory, "schedule.html");
    writeFileSync(detailsFilePath, VALID_DETAILS_HTML, "utf8");
    writeFileSync(scheduleFilePath, ZERO_PRINCIPAL_SCHEDULE_HTML, "utf8");
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: {
          id: "household-mortgage-zero-principal",
          name: "Synthetic household",
          createdAtIso: "2026-01-01T00:00:00.000Z",
        },
        accounts: [{
          id: "account-mortgage-zero-principal",
          householdId: "household-mortgage-zero-principal",
          name: "Current",
          currencyCode: "NOK",
        }],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const service = createMortgageBankImportService(database, {
        maxBytesPerFile: 10_000,
        parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
        createId: () => "mortgage-zero-principal-evidence",
        now: () => new Date("2026-11-21T12:30:00.000Z"),
      });
      const preview = await service.previewFiles({
        filePaths: [detailsFilePath, scheduleFilePath],
        target: { kind: "new-source-only", label: "Rogaland mortgage", currencyCode: "NOK" },
        attachmentConfirmed: true,
      });
      const evidence = service.acceptPreview(preview.previewId);
      const schedule = evidence.documents.find((document) => document.role === "schedule");

      expect(evidence.scheduleValidation).toEqual({ status: "valid", issues: [] });
      expect(schedule?.parsedDocument.scheduleRows[0]).toMatchObject({
        principalMinor: 0,
        interestMinor: 9_000,
        feeMinor: 1_000,
        paymentMinor: 10_000,
        projectedClosingBalanceMinor: 10_000_000,
      });
      expect(database.listSourceOnlyLoanRecords("household-mortgage-zero-principal"))
        .toHaveLength(1);
      expect(database.listLoanRecords("household-mortgage-zero-principal")).toEqual([]);
      const snapshot = database.loadLedgerSnapshotData();
      expect(snapshot.loanBalanceSnapshots).toEqual([]);
      expect(snapshot.transactions).toEqual([]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects acceptance after the selected loan changes since preview", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-stale-preview-"));
    const databasePath = join(directory, "ledger.sqlite");
    const detailsFilePath = join(directory, "details.html");
    const scheduleFilePath = join(directory, "schedule.html");
    writeFileSync(detailsFilePath, VALID_DETAILS_HTML, "utf8");
    writeFileSync(scheduleFilePath, VALID_SCHEDULE_HTML, "utf8");
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: {
          id: "household-mortgage-stale",
          name: "Synthetic household",
          createdAtIso: "2026-01-01T00:00:00.000Z",
        },
        accounts: [{
          id: "account-mortgage-stale",
          householdId: "household-mortgage-stale",
          name: "Current",
          currencyCode: "NOK",
        }],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const loans = createLoanRegistry(database, {
        createId: () => "loan-stale",
        now: () => new Date("2026-11-21T12:00:00.000Z"),
      });
      const loan = loans.create({
        label: "Existing mortgage",
        principalMinor: 10_000_000,
        annualInterestRateBasisPoints: 500,
        termMonths: 120,
        paymentAmountMinor: 100_000,
        paymentFrequency: "monthly",
        currencyCode: "NOK",
      });
      const service = createMortgageBankImportService(database, {
        maxBytesPerFile: 10_000,
        parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
        createId: () => "stale-evidence",
        now: () => new Date("2026-11-21T12:30:00.000Z"),
      });
      const preview = await service.previewFiles({
        filePaths: [detailsFilePath, scheduleFilePath],
        target: { kind: "existing", loanId: loan.id },
        attachmentConfirmed: true,
      });
      loans.updateResponsibilityShare({
        loanId: loan.id,
        responsibilityShareBasisPoints: 5_000,
      });

      expect(() => service.acceptPreview(preview.previewId))
        .toThrow("Loan changed after mortgage evidence preview.");
      expect(database.listMortgageEvidenceVersions("household-mortgage-stale", loan.id))
        .toEqual([]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reads a local UTF-8 HTML file within the configured byte limit", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-html-"));
    const filePath = join(directory, "schedule.html");
    const source = "<h1>Nedbetalingsplan</h1>";
    writeFileSync(filePath, source, "utf8");

    try {
      expect(await readBoundedMortgageHtmlFile(filePath, Buffer.byteLength(source))).toBe(source);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a file that exceeds the byte limit without returning truncated content", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-html-limit-"));
    const filePath = join(directory, "schedule.html");
    writeFileSync(filePath, "<h1>too large</h1>", "utf8");

    try {
      await expect(readBoundedMortgageHtmlFile(filePath, 8)).rejects.toThrow(RangeError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed UTF-8 rather than guessing an encoding", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-html-encoding-"));
    const filePath = join(directory, "schedule.html");
    writeFileSync(filePath, Buffer.from([0x3c, 0x68, 0x3e, 0xc3, 0x28]));

    try {
      await expect(readBoundedMortgageHtmlFile(filePath, 8)).rejects.toThrow(TypeError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("honors cancellation before opening the file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-html-cancel-"));
    const filePath = join(directory, "schedule.html");
    writeFileSync(filePath, "<h1>Nedbetalingsplan</h1>", "utf8");
    const controller = new AbortController();
    controller.abort();

    try {
      await expect(readBoundedMortgageHtmlFile(filePath, 1_000, controller.signal))
        .rejects.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports schedule checks separately from import acceptance", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-preview-"));
    const filePath = join(directory, "schedule.html");
    writeFileSync(filePath, VALID_SCHEDULE_HTML, "utf8");

    try {
      const preview = await previewMortgageScheduleFile({
        filePath,
        maxBytes: Buffer.byteLength(VALID_SCHEDULE_HTML),
        parserLimits: {
          maxSourceCharacters: VALID_SCHEDULE_HTML.length,
          maxElements: 100,
          maxDepth: 20,
        },
        loanIdentity: SELECTED_LOAN_IDENTITY,
        attachmentConfirmed: false,
      });

      expect(preview.reviewState).toBe("schedule-checks-passed");
      expect(preview.parsedDocument.parseStatus).toBe("parsed");
      expect(preview.validation).toEqual({ status: "valid", issues: [] });
      expect(preview.parsedDocument.identityDisplay.maskedLoanReference).toBe("****-123");
      expect(preview.parsedDocument).not.toHaveProperty("identityEvidence");
      expect(preview.parsedDocument.scheduleRows[0]).not.toHaveProperty("sourceValues");
      expect(JSON.stringify(preview)).not.toContain("loan-123");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not mark a financially inconsistent schedule as schedule-checks-passed", async () => {
    const changedPayment = VALID_SCHEDULE_HTML.replace("1 100,00", "1 100,01");
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-preview-invalid-"));
    const filePath = join(directory, "schedule.html");
    writeFileSync(filePath, changedPayment, "utf8");

    try {
      const preview = await previewMortgageScheduleFile({
        filePath,
        maxBytes: Buffer.byteLength(changedPayment),
        parserLimits: {
          maxSourceCharacters: changedPayment.length,
          maxElements: 100,
          maxDepth: 20,
        },
        loanIdentity: SELECTED_LOAN_IDENTITY,
        attachmentConfirmed: false,
      });

      expect(preview.reviewState).toBe("invalid");
      expect(preview.validation).toEqual({
        status: "invalid",
        issues: [{ code: "payment-total-mismatch", rowIndex: 0 }],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("blocks contradictory source identity even after explicit confirmation", async () => {
    const conflictingSchedule = VALID_SCHEDULE_HTML.replace("loan-123", "loan-456");
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-preview-conflict-"));
    const filePath = join(directory, "schedule.html");
    writeFileSync(filePath, conflictingSchedule, "utf8");

    try {
      const preview = await previewMortgageScheduleFile({
        filePath,
        maxBytes: Buffer.byteLength(conflictingSchedule),
        parserLimits: {
          maxSourceCharacters: conflictingSchedule.length,
          maxElements: 100,
          maxDepth: 20,
        },
        loanIdentity: SELECTED_LOAN_IDENTITY,
        attachmentConfirmed: true,
      });

      expect(preview.reviewState).toBe("identity-conflict");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires attachment confirmation when the source has no identity evidence", async () => {
    const unidentifiedSchedule = VALID_SCHEDULE_HTML.replace(
      /<dl>[\s\S]*?<\/dl>/,
      ""
    );
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-preview-identity-unknown-"));
    const filePath = join(directory, "schedule.html");
    writeFileSync(filePath, unidentifiedSchedule, "utf8");

    try {
      const preview = await previewMortgageScheduleFile({
        filePath,
        maxBytes: Buffer.byteLength(unidentifiedSchedule),
        parserLimits: {
          maxSourceCharacters: unidentifiedSchedule.length,
          maxElements: 100,
          maxDepth: 20,
        },
        loanIdentity: SELECTED_LOAN_IDENTITY,
        attachmentConfirmed: false,
      });

      expect(preview.reviewState).toBe("attachment-confirmation-required");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("pairs verified details and schedule files before reporting schedule checks", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-paired-preview-"));
    const detailsFilePath = join(directory, "details.html");
    const scheduleFilePath = join(directory, "schedule.html");
    writeFileSync(detailsFilePath, VALID_DETAILS_HTML, "utf8");
    writeFileSync(scheduleFilePath, VALID_SCHEDULE_HTML, "utf8");

    try {
      const preview = await previewMortgageDocumentPair({
        detailsFilePath,
        scheduleFilePath,
        maxBytesPerFile: 10_000,
        parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
        attachmentConfirmed: false,
      });

      expect(preview.reviewState).toBe("paired-schedule-checks-passed");
      expect(preview.pairing).toEqual({ status: "verified", verification: "matching-identifiers" });
      expect(preview.validation).toEqual({ status: "valid", issues: [] });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not pair contradictory details and schedule files after confirmation", async () => {
    const conflictingDetails = VALID_DETAILS_HTML.replace("loan-123", "loan-456");
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-paired-conflict-"));
    const detailsFilePath = join(directory, "details.html");
    const scheduleFilePath = join(directory, "schedule.html");
    writeFileSync(detailsFilePath, conflictingDetails, "utf8");
    writeFileSync(scheduleFilePath, VALID_SCHEDULE_HTML, "utf8");

    try {
      const preview = await previewMortgageDocumentPair({
        detailsFilePath,
        scheduleFilePath,
        maxBytesPerFile: 10_000,
        parserLimits: { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 },
        attachmentConfirmed: true,
      });

      expect(preview.reviewState).toBe("identity-conflict");
      expect(preview.validation).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("mortgage import CI contract", () => {
  it("keeps mortgage profiling out of the Windows Playwright CI lane", () => {
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
    const playwrightStart = workflow.indexOf("  playwright-windows:");
    const nextJob = workflow.indexOf("  pr-guardrails:", playwrightStart);
    expect(playwrightStart).toBeGreaterThanOrEqual(0);
    expect(nextJob).toBeGreaterThan(playwrightStart);

    const playwrightJob = workflow.slice(playwrightStart, nextJob);
    expect(playwrightJob).not.toContain("Mortgage import benchmark proxy probe");
    expect(playwrightJob).not.toContain("benchmark:mortgage-import");
  });
});

describe("mortgage preview cancellation", () => {
  it("does not persist a source-only loan or evidence when preview is cancelled", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-mortgage-preview-cancel-"));
    const databasePath = join(directory, "ledger.sqlite");
    const detailsFilePath = join(directory, "details.html");
    const scheduleFilePath = join(directory, "schedule.html");
    const householdId = "mortgage-cancel-household";
    writeFileSync(detailsFilePath, VALID_DETAILS_HTML, "utf8");
    writeFileSync(scheduleFilePath, VALID_SCHEDULE_HTML, "utf8");
    const database = createLocalLedgerDatabase({
      dbPath: databasePath,
      seedData: {
        household: {
          id: householdId,
          name: "Synthetic household",
          createdAtIso: "2026-01-01T00:00:00.000Z",
        },
        accounts: [{
          id: "mortgage-cancel-account",
          householdId,
          name: "Synthetic account",
          currencyCode: "NOK",
        }],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const service = createMortgageBankImportService(database);
      const requestId = "mortgage-preview-cancel";
      service.beginPreviewRequest(requestId);
      const pendingPreview = service.previewFiles({
        requestId,
        filePaths: [detailsFilePath, scheduleFilePath],
        target: {
          kind: "new-source-only",
          label: "Synthetic mortgage",
          currencyCode: "NOK",
        },
        attachmentConfirmed: false,
      });

      expect(service.cancelPreview(requestId)).toBe(true);
      await expect(pendingPreview).rejects.toMatchObject({ name: "AbortError" });
      expect(service.listEvidenceSummaries()).toHaveLength(0);
      expect(database.listSourceOnlyLoanRecords(householdId)).toHaveLength(0);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
