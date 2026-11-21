import {
  defaultTreeAdapter,
  parse,
  type DefaultTreeAdapterTypes,
  type TreeAdapter,
} from "parse5";
import type {
  MortgageHtmlParseLimits,
  MortgageHtmlParseResult,
  MortgageDetailFieldEvidence,
  MortgageDocumentIdentityEvidence,
  MortgageDocumentPairingResult,
  MortgageSchedulePeriod,
  MortgageScheduleRowEvidence,
  MortgageScheduleValidationIssue,
  MortgageScheduleOpeningBalanceEvidence,
  MortgageScheduleValidationResult,
  MortgageSourceRole,
} from "../../shared/mortgageBankEvidence.js";
import { parseDecimalMinorUnits } from "../money/minorUnits.js";
import { isIsoCalendarDate } from "../date/calendarDate.js";

export const ROGALAND_MORTGAGE_PARSER_VERSION = "1" as const;

const NORWEGIAN_AMOUNT_PATTERN = /^(-?)(\d{1,3}([ .])\d{3}(?:\3\d{3})*|\d+)(?:,(\d{1,2}))?$/;
const IGNORED_TAGS = new Set(["aside", "footer", "header", "iframe", "nav", "noscript", "script", "style", "template"]);
const HEADER_ALIASES = {
  period: new Set(["termin", "periode", "maned"]),
  principal: new Set(["avdrag"]),
  interest: new Set(["renter"]),
  fee: new Set(["gebyr", "termingebyr"]),
  payment: new Set(["terminbelop", "sum terminbelop", "betalingsbelop"]),
  closingBalance: new Set(["restgjeld", "gjenstaende restgjeld", "saldo etter termin"]),
};
const ORIGINAL_PRINCIPAL_LABELS = new Set([
  "opprinnelig lanebelop",
  "opprinnelig hovedstol",
  "originalt lanebelop",
]);
const REMAINING_PRINCIPAL_LABELS = new Set([
  "restgjeld",
  "gjenstaende gjeld",
  "gjenstaende restgjeld",
]);
const NOMINAL_RATE_LABELS = new Set(["nominell rente", "nominell arlig rente"]);
const EFFECTIVE_RATE_LABELS = new Set(["effektiv rente", "effektiv arlig rente"]);
const SOURCE_AS_OF_DATE_LABELS = new Set([
  "utskriftsdato",
  "beregningsdato",
  "dato for beregning",
  "source date",
  "statement date",
  "as of date",
]);
const LOAN_REFERENCE_LABELS = new Set([
  "lanenummer",
  "lanekontonummer",
  "loan number",
  "loan reference",
]);
const CURRENCY_LABELS = new Set(["lanevaluta", "valuta", "currency"]);
const OPENING_BALANCE_LABELS = new Set([
  "inngangende saldo",
  "inngaende saldo",
  "inngangssaldo",
  "saldo for perioden",
  "saldo for forste termin",
  "opening balance",
]);
const NORWEGIAN_MONTHS = new Map([
  ["januar", 1], ["jan", 1],
  ["februar", 2], ["feb", 2],
  ["mars", 3],
  ["april", 4], ["apr", 4],
  ["mai", 5],
  ["juni", 6], ["jun", 6],
  ["juli", 7], ["jul", 7],
  ["august", 8], ["aug", 8],
  ["september", 9], ["sep", 9],
  ["oktober", 10], ["okt", 10],
  ["november", 11], ["nov", 11],
  ["desember", 12], ["des", 12],
]);

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;
type HtmlTreeAdapter = DefaultTreeAdapterTypes.DefaultTreeAdapterMap;

interface ScheduleColumns {
  period: number;
  principal: number;
  interest: number;
  fee: number | null;
  payment: number;
  closingBalance: number;
}

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function childNodes(node: HtmlNode): readonly HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
}

