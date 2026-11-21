import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessMortgageDocumentPairing,
  parseRogalandMortgageHtml,
  parseRogalandMortgageMinorUnits,
  validateRogalandMortgageSchedule,
} from "../../src/domain/import/rogalandMortgageHtml.js";

const REORDERED_SCHEDULE_HTML = `
  <nav>
    <table><tr><th>Account</th><th>Balance</th></tr><tr><td>Home</td><td>100000</td></tr></table>
  </nav>
  <main>
    <h1>Nedbetalingsplan</h1>
    <div class="report">
      <table>
        <thead>
          <tr>
            <th>Termin</th><th>Restgjeld</th><th>Gebyr</th>
            <th>Terminbeløp</th><th>Renter</th><th>Avdrag</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Januar 2026</td><td>99&nbsp;000,00</td><td>10,00</td>
            <td>1 100,00</td><td>90,00</td><td>1 000,00</td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>
`;
const TWO_MONTH_SCHEDULE_HTML = `
  <h1>Nedbetalingsplan</h1>
  <dl><dt>Inngående saldo</dt><dd>100 000,00</dd></dl>
  <table>
    <thead>
      <tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th></tr>
    </thead>
    <tbody>
      <tr><td>Januar 2026</td><td>1 000,00</td><td>90,00</td><td>10,00</td><td>1 100,00</td><td>99 000,00</td></tr>
      <tr><td>Februar 2026</td><td>1 000,00</td><td>89,00</td><td>10,00</td><td>1 099,00</td><td>98 000,00</td></tr>
    </tbody>
  </table>
`;
const DETAILS_ONLY_HTML = `
  <h1>Lånedetaljer</h1>
  <table>
    <tr><th>Opprinnelig lånebeløp</th><td>100 000,00</td></tr>
    <tr><th>Restgjeld</th><td>99 000,00</td></tr>
  </table>
`;

function parseSchedule(source: string) {
  const parsed = parseRogalandMortgageHtml(source, {
    maxSourceCharacters: 10_000,
    maxElements: 1_000,
    maxDepth: 100,
  });
  if (parsed.role !== "schedule") throw new Error("Expected a schedule document.");
  return parsed;
}

