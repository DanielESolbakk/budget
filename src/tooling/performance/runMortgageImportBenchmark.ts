import { performance } from "node:perf_hooks";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { createLocalLedgerDatabase } from "../../app/backup/localLedgerSqlite.js";
import { createMortgageBankImportService } from "../../app/mortgageBankImportService.js";
import {
  PROVISIONAL_MORTGAGE_HTML_MAX_BYTES,
  PROVISIONAL_MORTGAGE_HTML_PARSE_LIMITS,
} from "../../shared/mortgageBankEvidence.js";

export type MortgageImportBenchmarkScenario = "three-year" | "thirty-year" | "near-limit";

export interface MortgageImportBenchmarkOptions {
  readonly scenario: MortgageImportBenchmarkScenario;
  readonly iterationCount?: number;
  readonly physicalHost?: {
    readonly hypervisorName: string;
    readonly cpuModel: string;
    readonly totalMemoryBytes: number;
  };
}

export interface MortgageImportBenchmarkResult {
  readonly scenario: MortgageImportBenchmarkScenario;
  readonly iterationCount: number;
  readonly limitsAreProvisional: true;
  readonly evidenceStatus: "profile-matched-proxy" | "preliminary";
  readonly parserLimits: {
    readonly maxBytesPerFile: number;
    readonly maxSourceCharacters: number;
    readonly maxElements: number;
    readonly maxDepth: number;
  };
  readonly fixture: {
    readonly schedulePeriodCount: number;
    readonly scheduleElementTagCount: number;
    readonly nestingWrapperCount: number;
    readonly detailsBytes: number;
    readonly scheduleBytes: number;
  };
  readonly measurements: {
    readonly previewMedianMs: number;
    readonly confirmationMedianMs: number;
    readonly persistenceMedianMs: number;
    readonly endToEndMedianMs: number;
    readonly peakProcessRssKiB: number;
    readonly scheduleValidationStatus: "valid";
    readonly persistedEvidenceVersionCount: number;
  };
  readonly cancellation: {
    readonly cancellationObserved: true;
    readonly persistedEvidenceVersionCount: 0;
    readonly sourceOnlyLoanCount: 0;
  } | null;
  readonly targetProfile: {
    readonly name: "Windows 11 VM proxy";
    readonly minimumWindowsBuild: number;
    readonly logicalProcessorCount: 2;
    readonly assignedMemoryBytes: number;
  };
  readonly observedVm: {
    readonly platform: string;
    readonly osRelease: string;
    readonly osVersion: string;
    readonly architecture: string;
    readonly logicalProcessorCount: number;
    readonly cpuModel: string | null;
    readonly totalMemoryBytes: number;
    readonly matchesProxyProfile: boolean;
  };
  readonly physicalHost: {
    readonly hypervisorName: string | null;
    readonly cpuModel: string | null;
    readonly totalMemoryBytes: number | null;
    readonly metadataComplete: boolean;
  };
}

interface IterationResult {
  readonly previewMs: number;
  readonly confirmationMs: number;
  readonly persistenceMs: number;
  readonly scheduleValidationStatus: "valid";
  readonly persistedEvidenceVersionCount: number;
}