function collectElements(root: HtmlNode, matches: (element: HtmlElement) => boolean): HtmlElement[] {
  const found: HtmlElement[] = [];

  function visit(node: HtmlNode): void {
    if (isElement(node)) {
      if (IGNORED_TAGS.has(node.tagName)) return;
      if (matches(node)) found.push(node);
    }
    for (const child of childNodes(node)) visit(child);
  }

  visit(root);
  return found;
}

function collectTableRows(table: HtmlElement): HtmlElement[] {
  const rows: HtmlElement[] = [];

  function visit(node: HtmlNode): void {
    if (isElement(node)) {
      if (node !== table && (node.tagName === "table" || IGNORED_TAGS.has(node.tagName))) return;
      if (node.tagName === "tr") rows.push(node);
    }
    for (const child of childNodes(node)) visit(child);
  }

  for (const child of childNodes(table)) visit(child);
  return rows;
}

function assertWithinStructuralLimits(
  root: HtmlNode,
  limits: MortgageHtmlParseLimits
): void {
  let elementCount = 0;

  function visit(node: HtmlNode, depth: number): void {
    let childDepth = depth;
    if (isElement(node)) {
      elementCount += 1;
      childDepth += 1;
      if (elementCount > limits.maxElements) {
        throw new RangeError("Mortgage HTML exceeds the configured element limit.");
      }
      if (childDepth > limits.maxDepth) {
        throw new RangeError("Mortgage HTML exceeds the configured nesting limit.");
      }
    }
    for (const child of childNodes(node)) visit(child, childDepth);
  }

  visit(root, 0);
}

function createBoundedTreeAdapter(limits: MortgageHtmlParseLimits): TreeAdapter<HtmlTreeAdapter> {
  let elementCount = 0;
  return {
    ...defaultTreeAdapter,
    onElementCreated(_element, context) {
      elementCount += 1;
      if (elementCount > limits.maxElements) {
        throw new RangeError("Mortgage HTML exceeds the configured element limit.");
      }

      let depth = 1;
      let parent: HtmlTreeAdapter["parentNode"] | null = context.intendedParent;
      while (parent !== null && isElement(parent)) {
        depth += 1;
        parent = parent.parentNode;
      }
      if (depth > limits.maxDepth) {
        throw new RangeError("Mortgage HTML exceeds the configured nesting limit.");
      }
    },
  };
}

function isCell(node: HtmlNode): node is HtmlElement {
  return isElement(node) && (node.tagName === "th" || node.tagName === "td");
}

function textContent(node: HtmlNode): string {
  if ("value" in node) return node.value;
  if (isElement(node) && IGNORED_TAGS.has(node.tagName)) return "";
  return childNodes(node).map(textContent).join("");
}