const GROUPED_MONTH_LABELS = [
  "Januar",
  "Februar",
  "Mars",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

function buildGroupedMonthlySchedule(
  years: readonly number[],
  options: { readonly omittedPeriod?: string; readonly collapsedPeriod?: string } = {}
): string {
  let installmentCount = 0;
  const rows: string[] = [];
  for (const year of years) {
    rows.push(`<tr><th colspan="6" scope="rowgroup">${year}</th></tr>`);
    for (const [monthIndex, monthLabel] of GROUPED_MONTH_LABELS.entries()) {
      const periodKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
      if (periodKey === options.omittedPeriod) continue;
      installmentCount += 1;
      const closingBalance = (1_000_000 - installmentCount * 100).toFixed(2).replace(".", ",");
      const collapsed = periodKey === options.collapsedPeriod ? ' style="display:none"' : "";
      rows.push(
        `<tr${collapsed}><td>${monthLabel}</td><td>100,00</td><td>90,00</td>` +
          `<td>10,00</td><td>200,00</td><td>${closingBalance}</td></tr>`
      );
    }
  }

  return `
    <h1>Nedbetalingsplan</h1>
    <dl><dt>Inngående saldo</dt><dd>1 000 000,00</dd></dl>
    <table>
      <thead>
        <tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th></tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
}

describe("Rogaland mortgage amount parsing", () => {
  it.each([
    { source: "1\u00a0234,56", expected: 123456 },
    { source: "1\u200d234,56", expected: 123456 },
    { source: "\u22121\u00a0234,56\u00a0k\u200dr", expected: -123456 },
    { source: "-2.345,60", expected: -234560 },
    { source: "12,5", expected: 1250 },
  ])("parses Norwegian amount $source into exact minor units", ({ source, expected }) => {
    expect(parseRogalandMortgageMinorUnits(source)).toBe(expected);
  });

  it("rejects duplicate monthly periods instead of treating them as a coverage gap", () => {
    const duplicatePeriod = TWO_MONTH_SCHEDULE_HTML.replace("Februar 2026", "Januar 2026");

    expect(validateRogalandMortgageSchedule(parseSchedule(duplicatePeriod))).toEqual({
      status: "invalid",
      issues: [{ code: "duplicate-period", rowIndex: 1 }],
    });
  });

  it("does not use original principal as schedule opening balance evidence", () => {
    const originalPrincipalOnly = TWO_MONTH_SCHEDULE_HTML.replace(
      "<dt>Inngående saldo</dt><dd>100 000,00</dd>",
      "<dt>Opprinnelig lånebeløp</dt><dd>100 000,00</dd>"
    );

    expect(validateRogalandMortgageSchedule(parseSchedule(originalPrincipalOnly))).toEqual({
      status: "partial",
      issues: [{ code: "opening-balance-unknown", rowIndex: 0 }],
    });
  });

  it("keeps an annual-only schedule partial without source-linked opening balance evidence", () => {
    const annualSchedule = `
      <h1>Nedbetalingsplan</h1>
      <table>
        <tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th></tr>
        <tr><td>2026</td><td>12 000,00</td><td>1 000,00</td><td>120,00</td><td>13 120,00</td><td>88 000,00</td></tr>
      </table>
    `;

    expect(validateRogalandMortgageSchedule(parseSchedule(annualSchedule))).toEqual({
      status: "partial",
      issues: [{ code: "opening-balance-unknown", rowIndex: 0 }],
    });
  });

  it("validates annual closing balance against an opening balance for that year", () => {
    const annualSchedule = `
      <h1>Nedbetalingsplan</h1>
      <dl><dt>Inngående saldo</dt><dd>100 000,00</dd></dl>
      <table>
        <tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th></tr>
        <tr><td>2026</td><td>12 000,00</td><td>1 000,00</td><td>120,00</td><td>13 120,00</td><td>88 000,00</td></tr>
      </table>
    `;

    expect(validateRogalandMortgageSchedule(parseSchedule(annualSchedule)))
      .toEqual({ status: "valid", issues: [] });
  });

  it("rejects duplicate annual summaries", () => {
    const annualSchedule = `
      <h1>Nedbetalingsplan</h1>
      <dl><dt>Inngående saldo</dt><dd>100 000,00</dd></dl>
      <table>
        <tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th></tr>
        <tr><td>2026</td><td>12 000,00</td><td>1 000,00</td><td>120,00</td><td>13 120,00</td><td>88 000,00</td></tr>
        <tr><td>2026</td><td>12 000,00</td><td>1 000,00</td><td>120,00</td><td>13 120,00</td><td>88 000,00</td></tr>
      </table>
    `;

    expect(validateRogalandMortgageSchedule(parseSchedule(annualSchedule))).toEqual({
      status: "invalid",
      issues: [{ code: "duplicate-period", rowIndex: 1 }],
    });
  });

  it("rejects annual summaries that move backward in source order", () => {
    const annualSchedule = `
      <h1>Nedbetalingsplan</h1>
      <dl><dt>Inngående saldo</dt><dd>100 000,00</dd></dl>
      <table>
        <tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th></tr>
        <tr><td>2026</td><td>12 000,00</td><td>1 000,00</td><td>120,00</td><td>13 120,00</td><td>88 000,00</td></tr>
        <tr><td>2025</td><td>12 000,00</td><td>1 000,00</td><td>120,00</td><td>13 120,00</td><td>88 000,00</td></tr>
      </table>
    `;

    expect(validateRogalandMortgageSchedule(parseSchedule(annualSchedule))).toEqual({
      status: "invalid",
      issues: [{ code: "out-of-order-period", rowIndex: 1 }],
    });
  });

  it("rejects a negative source amount until its sign semantics are supported", () => {
    const negativeInterestSchedule = `
      <h1>Nedbetalingsplan</h1>
      <dl><dt>Inngående saldo</dt><dd>100 000,00</dd></dl>
      <table>
        <tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th></tr>
        <tr><td>Januar 2026</td><td>1 000,00</td><td>-10,00</td><td>10,00</td><td>1 000,00</td><td>99 000,00</td></tr>
      </table>
    `;

    expect(validateRogalandMortgageSchedule(parseSchedule(negativeInterestSchedule))).toEqual({
      status: "partial",
      issues: [{ code: "unsupported-sign", rowIndex: 0 }],
    });
  });

  it("rejects monthly periods that move backward in source order", () => {
    const outOfOrderPeriods = TWO_MONTH_SCHEDULE_HTML
      .replace("Januar 2026", "Mars 2026")
      .replace("Februar 2026", "Januar 2026");

    expect(validateRogalandMortgageSchedule(parseSchedule(outOfOrderPeriods))).toEqual({
      status: "invalid",
      issues: [{ code: "out-of-order-period", rowIndex: 1 }],
    });
  });

  it.each([
    "12 34,56",
    "1 234.567,89",
    "1.234,567",
    "1.2,34",
    "1,,23",
  ])("rejects malformed or ambiguous amount %s", (source) => {
    expect(parseRogalandMortgageMinorUnits(source)).toBeNull();
  });
});

describe("Rogaland mortgage document pairing", () => {
  it("verifies pairing when loan reference and currency both match", () => {
    expect(assessMortgageDocumentPairing(
      {
        loanReference: "123 456 78",
        currencyCode: "NOK",
        loanReferenceValues: ["123 456 78"],
        currencyValues: ["NOK"],
        conflicts: [],
      },
      {
        loanReference: "12345678",
        currencyCode: "nok",
        loanReferenceValues: ["12345678"],
        currencyValues: ["nok"],
        conflicts: [],
      },
      false
    )).toEqual({ status: "verified", verification: "matching-identifiers" });
  });

  it("requires explicit attachment when identity evidence is incomplete", () => {
    const details = {
      loanReference: null,
      currencyCode: "NOK",
      loanReferenceValues: [],
      currencyValues: ["NOK"],
      conflicts: [],
    };
    const schedule = {
      loanReference: "loan-123",
      currencyCode: "NOK",
      loanReferenceValues: ["loan-123"],
      currencyValues: ["NOK"],
      conflicts: [],
    };

    expect(assessMortgageDocumentPairing(details, schedule, false))
      .toEqual({ status: "confirmation-required" });
    expect(assessMortgageDocumentPairing(details, schedule, true))
      .toEqual({ status: "confirmed", verification: "explicit-user-attachment" });
  });

  it("rejects contradictory loan references even after explicit confirmation", () => {
    expect(assessMortgageDocumentPairing(
      {
        loanReference: "loan-123",
        currencyCode: "NOK",
        loanReferenceValues: ["loan-123"],
        currencyValues: ["NOK"],
        conflicts: [],
      },
      {
        loanReference: "loan-456",
        currencyCode: "NOK",
        loanReferenceValues: ["loan-456"],
        currencyValues: ["NOK"],
        conflicts: [],
      },
      true
    )).toEqual({ status: "conflict", reason: "loan-reference-mismatch" });
  });

  it("rejects contradictory currencies even after explicit confirmation", () => {
    expect(assessMortgageDocumentPairing(
      {
        loanReference: "loan-123",
        currencyCode: "NOK",
        loanReferenceValues: ["loan-123"],
        currencyValues: ["NOK"],
        conflicts: [],
      },
      {
        loanReference: "loan-123",
        currencyCode: "EUR",
        loanReferenceValues: ["loan-123"],
        currencyValues: ["EUR"],
        conflicts: [],
      },
      true
    )).toEqual({ status: "conflict", reason: "currency-mismatch" });
  });
});

describe("Rogaland mortgage HTML parsing", () => {
  it("parses schedule amounts with the bank's currency suffix", () => {
    const schedule = parseSchedule(`
      <h1>Nedbetalingsplan</h1>
      <table>
        <thead>
          <tr>
            <th>Periode</th><th>Du betaler</th><th>Avdrag</th>
            <th>Renter</th><th>Gebyr</th><th>Resterende lån</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Januar 2026</td><td>1 100,00&nbsp;k&zwj;r</td><td>1 000,00&nbsp;k&zwj;r</td>
            <td>90,00&nbsp;k&zwj;r</td><td>10,00&nbsp;k&zwj;r</td><td>99 000,00&nbsp;k&zwj;r</td>
          </tr>
        </tbody>
      </table>
    `);

    expect(schedule.scheduleRows[0]).toMatchObject({
      period: { granularity: "monthly", year: 2026, month: 1 },
      principalMinor: 100_000,
      interestMinor: 9_000,
      feeMinor: 1_000,
      paymentMinor: 110_000,
      projectedClosingBalanceMinor: 9_900_000,
    });
  });

  it("collects detail pairs wrapped in div elements", () => {
    const details = parseRogalandMortgageHtml(`
      <h1>Lånedetaljer</h1>
      <dl>
        <div>
          <dt>Opprinnelig lånebeløp</dt>
          <dd>\u2212100 000,00&nbsp;k&zwj;r</dd>
        </div>
      </dl>
    `, { maxSourceCharacters: 10_000, maxElements: 100, maxDepth: 20 });

    expect(details.role).toBe("details");
    expect(details.parseStatus).toBe("parsed");
    expect(details.detailsFields).toContainEqual({
      field: "originalPrincipalMinor",
      amountMinor: -10_000_000,
      sourceLabel: "Opprinnelig lånebeløp",
      sourceValue: "\u2212100 000,00\u00a0k\u200dr",
    });
  });

  it("parses the saved Rogaland details title and annual/monthly schedule layout", () => {
    const detailsHtml = readFileSync(join(
      process.cwd(),
      "tests",
      "fixtures",
      "synthetic",
      "rogaland-2026-11-mortgage-details-bank-layout.html"
    ), "utf8");
    const scheduleHtml = readFileSync(join(
      process.cwd(),
      "tests",
      "fixtures",
      "synthetic",
      "rogaland-2026-11-mortgage-schedule-bank-layout.html"
    ), "utf8");
    const details = parseRogalandMortgageHtml(detailsHtml, {
      maxSourceCharacters: 10_000,
      maxElements: 100,
      maxDepth: 20,
    });
    const schedule = parseRogalandMortgageHtml(scheduleHtml, {
      maxSourceCharacters: 10_000,
      maxElements: 100,
      maxDepth: 20,
    });

    expect(details.role).toBe("details");
    expect(details.detailsFields).toContainEqual({
      field: "originalPrincipalMinor",
      amountMinor: 10_000_000,
      sourceLabel: "Opprinnelig lånebeløp",
      sourceValue: "100 000,00",
    });
    expect(details.identityEvidence.loanReference).toBeNull();
    expect(details.identityEvidence.currencyCode).toBeNull();
    expect(details.sourceDateEvidence.dateIso).toBeNull();
    expect(details.detailsFields).not.toContainEqual(expect.objectContaining({
      sourceLabel: "Kontonummer",
    }));

    expect(schedule.role).toBe("schedule");
    expect(schedule.scheduleRows.map((row) => row.period)).toEqual([
      { granularity: "annual", year: 2026 },
      { granularity: "monthly", year: 2026, month: 11 },
      { granularity: "monthly", year: 2026, month: 12 },
    ]);
    expect(schedule.scheduleRows.map((row) => row.paymentMinor)).toEqual([
      219_900,
      110_000,
      109_900,
    ]);
    expect(schedule.identityEvidence.currencyCode).toBeNull();
  });

  it("uses verified year groups for long monthly schedules and leaves missing periods absent", () => {
    const threeYear = parseRogalandMortgageHtml(
      buildGroupedMonthlySchedule([2026, 2027, 2028]),
      { maxSourceCharacters: 100_000, maxElements: 5_000, maxDepth: 20 }
    );
    const thirtyYear = parseRogalandMortgageHtml(
      buildGroupedMonthlySchedule(
        Array.from({ length: 30 }, (_, index) => 2026 + index),
        { omittedPeriod: "2026-02", collapsedPeriod: "2026-03" }
      ),
      { maxSourceCharacters: 100_000, maxElements: 5_000, maxDepth: 20 }
    );

    expect(threeYear.parseStatus).toBe("parsed");
    expect(threeYear.scheduleRows).toHaveLength(36);
    expect(threeYear.scheduleRows[0]?.period)
      .toEqual({ granularity: "monthly", year: 2026, month: 1 });
    expect(threeYear.scheduleRows.at(-1)?.period)
      .toEqual({ granularity: "monthly", year: 2028, month: 12 });

    expect(thirtyYear.parseStatus).toBe("parsed");
    expect(thirtyYear.scheduleRows).toHaveLength(359);
    expect(thirtyYear.scheduleRows[1]?.period)
      .toEqual({ granularity: "monthly", year: 2026, month: 3 });
    expect(thirtyYear.scheduleRows.some((row) =>
      row.period.granularity === "monthly" && row.period.year === 2026 && row.period.month === 2
    )).toBe(false);
    const validation = validateRogalandMortgageSchedule(thirtyYear);
    expect(validation.status).toBe("partial");
    expect(validation.issues).toContainEqual({ code: "period-gap", rowIndex: 1 });
    expect(thirtyYear.scheduleRows.at(-1)?.period)
      .toEqual({ granularity: "monthly", year: 2055, month: 12 });

    const outOfOrderGroups = parseRogalandMortgageHtml(
      buildGroupedMonthlySchedule([2027, 2026]),
      { maxSourceCharacters: 10_000, maxElements: 1_000, maxDepth: 20 }
    );
    expect(outOfOrderGroups.scheduleRows).toHaveLength(24);
    expect(outOfOrderGroups.scheduleRows[12]?.period)
      .toEqual({ granularity: "monthly", year: 2026, month: 1 });
    expect(validateRogalandMortgageSchedule(outOfOrderGroups).issues)
      .toContainEqual({ code: "out-of-order-period", rowIndex: 12 });
  });

  it("maps reordered schedule columns by semantic headers and retains source context", () => {
    const result = parseRogalandMortgageHtml(REORDERED_SCHEDULE_HTML, {
      maxSourceCharacters: 10_000,
      maxElements: 1_000,
      maxDepth: 100,
    });

    expect(result).toEqual({
      parseStatus: "parsed",
      role: "schedule",
      detailsFields: [],
      identityEvidence: {
        loanReference: null,
        currencyCode: null,
        loanReferenceValues: [],
        currencyValues: [],
        conflicts: [],
      },
      sourceDateEvidence: {
        dateIso: null,
        sourceLabels: [],
        sourceValues: [],
        conflict: false,
      },
      openingBalanceEvidence: null,
      scheduleRows: [{
        periodLabel: "Januar 2026",
        period: { granularity: "monthly", year: 2026, month: 1 },
        principalMinor: 100_000,
        interestMinor: 9_000,
        feeMinor: 1_000,
        paymentMinor: 110_000,
        projectedClosingBalanceMinor: 9_900_000,
        sourceHeaders: ["Termin", "Restgjeld", "Gebyr", "Terminbeløp", "Renter", "Avdrag"],
        sourceValues: ["Januar 2026", "99\u00a0000,00", "10,00", "1 100,00", "90,00", "1 000,00"],
      }],
    });
  });

  it("rejects duplicated semantic schedule headers instead of selecting one", () => {
    const duplicatedPrincipalHeader = `
      <h1>Nedbetalingsplan</h1>
      <table>
        <tr>
          <th>Termin</th><th>Avdrag</th><th>Avdrag</th><th>Renter</th>
          <th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th>
        </tr>
        <tr>
          <td>Januar 2026</td><td>1 000,00</td><td>100,00</td><td>90,00</td>
          <td>10,00</td><td>1 100,00</td><td>99 000,00</td>
        </tr>
      </table>
    `;
    const result = parseRogalandMortgageHtml(duplicatedPrincipalHeader, {
      maxSourceCharacters: 10_000,
      maxElements: 1_000,
      maxDepth: 100,
    });

    expect(result.role).toBe("schedule");
    expect(result.parseStatus).toBe("unsupported");
    expect(result.scheduleRows).toEqual([]);
  });

  describe("Rogaland mortgage schedule reconciliation", () => {
    it("reconciles exact payment totals and consecutive monthly balances", () => {
      expect(validateRogalandMortgageSchedule(parseSchedule(TWO_MONTH_SCHEDULE_HTML)))
        .toEqual({ status: "valid", issues: [] });
    });

    it("retains source headers and exposes a swapped principal and interest interpretation", () => {
      const swappedValues = TWO_MONTH_SCHEDULE_HTML.replace(
        "<td>1 000,00</td><td>90,00</td>",
        "<td>90,00</td><td>1 000,00</td>"
      );
      const parsed = parseSchedule(swappedValues);
      const firstRow = parsed.scheduleRows[0];

      expect(firstRow).toMatchObject({
        principalMinor: 9_000,
        interestMinor: 100_000,
        sourceHeaders: ["Termin", "Avdrag", "Renter", "Gebyr", "Terminbeløp", "Restgjeld"],
        sourceValues: [
          "Januar 2026",
          "90,00",
          "1 000,00",
          "10,00",
          "1 100,00",
          "99 000,00",
        ],
      });
      expect(validateRogalandMortgageSchedule(parsed).issues)
        .toContainEqual({ code: "closing-balance-mismatch", rowIndex: 0 });
    });

    it("rejects a payment total that differs by one minor unit", () => {
      const changedPayment = TWO_MONTH_SCHEDULE_HTML.replace("1 100,00", "1 100,01");

      expect(validateRogalandMortgageSchedule(parseSchedule(changedPayment))).toEqual({
        status: "invalid",
        issues: [{ code: "payment-total-mismatch", rowIndex: 0 }],
      });
    });

    it("rejects a consecutive balance that differs by one minor unit", () => {
      const changedBalance = TWO_MONTH_SCHEDULE_HTML.replace("98 000,00", "97 999,99");

      expect(validateRogalandMortgageSchedule(parseSchedule(changedBalance))).toEqual({
        status: "invalid",
        issues: [{ code: "closing-balance-mismatch", rowIndex: 1 }],
      });
    });

    it("accepts a source-supported interest-only period", () => {
      const interestOnly = `
        <h1>Nedbetalingsplan</h1>
        <dl><dt>Inngående saldo</dt><dd>100 000,00</dd></dl>
        <table>
          <tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th></tr>
          <tr><td>Januar 2026</td><td>0,00</td><td>90,00</td><td>10,00</td><td>100,00</td><td>100 000,00</td></tr>
        </table>
      `;

      expect(validateRogalandMortgageSchedule(parseSchedule(interestOnly)))
        .toEqual({ status: "valid", issues: [] });
    });

    it("keeps explicitly financed fees out of the supplied cash-payment amount", () => {
      const financedFee = parseSchedule(`
        <h1>Nedbetalingsplan</h1>
        <dl><dt>Inngående saldo</dt><dd>100 000,00</dd></dl>
        <table>
          <tr>
            <th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th>
            <th>Terminbeløp</th><th>Restgjeld</th><th>Finansiert gebyr</th>
          </tr>
          <tr>
            <td>Januar 2026</td><td>0,00</td><td>90,00</td><td>0,00</td>
            <td>90,00</td><td>100 010,00</td><td>10,00</td>
          </tr>
        </table>
      `);

      expect(financedFee.scheduleRows[0]).toMatchObject({
        principalMinor: 0,
        interestMinor: 9_000,
        feeMinor: 0,
        paymentMinor: 9_000,
        projectedClosingBalanceMinor: 10_001_000,
        sourceHeaders: expect.arrayContaining(["Finansiert gebyr"]),
        sourceValues: expect.arrayContaining(["10,00"]),
      });
      expect(validateRogalandMortgageSchedule(financedFee)).toMatchObject({
        status: "partial",
        issues: [{ code: "unreconciled-balance-increase", rowIndex: 0 }],
      });
    });

    it("reports an unexplained debt increase as partial instead of inventing an adjustment", () => {
      const increasingBalance = `
        <h1>Nedbetalingsplan</h1>
        <dl><dt>Inngående saldo</dt><dd>100 000,00</dd></dl>
        <table>
          <tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th></tr>
          <tr><td>Januar 2026</td><td>0,00</td><td>90,00</td><td>10,00</td><td>100,00</td><td>100 001,00</td></tr>
        </table>
      `;

      expect(validateRogalandMortgageSchedule(parseSchedule(increasingBalance))).toEqual({
        status: "partial",
        issues: [{ code: "unreconciled-balance-increase", rowIndex: 0 }],
      });
    });

    it("extracts source loan reference and currency from semantic details labels", () => {
      const result = parseRogalandMortgageHtml(`
        <h1>Lånedetaljer</h1>
        <dl>
          <dt>Lånenummer</dt><dd>loan-123</dd>
          <dt>Lånevaluta</dt><dd>nok</dd>
        </dl>
      `, { maxSourceCharacters: 1_000, maxElements: 100, maxDepth: 20 });

      expect(result.identityEvidence).toEqual({
        loanReference: "loan-123",
        currencyCode: "nok",
        loanReferenceValues: ["loan-123"],
        currencyValues: ["nok"],
        conflicts: [],
      });
    });

    it("preserves an explicitly labeled source-as-of date without substituting import time", () => {
      const result = parseRogalandMortgageHtml(`
        <h1>Lånedetaljer</h1>
        <dl>
          <dt>Utskriftsdato</dt><dd>21.11.2026</dd>
          <dt>Opprinnelig lånebeløp</dt><dd>100 000,00</dd>
        </dl>
      `, { maxSourceCharacters: 1_000, maxElements: 100, maxDepth: 20 });

      expect(Reflect.get(result, "sourceDateEvidence")).toEqual({
        dateIso: "2026-11-21",
        sourceLabels: ["Utskriftsdato"],
        sourceValues: ["21.11.2026"],
        conflict: false,
      });
    });

    it("leaves an undated source unknown and marks contradictory explicit dates partial", () => {
      const undated = parseRogalandMortgageHtml(DETAILS_ONLY_HTML, {
        maxSourceCharacters: 1_000,
        maxElements: 100,
        maxDepth: 20,
      });
      const conflictingDates = parseRogalandMortgageHtml(`
        <h1>Lånedetaljer</h1>
        <dl>
          <dt>Utskriftsdato</dt><dd>21.11.2026</dd>
          <dt>Utskriftsdato</dt><dd>22.11.2026</dd>
          <dt>Opprinnelig lånebeløp</dt><dd>100 000,00</dd>
        </dl>
      `, { maxSourceCharacters: 1_000, maxElements: 100, maxDepth: 20 });

      expect(Reflect.get(undated, "sourceDateEvidence")).toEqual({
        dateIso: null,
        sourceLabels: [],
        sourceValues: [],
        conflict: false,
      });
      expect(conflictingDates.parseStatus).toBe("partial");
      expect(Reflect.get(conflictingDates, "sourceDateEvidence")).toEqual({
        dateIso: null,
        sourceLabels: ["Utskriftsdato", "Utskriftsdato"],
        sourceValues: ["21.11.2026", "22.11.2026"],
        conflict: true,
      });
    });

    it("records contradictory source identity instead of selecting the first value", () => {
      const result = parseRogalandMortgageHtml(`
        <h1>Lånedetaljer</h1>
        <dl>
          <dt>Lånenummer</dt><dd>loan-123</dd>
          <dt>Lånenummer</dt><dd>loan-456</dd>
          <dt>Lånevaluta</dt><dd>NOK</dd>
        </dl>
      `, { maxSourceCharacters: 1_000, maxElements: 100, maxDepth: 20 });

      expect(result.identityEvidence).toEqual({
        loanReference: null,
        currencyCode: "NOK",
        loanReferenceValues: ["loan-123", "loan-456"],
        currencyValues: ["NOK"],
        conflicts: ["loan-reference-mismatch"],
      });
    });
  });

  it("does not interpret an unrelated numeric table as mortgage evidence", () => {
    const result = parseRogalandMortgageHtml(`
      <h1>Account overview</h1>
      <table>
        <tr><th>Account</th><th>Balance</th></tr>
        <tr><td>Home</td><td>100000</td></tr>
      </table>
    `, { maxSourceCharacters: 1_000, maxElements: 1_000, maxDepth: 100 });

    expect(result).toEqual({
      parseStatus: "unsupported",
      role: "unknown",
      detailsFields: [],
      identityEvidence: {
        loanReference: null,
        currencyCode: null,
        loanReferenceValues: [],
        currencyValues: [],
        conflicts: [],
      },
      sourceDateEvidence: {
        dateIso: null,
        sourceLabels: [],
        sourceValues: [],
        conflict: false,
      },
      openingBalanceEvidence: null,
      scheduleRows: [],
    });
  });

  it("keeps original principal separate from remaining principal", () => {
    const result = parseRogalandMortgageHtml(DETAILS_ONLY_HTML, {
      maxSourceCharacters: 1_000,
      maxElements: 100,
      maxDepth: 20,
    });

    expect(result).toEqual({
      parseStatus: "parsed",
      role: "details",
      identityEvidence: {
        loanReference: null,
        currencyCode: null,
        loanReferenceValues: [],
        currencyValues: [],
        conflicts: [],
      },
      sourceDateEvidence: {
        dateIso: null,
        sourceLabels: [],
        sourceValues: [],
        conflict: false,
      },
      openingBalanceEvidence: null,
      detailsFields: [
        {
          field: "originalPrincipalMinor",
          amountMinor: 10_000_000,
          sourceLabel: "Opprinnelig lånebeløp",
          sourceValue: "100 000,00",
        },
        {
          field: "remainingPrincipalMinor",
          amountMinor: 9_900_000,
          sourceLabel: "Restgjeld",
          sourceValue: "99 000,00",
        },
      ],
      scheduleRows: [],
    });
  });

  it("retains a labeled unsupported loan type as partial evidence without capturing unrelated fields", () => {
    const result = parseRogalandMortgageHtml(`
      <h1>Lånedetaljer</h1>
      <dl>
        <dt>Opprinnelig lånebeløp</dt><dd>100 000,00</dd>
        <dt>Lånetype</dt><dd>Rammelån</dd>
        <dt>Kundenummer</dt><dd>synthetic-customer-42</dd>
      </dl>
    `, { maxSourceCharacters: 1_000, maxElements: 100, maxDepth: 20 });

    expect(result.parseStatus).toBe("partial");
    expect(result.detailsFields).toContainEqual({
      field: "unsupportedProductType",
      sourceLabel: "Lånetype",
      sourceValue: "Rammelån",
    });
    expect(result.detailsFields).not.toContainEqual(expect.objectContaining({
      sourceLabel: "Kundenummer",
    }));
  });

  it("extracts semantic mortgage details from a definition list", () => {
    const result = parseRogalandMortgageHtml(`
      <h1>Lånedetaljer</h1>
      <dl>
        <dt>Opprinnelig lånebeløp</dt>
        <dd>100 000,00</dd>
      </dl>
    `, { maxSourceCharacters: 1_000, maxElements: 100, maxDepth: 20 });

    expect(result.detailsFields).toEqual([{
      field: "originalPrincipalMinor",
      amountMinor: 10_000_000,
      sourceLabel: "Opprinnelig lånebeløp",
      sourceValue: "100 000,00",
    }]);
  });

  it("preserves nominal and effective rates as separate source fields", () => {
    const result = parseRogalandMortgageHtml(`
      <h1>Lånedetaljer</h1>
      <table>
        <tr><th>Nominell rente</th><td>5,00 %</td></tr>
        <tr><th>Effektiv rente</th><td>5,25 %</td></tr>
      </table>
    `, { maxSourceCharacters: 1_000, maxElements: 100, maxDepth: 20 });

    expect(result.detailsFields).toEqual([
      {
        field: "nominalAnnualRateBasisPoints",
        valueBasisPoints: 500,
        sourceLabel: "Nominell rente",
        sourceValue: "5,00 %",
      },
      {
        field: "effectiveAnnualRateBasisPoints",
        valueBasisPoints: 525,
        sourceLabel: "Effektiv rente",
        sourceValue: "5,25 %",
      },
    ]);
  });

  it("keeps an annual summary distinct from monthly installments", () => {
    const result = parseRogalandMortgageHtml(`
      <h1>Nedbetalingsplan</h1>
      <table>
        <thead>
          <tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th></tr>
        </thead>
        <tbody>
          <tr><td>Januar 2026</td><td>1 000,00</td><td>90,00</td><td>10,00</td><td>1 100,00</td><td>99 000,00</td></tr>
          <tr><td>2026</td><td>12 000,00</td><td>1 000,00</td><td>120,00</td><td>13 120,00</td><td>88 000,00</td></tr>
        </tbody>
      </table>
    `, { maxSourceCharacters: 2_000, maxElements: 1_000, maxDepth: 100 });

    expect(result.scheduleRows.map((row) => row.period)).toEqual([
      { granularity: "monthly", year: 2026, month: 1 },
      { granularity: "annual", year: 2026 },
    ]);
  });

  it("rejects source HTML that exceeds the supplied character bound", () => {
    expect(() => parseRogalandMortgageHtml(REORDERED_SCHEDULE_HTML, {
      maxSourceCharacters: 20,
      maxElements: 1_000,
      maxDepth: 100,
    })).toThrow(RangeError);
  });

  it("rejects elements beyond the supplied structural budget", () => {
    expect(() => parseRogalandMortgageHtml(REORDERED_SCHEDULE_HTML, {
      maxSourceCharacters: 10_000,
      maxElements: 1,
      maxDepth: 100,
    })).toThrow(RangeError);
  });

  it("rejects nesting beyond the supplied structural depth", () => {
    expect(() => parseRogalandMortgageHtml(REORDERED_SCHEDULE_HTML, {
      maxSourceCharacters: 10_000,
      maxElements: 1_000,
      maxDepth: 2,
    })).toThrow(RangeError);
  });
});
