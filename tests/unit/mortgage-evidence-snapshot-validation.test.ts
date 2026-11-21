import { describe, expect, it } from "vitest";
import { validateMortgageEvidenceVersions } from "../../src/app/backup/snapshotRecordValidation.js";

describe("mortgage evidence snapshot validation", () => {
  it("rejects raw HTML nested in a parsed mortgage document", () => {
    const evidenceVersion = {
      id: "evidence-1",
      loanId: "loan-1",
      householdId: "household-1",
      versionNumber: 1,
      sourceAsOfDateIso: null,
      importedAtIso: "2026-01-02T03:04:05.000Z",
      documents: [{
        role: "details",
        sourceHashSha256: "a".repeat(64),
        parserVersion: "1",
        parserLimits: {
          maxSourceCharacters: 10_000,
          maxElements: 100,
          maxDepth: 20,
        },
        parsedDocument: {
          role: "details",
          parseStatus: "parsed",
          sourceDateEvidence: {
            dateIso: null,
            sourceLabels: [],
            sourceValues: [],
            conflict: false,
          },
          detailsFields: [{
            field: "originalPrincipalMinor",
            amountMinor: 100_000,
            sourceLabel: "Opprinnelig lånebeløp",
            sourceValue: "1 000,00",
          }],
          identityEvidence: {
            loanReference: null,
            currencyCode: "NOK",
            loanReferenceValues: [],
            currencyValues: ["NOK"],
            conflicts: [],
          },
          openingBalanceEvidence: null,
          scheduleRows: [],
          sourceHtml: "<html><body>synthetic</body></html>",
        },
      }],
      pairing: null,
      attachment: {
        status: "confirmed",
        verification: "explicit-user-attachment",
      },
      termComparisons: [],
      termDifferencesAcknowledged: false,
      scheduleValidation: null,
    };

    expect(() => validateMortgageEvidenceVersions(
      [evidenceVersion],
      "household-1",
      new Set(["loan-1"]),
      "snapshot.json"
    )).toThrow("Invalid snapshot mortgage evidence documents: snapshot.json");
  });
});