const MONTH_NAMES = [
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
const PRINCIPAL_PER_PERIOD_MINOR = 100_000;
const INTEREST_PER_PERIOD_MINOR = 100;
const GIB = 1024 ** 3;
const MIN_PROXY_MEMORY_BYTES = 3.8 * GIB;
const MAX_PROXY_MEMORY_BYTES = 4.2 * GIB;
const MINIMUM_WINDOWS_BUILD = 26_200;
const NEAR_LIMIT_MARGIN_BYTES = 1024;
const NEAR_ELEMENT_LIMIT_PADDING_COUNT = 3_300;
const NEAR_DEPTH_LIMIT_WRAPPER_COUNT = 24;
const HOUSEHOLD_ID = "mortgage-benchmark-household";

function formatMinorUnits(amountMinor: number): string {
  const wholeUnits = Math.floor(amountMinor / 100);
  const fractionalUnits = String(amountMinor % 100).padStart(2, "0");
  const groupedWholeUnits = String(wholeUnits).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${groupedWholeUnits},${fractionalUnits}`;
}

function buildDetailsHtml(principalMinor: number): string {
  return `
    <h1>Lånedetaljer</h1>
    <dl>
      <dt>Lånenummer</dt><dd>synthetic-mortgage-benchmark</dd>
      <dt>Lånevaluta</dt><dd>NOK</dd>
      <dt>Opprinnelig lånebeløp</dt><dd>${formatMinorUnits(principalMinor)}</dd>
      <dt>Restgjeld</dt><dd>${formatMinorUnits(principalMinor)}</dd>
    </dl>
  `;
}

function buildScheduleHtml(periodCount: number): string {
  const openingBalanceMinor = periodCount * PRINCIPAL_PER_PERIOD_MINOR;
  const rows = Array.from({ length: periodCount }, (_, index) => {
    const monthIndex = index % MONTH_NAMES.length;
    const year = 2026 + Math.floor(index / MONTH_NAMES.length);
    const monthName = MONTH_NAMES[monthIndex];
    if (monthName === undefined) throw new Error("Mortgage benchmark month was not found.");
    const periodLabel = `${monthName} ${year}`;
    const principalMinor = PRINCIPAL_PER_PERIOD_MINOR;
    const interestMinor = INTEREST_PER_PERIOD_MINOR;
    const closingBalanceMinor = openingBalanceMinor - (index + 1) * principalMinor;
    return `<tr><td>${periodLabel}</td><td>${formatMinorUnits(principalMinor)}</td><td>${formatMinorUnits(interestMinor)}</td><td>0,00</td><td>${formatMinorUnits(principalMinor + interestMinor)}</td><td>${formatMinorUnits(closingBalanceMinor)}</td></tr>`;
  }).join("");

  return `
    <h1>Nedbetalingsplan</h1>
    <dl>
      <dt>Inngående saldo</dt><dd>${formatMinorUnits(openingBalanceMinor)}</dd>
      <dt>Utskriftsdato</dt><dd>31.12.2025</dd>
      <dt>Lånenummer</dt><dd>synthetic-mortgage-benchmark</dd>
      <dt>Lånevaluta</dt><dd>NOK</dd>
    </dl>
    <table>
      <thead><tr><th>Termin</th><th>Avdrag</th><th>Renter</th><th>Gebyr</th><th>Terminbeløp</th><th>Restgjeld</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function addNearLimitStructure(source: string): string {
  const nestedOpeningTags = "<div>".repeat(NEAR_DEPTH_LIMIT_WRAPPER_COUNT);
  const nestedClosingTags = "</div>".repeat(NEAR_DEPTH_LIMIT_WRAPPER_COUNT);
  const elementPadding = `<div>${"<span></span>".repeat(NEAR_ELEMENT_LIMIT_PADDING_COUNT)}</div>`;
  return `${nestedOpeningTags}${source}${elementPadding}${nestedClosingTags}`;
}

function countSourceElements(source: string): number {
  return (source.match(/<[a-z][\w:-]*\b/gi) ?? []).length;
}

function padToNearLimit(source: string): string {
  const sourceBytes = Buffer.byteLength(source, "utf8");
  const targetBytes = PROVISIONAL_MORTGAGE_HTML_MAX_BYTES - NEAR_LIMIT_MARGIN_BYTES;
  const paddingBytes = targetBytes - sourceBytes - "<!--".length - "-->".length;
  if (paddingBytes < 0) {
    throw new RangeError("Synthetic mortgage schedule exceeds the near-limit fixture size.");
  }
  return `${source}<!--${" ".repeat(paddingBytes)}-->`;
}

function scenarioPeriodCount(scenario: MortgageImportBenchmarkScenario): number {
  switch (scenario) {
    case "three-year":
      return 36;
    case "thirty-year":
    case "near-limit":
      return 360;
    default:
      throw new RangeError("Mortgage benchmark scenario is unsupported.");
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);
  const middleValue = sorted[middleIndex];
  if (middleValue === undefined) throw new Error("Mortgage benchmark has no measurements.");
  if (sorted.length % 2 === 1) return middleValue;
  const lowerMiddleValue = sorted[middleIndex - 1];
  if (lowerMiddleValue === undefined) throw new Error("Mortgage benchmark median is invalid.");
  return (lowerMiddleValue + middleValue) / 2;
}

function observeHostProfile(): MortgageImportBenchmarkResult["observedVm"] {
  const cpus = os.cpus();
  const totalMemoryBytes = os.totalmem();
  const buildNumber = Number.parseInt(os.release().split(".").at(-1) ?? "", 10);
  const matchesProxyProfile = process.platform === "win32" &&
    process.arch === "x64" &&
    buildNumber >= MINIMUM_WINDOWS_BUILD &&
    cpus.length === 2 &&
    totalMemoryBytes >= MIN_PROXY_MEMORY_BYTES &&
    totalMemoryBytes <= MAX_PROXY_MEMORY_BYTES;
  return {
    platform: process.platform,
    osRelease: os.release(),
    osVersion: os.version(),
    architecture: process.arch,
    logicalProcessorCount: cpus.length,
    cpuModel: cpus[0]?.model ?? null,
    totalMemoryBytes,
    matchesProxyProfile,
  };
}

async function runIteration(
  directory: string,
  iterationIndex: number,
  detailsPath: string,
  schedulePath: string
): Promise<IterationResult> {
  const database = createLocalLedgerDatabase({
    dbPath: join(directory, `mortgage-benchmark-${iterationIndex}.sqlite`),
    seedData: {
      household: {
        id: HOUSEHOLD_ID,
        name: "Synthetic mortgage benchmark",
        createdAtIso: "2026-01-01T00:00:00.000Z",
      },
      accounts: [{
        id: "mortgage-benchmark-account",
        householdId: HOUSEHOLD_ID,
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
    const previewStartedAt = performance.now();
    const preview = await service.previewFiles({
      filePaths: [detailsPath, schedulePath],
      target: { kind: "new-source-only", label: "Synthetic mortgage benchmark" },
      attachmentConfirmed: false,
    });
    const previewMs = performance.now() - previewStartedAt;

    if (preview.reviewState !== "attachment-confirmation-required") {
      throw new Error(`Unexpected mortgage benchmark preview state: ${preview.reviewState}`);
    }

    const confirmationStartedAt = performance.now();
    const confirmedPreview = service.confirmAttachmentPreview(preview.previewId);
    const confirmationMs = performance.now() - confirmationStartedAt;
    if (confirmedPreview.reviewState !== "paired-schedule-checks-passed") {
      throw new Error(`Unexpected confirmed benchmark state: ${confirmedPreview.reviewState}`);
    }

    const persistenceStartedAt = performance.now();
    const evidence = service.acceptPreview(confirmedPreview.previewId);
    const persistenceMs = performance.now() - persistenceStartedAt;
    const evidenceVersions = database.listMortgageEvidenceVersions(HOUSEHOLD_ID, evidence.loanId);
    if (evidence.scheduleValidation?.status !== "valid" ||
        evidenceVersions.length !== 1 ||
        evidenceVersions[0]?.id !== evidence.id) {
      throw new Error("Mortgage benchmark did not persist one valid evidence version.");
    }

    return {
      previewMs,
      confirmationMs,
      persistenceMs,
      scheduleValidationStatus: "valid",
      persistedEvidenceVersionCount: evidenceVersions.length,
    };
  } finally {
    database.close();
  }
}

async function verifyNearLimitCancellation(
  directory: string,
  detailsPath: string,
  schedulePath: string
): Promise<NonNullable<MortgageImportBenchmarkResult["cancellation"]>> {
  const database = createLocalLedgerDatabase({
    dbPath: join(directory, "mortgage-benchmark-cancellation.sqlite"),
    seedData: {
      household: {
        id: HOUSEHOLD_ID,
        name: "Synthetic mortgage benchmark",
        createdAtIso: "2026-01-01T00:00:00.000Z",
      },
      accounts: [{
        id: "mortgage-benchmark-cancellation-account",
        householdId: HOUSEHOLD_ID,
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
    const requestId = "mortgage-benchmark-cancellation";
    service.beginPreviewRequest(requestId);
    const pendingPreview = service.previewFiles({
      requestId,
      filePaths: [detailsPath, schedulePath],
      target: { kind: "new-source-only", label: "Synthetic mortgage benchmark" },
      attachmentConfirmed: false,
    });
    if (!service.cancelPreview(requestId)) {
      throw new Error("Mortgage benchmark cancellation did not reach the active preview.");
    }

    try {
      await pendingPreview;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "AbortError") throw error;
      const persistedEvidenceVersionCount = service.listEvidenceSummaries().length;
      const sourceOnlyLoanCount = database.listSourceOnlyLoanRecords(HOUSEHOLD_ID).length;
      if (persistedEvidenceVersionCount !== 0 || sourceOnlyLoanCount !== 0) {
        throw new Error("Cancelled mortgage benchmark preview persisted a loan or evidence version.");
      }
      return {
        cancellationObserved: true,
        persistedEvidenceVersionCount: 0,
        sourceOnlyLoanCount: 0,
      };
    }

    throw new Error("Mortgage benchmark preview completed after cancellation.");
  } finally {
    database.close();
  }
}

export async function runMortgageImportBenchmark(
  options: MortgageImportBenchmarkOptions
): Promise<MortgageImportBenchmarkResult> {
  const iterationCount = options.iterationCount ?? 5;
  if (!Number.isSafeInteger(iterationCount) || iterationCount <= 0) {
    throw new RangeError("Mortgage benchmark iterationCount must be a positive safe integer.");
  }

  const schedulePeriodCountValue = scenarioPeriodCount(options.scenario);
  const openingBalanceMinor = schedulePeriodCountValue * PRINCIPAL_PER_PERIOD_MINOR;
  const detailsHtml = buildDetailsHtml(openingBalanceMinor);
  const generatedSchedule = buildScheduleHtml(schedulePeriodCountValue);
  const nestedSchedule = options.scenario === "near-limit"
    ? addNearLimitStructure(generatedSchedule)
    : generatedSchedule;
  const scheduleHtml = options.scenario === "near-limit"
    ? padToNearLimit(nestedSchedule)
    : nestedSchedule;
  const directory = mkdtempSync(join(os.tmpdir(), "budget-mortgage-import-benchmark-"));
  const detailsPath = join(directory, "synthetic-details.html");
  const schedulePath = join(directory, "synthetic-schedule.html");
  writeFileSync(detailsPath, detailsHtml, "utf8");
  writeFileSync(schedulePath, scheduleHtml, "utf8");

  try {
    const iterations: IterationResult[] = [];
    for (let index = 0; index < iterationCount; index += 1) {
      iterations.push(await runIteration(directory, index, detailsPath, schedulePath));
    }
    const cancellation = options.scenario === "near-limit"
      ? await verifyNearLimitCancellation(directory, detailsPath, schedulePath)
      : null;

    const observedVm = observeHostProfile();
    const physicalHost = options.physicalHost === undefined
      ? {
          hypervisorName: null,
          cpuModel: null,
          totalMemoryBytes: null,
          metadataComplete: false,
        }
      : {
          ...options.physicalHost,
          metadataComplete: options.physicalHost.hypervisorName.trim() !== "" &&
            options.physicalHost.cpuModel.trim() !== "" &&
            Number.isSafeInteger(options.physicalHost.totalMemoryBytes) &&
            options.physicalHost.totalMemoryBytes > 0,
        };
    if (options.physicalHost !== undefined && !physicalHost.metadataComplete) {
      throw new RangeError("Mortgage benchmark physical host metadata must be complete and valid.");
    }
    const previewMeasurements = iterations.map((iteration) => iteration.previewMs);
    const confirmationMeasurements = iterations.map((iteration) => iteration.confirmationMs);
    const persistenceMeasurements = iterations.map((iteration) => iteration.persistenceMs);
    const totalMeasurements = iterations.map((iteration) => (
      iteration.previewMs + iteration.confirmationMs + iteration.persistenceMs
    ));
    const lastIteration = iterations.at(-1);
    if (lastIteration === undefined) throw new Error("Mortgage benchmark produced no result.");

    return {
      scenario: options.scenario,
      iterationCount,
      limitsAreProvisional: true,
      evidenceStatus: observedVm.matchesProxyProfile
        ? "profile-matched-proxy"
        : "preliminary",
      parserLimits: {
        maxBytesPerFile: PROVISIONAL_MORTGAGE_HTML_MAX_BYTES,
        ...PROVISIONAL_MORTGAGE_HTML_PARSE_LIMITS,
      },
      fixture: {
        schedulePeriodCount: schedulePeriodCountValue,
        scheduleElementTagCount: countSourceElements(scheduleHtml),
        nestingWrapperCount: options.scenario === "near-limit"
          ? NEAR_DEPTH_LIMIT_WRAPPER_COUNT
          : 0,
        detailsBytes: Buffer.byteLength(detailsHtml, "utf8"),
        scheduleBytes: Buffer.byteLength(scheduleHtml, "utf8"),
      },
      measurements: {
        previewMedianMs: median(previewMeasurements),
        confirmationMedianMs: median(confirmationMeasurements),
        persistenceMedianMs: median(persistenceMeasurements),
        endToEndMedianMs: median(totalMeasurements),
        peakProcessRssKiB: process.resourceUsage().maxRSS,
        scheduleValidationStatus: lastIteration.scheduleValidationStatus,
        persistedEvidenceVersionCount: lastIteration.persistedEvidenceVersionCount,
      },
      cancellation,
      targetProfile: {
        name: "Windows 11 VM proxy",
        minimumWindowsBuild: MINIMUM_WINDOWS_BUILD,
        logicalProcessorCount: 2,
        assignedMemoryBytes: 4 * GIB,
      },
      observedVm,
      physicalHost,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