function normalizeLabel(value: string): string {
  return value
    .replace(/\u200d/g, "")
    .replace(/[\u00a0\u202f]/g, " ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePeriod(value: string, groupedYear?: number): MortgageSchedulePeriod {
  const normalized = normalizeLabel(value);
  const annualMatch = /^(\d{4})$/.exec(normalized);
  if (annualMatch !== null) {
    return { granularity: "annual", year: Number(annualMatch[1]) };
  }

  const monthlyMatch = /^([a-z]+)(?:\s+(\d{4}))?$/.exec(normalized);
  if (monthlyMatch === null) return { granularity: "unknown" };
  const month = NORWEGIAN_MONTHS.get(monthlyMatch[1] ?? "");
  const year = monthlyMatch[2] === undefined ? groupedYear : Number(monthlyMatch[2]);
  if (month === undefined || year === undefined) return { granularity: "unknown" };
  return { granularity: "monthly", year, month };
}

function verifiedYearGroup(
  cells: readonly HtmlElement[],
  expectedColumnCount: number
): number | undefined {
  if (cells.length !== 1 || cells[0]?.tagName !== "th") return undefined;
  const cell = cells[0];
  const yearMatch = /^(\d{4})$/.exec(normalizeLabel(textContent(cell)));
  if (yearMatch === null) return undefined;

  const scope = cell.attrs.find((attribute) => attribute.name === "scope")?.value.toLowerCase();
  const colspanValue = cell.attrs.find((attribute) => attribute.name === "colspan")?.value;
  const colspan = colspanValue === undefined ? 1 : Number(colspanValue);
  const isVerifiedGroup = scope === "rowgroup" ||
    (Number.isSafeInteger(colspan) && colspan >= expectedColumnCount);
  return isVerifiedGroup ? Number(yearMatch[1]) : undefined;
}

function classifyRole(document: HtmlNode): MortgageSourceRole {
  const headings = collectElements(document, (element) => /^h[1-6]$/.test(element.tagName))
    .map((heading) => normalizeLabel(textContent(heading)));
  const hasScheduleHeading = headings.some((heading) =>
    /\b(nedbetalingsplan|betalingsplan|terminliste)\b/u.test(heading)
  );
  const hasDetailsHeading = headings.some((heading) =>
    /\b(lanedetaljer|lanopplysninger|detaljer om lan)\b/u.test(heading)
  );

  if (hasScheduleHeading === hasDetailsHeading) return "unknown";
  return hasScheduleHeading ? "schedule" : "details";
}

function findHeaderIndex(headers: readonly string[], aliases: ReadonlySet<string>): number | null | undefined {
  const matches = headers
    .map((header, index) => aliases.has(normalizeLabel(header)) ? index : -1)
    .filter((index) => index >= 0);
  if (matches.length > 1) return null;
  return matches[0];
}

function mapScheduleColumns(headers: readonly string[]): ScheduleColumns | null {
  const period = findHeaderIndex(headers, HEADER_ALIASES.period);
  const principal = findHeaderIndex(headers, HEADER_ALIASES.principal);
  const interest = findHeaderIndex(headers, HEADER_ALIASES.interest);
  const fee = findHeaderIndex(headers, HEADER_ALIASES.fee);
  const payment = findHeaderIndex(headers, HEADER_ALIASES.payment);
  const closingBalance = findHeaderIndex(headers, HEADER_ALIASES.closingBalance);

  if (period == null || principal == null || interest == null ||
      fee === null || payment == null || closingBalance == null) return null;

  return { period, principal, interest, fee: fee ?? null, payment, closingBalance };
}

function parseAmountCell(value: string): number | null {
  if (value.trim() === "") return null;
  const amount = parseRogalandMortgageMinorUnits(value);
  if (amount === null) throw new RangeError("Rogaland mortgage schedule contains an invalid amount.");
  return amount;
}

function parseScheduleTable(table: HtmlElement): MortgageScheduleRowEvidence[] | null {
  const rows = collectTableRows(table);
  const headerRowIndex = rows.findIndex((row) => childNodes(row).some((cell) =>
    isCell(cell) && cell.tagName === "th"
  ));
  if (headerRowIndex < 0) return null;

  const headers = childNodes(rows[headerRowIndex]!)
    .filter(isCell)
    .map((cell) => textContent(cell).trim());
  const columns = mapScheduleColumns(headers);
  if (columns === null) return null;

  const scheduleRows: MortgageScheduleRowEvidence[] = [];
  let groupedYear: number | undefined;
  for (const row of rows.slice(headerRowIndex + 1)) {
    const cells = childNodes(row).filter(isCell);
    const sourceValues = cells.map((cell) => textContent(cell).trim());
    if (sourceValues.every((value) => value === "")) continue;
    const yearGroup = verifiedYearGroup(cells, headers.length);
    if (yearGroup !== undefined) {
      groupedYear = yearGroup;
      continue;
    }
    const getValue = (column: number | null): string =>
      column === null ? "" : sourceValues[column] ?? "";
    const periodLabel = getValue(columns.period);
    scheduleRows.push({
      periodLabel,
      period: parsePeriod(periodLabel, groupedYear),
      principalMinor: parseAmountCell(getValue(columns.principal)),
      interestMinor: parseAmountCell(getValue(columns.interest)),
      feeMinor: parseAmountCell(getValue(columns.fee)),
      paymentMinor: parseAmountCell(getValue(columns.payment)),
      projectedClosingBalanceMinor: parseAmountCell(getValue(columns.closingBalance)),
      sourceHeaders: headers,
      sourceValues,
    });
  }
  return scheduleRows;
}

function detailFieldForLabel(label: string): MortgageDetailFieldEvidence["field"] | null {
  const normalized = normalizeLabel(label);
  if (ORIGINAL_PRINCIPAL_LABELS.has(normalized)) {
    return "originalPrincipalMinor";
  }
  if (REMAINING_PRINCIPAL_LABELS.has(normalized)) {
    return "remainingPrincipalMinor";
  }
  if (NOMINAL_RATE_LABELS.has(normalized)) return "nominalAnnualRateBasisPoints";
  if (EFFECTIVE_RATE_LABELS.has(normalized)) return "effectiveAnnualRateBasisPoints";
  return null;
}

function parseRateBasisPoints(value: string): number | null {
  const percentMatch = /^(.+?)\s*%$/.exec(value.trim());
  return percentMatch === null
    ? null
    : parseRogalandMortgageMinorUnits(percentMatch[1] ?? "");
}

function collectDetailsPairs(document: HtmlNode): { sourceLabel: string; sourceValue: string }[] {
  const pairs: { sourceLabel: string; sourceValue: string }[] = [];
  for (const table of collectElements(document, (element) => element.tagName === "table")) {
    for (const row of collectTableRows(table)) {
      const cells = childNodes(row).filter(isCell);
      if (cells.length < 2) continue;
      pairs.push({
        sourceLabel: textContent(cells[0]!).trim(),
        sourceValue: textContent(cells[1]!).trim(),
      });
    }
  }

  for (const list of collectElements(document, (element) => element.tagName === "dl")) {
    const children = childNodes(list);
    for (let index = 0; index < children.length; index += 1) {
      const term = children[index];
      if (term === undefined || !isElement(term) || term.tagName !== "dt") continue;
      let definitionIndex = index + 1;
      while (definitionIndex < children.length) {
        const candidate = children[definitionIndex];
        if (candidate === undefined || isElement(candidate) || textContent(candidate).trim() !== "") break;
        definitionIndex += 1;
      }
      const definition = children[definitionIndex];
      if (definition !== undefined && isElement(definition) && definition.tagName === "dd") {
        pairs.push({
          sourceLabel: textContent(term).trim(),
          sourceValue: textContent(definition).trim(),
        });
      }
    }
  }
  return pairs;
}

function parseExplicitSourceDate(value: string): string | null {
  const normalized = value.replace(/[\u00a0\u202f]/g, " ").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  const norwegian = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(normalized);
  const dateIso = iso !== null
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : norwegian === null
      ? null
      : `${norwegian[3]}-${(norwegian[2] ?? "").padStart(2, "0")}-${(norwegian[1] ?? "").padStart(2, "0")}`;
  return dateIso !== null && isIsoCalendarDate(dateIso) ? dateIso : null;
}

function parseSourceDateEvidence(document: HtmlNode): MortgageHtmlParseResult["sourceDateEvidence"] {
  const candidates = collectDetailsPairs(document)
    .filter(({ sourceLabel }) => SOURCE_AS_OF_DATE_LABELS.has(normalizeLabel(sourceLabel)));
  const dates = candidates.map(({ sourceValue }) => parseExplicitSourceDate(sourceValue));
  const distinctDates = new Set(dates.filter((date): date is string => date !== null));
  const conflict = dates.some((date) => date === null) || distinctDates.size > 1;
  return {
    dateIso: !conflict && distinctDates.size === 1 ? [...distinctDates][0] ?? null : null,
    sourceLabels: candidates.map(({ sourceLabel }) => sourceLabel),
    sourceValues: candidates.map(({ sourceValue }) => sourceValue),
    conflict,
  };
}

function normalizeLoanReference(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function parseIdentityEvidence(document: HtmlNode): MortgageDocumentIdentityEvidence {
  const loanReferenceValues: string[] = [];
  const currencyValues: string[] = [];
  for (const { sourceLabel, sourceValue } of collectDetailsPairs(document)) {
    const normalizedLabel = normalizeLabel(sourceLabel);
    if (LOAN_REFERENCE_LABELS.has(normalizedLabel) && sourceValue.trim() !== "") {
      loanReferenceValues.push(sourceValue.trim());
    } else if (CURRENCY_LABELS.has(normalizedLabel) && sourceValue.trim() !== "") {
      currencyValues.push(sourceValue.trim());
    }
  }

  const distinctReferences = new Set(loanReferenceValues.map(normalizeLoanReference));
  const distinctCurrencies = new Set(currencyValues.map((value) => value.trim().toUpperCase()));
  const conflicts: ("loan-reference-mismatch" | "currency-mismatch")[] = [];
  if (distinctReferences.size > 1) conflicts.push("loan-reference-mismatch");
  if (distinctCurrencies.size > 1) conflicts.push("currency-mismatch");

  return {
    loanReference: distinctReferences.size === 1 ? loanReferenceValues[0] ?? null : null,
    currencyCode: distinctCurrencies.size === 1 ? currencyValues[0] ?? null : null,
    loanReferenceValues,
    currencyValues,
    conflicts,
  };
}

function parseDetails(
  document: HtmlNode,
  identityEvidence: MortgageDocumentIdentityEvidence,
  sourceDateEvidence: MortgageHtmlParseResult["sourceDateEvidence"]
): MortgageHtmlParseResult {
  const detailsFields: MortgageDetailFieldEvidence[] = [];
  for (const { sourceLabel, sourceValue } of collectDetailsPairs(document)) {
    const field = detailFieldForLabel(sourceLabel);
    if (field === null) continue;
    if (field === "nominalAnnualRateBasisPoints" || field === "effectiveAnnualRateBasisPoints") {
      detailsFields.push({
        field,
        valueBasisPoints: parseRateBasisPoints(sourceValue),
        sourceLabel,
        sourceValue,
      });
    } else {
      detailsFields.push({
        field,
        amountMinor: parseAmountCell(sourceValue),
        sourceLabel,
        sourceValue,
      });
    }
  }

  if (detailsFields.length === 0) {
    return {
      parseStatus: "unsupported",
      role: "details",
      sourceDateEvidence,
      detailsFields,
      identityEvidence,
      openingBalanceEvidence: null,
      scheduleRows: [],
    };
  }

  const seenFields = new Set<MortgageDetailFieldEvidence["field"]>();
  const hasDuplicateField = detailsFields.some(({ field }) => {
    if (seenFields.has(field)) return true;
    seenFields.add(field);
    return false;
  });
  const hasUnknownValue = detailsFields.some((field) =>
    "amountMinor" in field ? field.amountMinor === null : field.valueBasisPoints === null
  );
  const parseStatus = hasDuplicateField || hasUnknownValue || identityEvidence.conflicts.length > 0 ||
      sourceDateEvidence.conflict
    ? "partial"
    : "parsed";
  return {
    parseStatus,
    role: "details",
    sourceDateEvidence,
    detailsFields,
    identityEvidence,
    openingBalanceEvidence: null,
    scheduleRows: [],
  };
}

function parseOpeningBalanceEvidence(
  document: HtmlNode,
  firstPeriod: MortgageSchedulePeriod | undefined
): { evidence: MortgageScheduleOpeningBalanceEvidence | null; partial: boolean } {
  const candidates = collectDetailsPairs(document)
    .filter(({ sourceLabel }) => OPENING_BALANCE_LABELS.has(normalizeLabel(sourceLabel)));
  if (candidates.length === 0) return { evidence: null, partial: false };
  if (candidates.length !== 1 || firstPeriod === undefined || firstPeriod.granularity === "unknown") {
    return { evidence: null, partial: true };
  }

  const candidate = candidates[0]!;
  const amountMinor = parseRogalandMortgageMinorUnits(candidate.sourceValue);
  if (amountMinor === null || amountMinor < 0) return { evidence: null, partial: true };
  return {
    evidence: {
      amountMinor,
      beforePeriod: firstPeriod,
      sourceKind: "lender-opening-balance",
      sourceLabel: candidate.sourceLabel,
      sourceValue: candidate.sourceValue,
    },
    partial: false,
  };
}

export function parseRogalandMortgageHtml(
  source: string,
  limits: MortgageHtmlParseLimits
): MortgageHtmlParseResult {
  if ([limits.maxSourceCharacters, limits.maxElements, limits.maxDepth]
    .some((limit) => !Number.isSafeInteger(limit) || limit <= 0)) {
    throw new RangeError("Mortgage HTML limits must be positive safe integers.");
  }
  if (source.length > limits.maxSourceCharacters) {
    throw new RangeError("Mortgage HTML exceeds the configured character limit.");
  }

  const document = parse(source, { treeAdapter: createBoundedTreeAdapter(limits) });
  assertWithinStructuralLimits(document, limits);
  const role = classifyRole(document);
  const identityEvidence = parseIdentityEvidence(document);
  const sourceDateEvidence = parseSourceDateEvidence(document);
  if (role === "details") return parseDetails(document, identityEvidence, sourceDateEvidence);
  if (role !== "schedule") {
    return {
      parseStatus: "unsupported",
      role,
      sourceDateEvidence,
      detailsFields: [],
      identityEvidence,
      openingBalanceEvidence: null,
      scheduleRows: [],
    };
  }

  const tables = collectElements(document, (element) => element.tagName === "table");
  const scheduleRows = tables.flatMap((table) => parseScheduleTable(table) ?? []);
  if (scheduleRows.length === 0) {
    return {
      parseStatus: "unsupported",
      role,
      sourceDateEvidence,
      detailsFields: [],
      identityEvidence,
      openingBalanceEvidence: null,
      scheduleRows: [],
    };
  }

  const openingBalance = parseOpeningBalanceEvidence(document, scheduleRows[0]?.period);
  const parseStatus = openingBalance.partial ||
    identityEvidence.conflicts.length > 0 ||
    sourceDateEvidence.conflict ||
    scheduleRows.some((row) =>
    row.periodLabel === "" ||
    row.period.granularity === "unknown" ||
    row.principalMinor === null ||
    row.interestMinor === null ||
    row.feeMinor === null ||
    row.paymentMinor === null ||
    row.projectedClosingBalanceMinor === null
  ) ? "partial" : "parsed";
  return {
    parseStatus,
    role,
    sourceDateEvidence,
    detailsFields: [],
    identityEvidence,
    openingBalanceEvidence: openingBalance.evidence,
    scheduleRows,
  };
}

export function assessMortgageDocumentPairing(
  details: MortgageDocumentIdentityEvidence,
  schedule: MortgageDocumentIdentityEvidence,
  explicitlyConfirmed: boolean
): MortgageDocumentPairingResult {
  if (details.conflicts.includes("loan-reference-mismatch") ||
      schedule.conflicts.includes("loan-reference-mismatch")) {
    return { status: "conflict", reason: "loan-reference-mismatch" };
  }
  if (details.conflicts.includes("currency-mismatch") ||
      schedule.conflicts.includes("currency-mismatch")) {
    return { status: "conflict", reason: "currency-mismatch" };
  }
  const normalizeReference = (value: string | null): string | null => {
    const normalized = value === null ? "" : normalizeLoanReference(value);
    return normalized === "" ? null : normalized;
  };
  const normalizeCurrency = (value: string | null): string | null | "invalid" => {
    const normalized = value?.trim().toUpperCase() ?? "";
    if (normalized === "") return null;
    return /^[A-Z]{3}$/.test(normalized) ? normalized : "invalid";
  };

  const detailsReference = normalizeReference(details.loanReference);
  const scheduleReference = normalizeReference(schedule.loanReference);
  const detailsCurrency = normalizeCurrency(details.currencyCode);
  const scheduleCurrency = normalizeCurrency(schedule.currencyCode);

  if (detailsCurrency === "invalid" || scheduleCurrency === "invalid") {
    return { status: "conflict", reason: "invalid-currency" };
  }
  if (detailsReference !== null && scheduleReference !== null &&
      detailsReference !== scheduleReference) {
    return { status: "conflict", reason: "loan-reference-mismatch" };
  }
  if (detailsCurrency !== null && scheduleCurrency !== null &&
      detailsCurrency !== scheduleCurrency) {
    return { status: "conflict", reason: "currency-mismatch" };
  }
  if (detailsReference !== null && scheduleReference !== null &&
      detailsCurrency !== null && scheduleCurrency !== null) {
    return { status: "verified", verification: "matching-identifiers" };
  }
  return explicitlyConfirmed
    ? { status: "confirmed", verification: "explicit-user-attachment" }
    : { status: "confirmation-required" };
}

export function parseRogalandMortgageMinorUnits(_source: string): number | null {
  const normalized = _source
    .replace(/\u200d/g, "")
    .replace(/[\u00a0\u202f]/g, " ")
    .trim();
  const match = NORWEGIAN_AMOUNT_PATTERN.exec(normalized);
  if (match === null) return null;

  const sign = match[1] ?? "";
  const whole = match[2]?.replace(/[ .]/g, "");
  if (whole === undefined) return null;
  const fraction = match[4] ?? "";
  const decimalAmount = `${sign}${whole}${fraction === "" ? "" : `.${fraction}`}`;
  return parseDecimalMinorUnits(decimalAmount);
}

function periodIndex(period: Exclude<MortgageSchedulePeriod, { granularity: "unknown" }>): number {
  return period.granularity === "monthly"
    ? period.year * 12 + period.month
    : period.year;
}

export function validateRogalandMortgageSchedule(
  document: MortgageHtmlParseResult
): MortgageScheduleValidationResult {
  if (document.role !== "schedule" || document.scheduleRows.length === 0 ||
      document.parseStatus === "unsupported") {
    throw new RangeError("A supported mortgage schedule is required for validation.");
  }
  const rows = document.scheduleRows;
  const issues: MortgageScheduleValidationIssue[] = [];
  let hasInvalidIssue = false;
  let previousMonthly: { period: Extract<MortgageSchedulePeriod, { granularity: "monthly" }>; balanceMinor: number | null } | null = null;
  let previousAnnual: { period: Extract<MortgageSchedulePeriod, { granularity: "annual" }>; balanceMinor: number | null } | null = null;
  let firstGranularity: "monthly" | "annual" | null = null;

  function addIssue(
    code: MortgageScheduleValidationIssue["code"],
    rowIndex: number,
    invalid = false
  ): void {
    issues.push({ code, rowIndex });
    hasInvalidIssue ||= invalid;
  }

  const openingEvidence = document.openingBalanceEvidence;
  const firstPeriod = rows[0]?.period;
  let openingBalance: number | undefined;
  if (openingEvidence !== null) {
    if (!Number.isSafeInteger(openingEvidence.amountMinor) || openingEvidence.amountMinor < 0) {
      throw new RangeError("The opening mortgage balance must be a non-negative safe integer.");
    }
    const sourceLabel = normalizeLabel(openingEvidence.sourceLabel);
    if (openingEvidence.sourceKind !== "lender-opening-balance" ||
        !OPENING_BALANCE_LABELS.has(sourceLabel) ||
        parseRogalandMortgageMinorUnits(openingEvidence.sourceValue) !== openingEvidence.amountMinor) {
      addIssue("opening-balance-unsupported-source", 0);
    } else if (firstPeriod === undefined ||
        firstPeriod.granularity === "unknown" ||
        firstPeriod.granularity !== openingEvidence.beforePeriod.granularity ||
        periodIndex(firstPeriod) !== periodIndex(openingEvidence.beforePeriod)) {
      addIssue("opening-balance-period-mismatch", 0, true);
    } else {
      openingBalance = openingEvidence.amountMinor;
    }
  }

  for (const [rowIndex, row] of rows.entries()) {
    const principal = row.principalMinor;
    const interest = row.interestMinor;
    const fee = row.feeMinor;
    const payment = row.paymentMinor;
    const closingBalance = row.projectedClosingBalanceMinor;
    const amounts = [principal, interest, fee, payment, closingBalance];
    if (amounts.some((amount) => amount !== null && !Number.isSafeInteger(amount))) {
      throw new RangeError("Mortgage schedule amounts must be safe integer minor units.");
    }

    if (row.period.granularity === "unknown" || row.periodLabel === "" ||
        amounts.some((amount) => amount === null)) {
      addIssue("incomplete-row", rowIndex);
    }
    if (amounts.some((amount) => amount !== null && amount < 0)) {
      addIssue("unsupported-sign", rowIndex);
    }

    if (principal !== null && interest !== null && fee !== null && payment !== null) {
      const expectedPayment = BigInt(principal) + BigInt(interest) + BigInt(fee);
      if (expectedPayment !== BigInt(payment)) addIssue("payment-total-mismatch", rowIndex, true);
    }

    if (row.period.granularity === "unknown") continue;
    if (firstGranularity === null) firstGranularity = row.period.granularity;
    else if (firstGranularity !== row.period.granularity) addIssue("mixed-period-granularity", rowIndex);

    let openingBalanceForRow: number | null | undefined;
    const previousPeriod = row.period.granularity === "monthly"
      ? previousMonthly
      : previousAnnual;
    if (previousPeriod === null) {
      if (rowIndex === 0 && openingBalance !== undefined) {
        openingBalanceForRow = openingBalance;
      } else if (rowIndex !== 0 || openingEvidence === null) {
        addIssue("opening-balance-unknown", rowIndex);
      }
    } else {
      const previousIndex = periodIndex(previousPeriod.period);
      const currentIndex = periodIndex(row.period);
      if (currentIndex === previousIndex) {
        addIssue("duplicate-period", rowIndex, true);
      } else if (currentIndex < previousIndex) {
        addIssue("out-of-order-period", rowIndex, true);
      } else if (currentIndex > previousIndex + 1) {
        addIssue("period-gap", rowIndex);
      } else {
        openingBalanceForRow = previousPeriod.balanceMinor;
      }
    }

    if (openingBalanceForRow !== null && openingBalanceForRow !== undefined &&
        principal !== null && closingBalance !== null) {
      const expectedClosingBalance = BigInt(openingBalanceForRow) - BigInt(principal);
      const actualClosingBalance = BigInt(closingBalance);
      if (actualClosingBalance > BigInt(openingBalanceForRow)) {
        addIssue("unreconciled-balance-increase", rowIndex);
      } else if (actualClosingBalance !== expectedClosingBalance) {
        addIssue("closing-balance-mismatch", rowIndex, true);
      }
    }

    if (row.period.granularity === "monthly") {
      previousMonthly = { period: row.period, balanceMinor: closingBalance };
    } else {
      previousAnnual = { period: row.period, balanceMinor: closingBalance };
    }
  }

  return {
    status: hasInvalidIssue ? "invalid" : issues.length > 0 ? "partial" : "valid",
    issues,
  };
}
