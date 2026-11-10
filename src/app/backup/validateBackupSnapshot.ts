import type { BackupSnapshot } from "../../domain/backup/snapshotContract.js";
import { SNAPSHOT_VERSION } from "../../domain/backup/snapshotContract.js";
import { defaultHouseholdShare } from "../../domain/householdShareValidation.js";
import {
  validateReportingPeriodRule,
  type ReportingPeriodRule,
  DEFAULT_REPORTING_PERIOD_RULE,
} from "../../shared/applicationPreferences.js";
import {
  isRecord,
  validateHousehold,
  validateAccounts,
  validateTransactions,
  validatePendingObservations,
  validateImportJobs,
  validateTargets,
  validateAccountStatementCoveragePeriods,
  validateAccountBalanceCheckpoints,
  validateExchangeRates,
  validateProperties,
  validatePropertyValuations,
  validateHoldings,
  validateHoldingValuations,
  validateLoanRecords,
  validateLoanBalanceSnapshots,
  validateRecurringCommitments,
  validateRecurringCommitmentPaymentLinks,
  validateRecurringCommitmentDecisions,
  validateMerchantCategoryRules,
} from "./snapshotRecordValidation.js";

const coverageCollections = ["accountStatementCoveragePeriods", "accountBalanceCheckpoints", "exchangeRates"];
const propertyCollections = ["properties", "propertyValuations"];
const loanCollections = ["loanRecords", "loanBalanceSnapshots"];
const holdingCollections = ["holdings", "holdingValuations"];
const recurringCollections = ["recurringCommitments", "recurringCommitmentPaymentLinks", "recurringCommitmentDecisions"];

const snapshotCapabilities = {
  "1": { requiredCollections: [], requiresHouseholdShares: false },
  "2": { requiredCollections: [], requiresHouseholdShares: false },
  "3": { requiredCollections: coverageCollections, requiresHouseholdShares: false },
  "4": { requiredCollections: [...coverageCollections, ...propertyCollections], requiresHouseholdShares: false },
  "5": { requiredCollections: [...coverageCollections, ...propertyCollections], requiresHouseholdShares: false },
  "6": { requiredCollections: [...coverageCollections, ...propertyCollections, ...loanCollections], requiresHouseholdShares: false },
  "7": { requiredCollections: [...coverageCollections, ...propertyCollections, ...loanCollections, ...holdingCollections], requiresHouseholdShares: false },
  "8": { requiredCollections: [...coverageCollections, ...propertyCollections, ...loanCollections, ...holdingCollections], requiresHouseholdShares: false },
  "9": { requiredCollections: [...coverageCollections, ...propertyCollections, ...loanCollections, ...holdingCollections], requiresHouseholdShares: true },
  "10": { requiredCollections: [...coverageCollections, ...propertyCollections, ...loanCollections,
    ...holdingCollections, ...recurringCollections], requiresHouseholdShares: true },
  [SNAPSHOT_VERSION]: { requiredCollections: [...coverageCollections, ...propertyCollections, ...loanCollections,
    ...holdingCollections, ...recurringCollections], requiresHouseholdShares: true },
};

function isSupportedSnapshotVersion(value: unknown): value is keyof typeof snapshotCapabilities {
  return typeof value === "string" && Object.hasOwn(snapshotCapabilities, value);
}

export function validateBackupSnapshot(value: unknown, snapshotPath: string): BackupSnapshot {
  if (!isRecord(value) || !isRecord(value.metadata)) {
    throw new Error(`Invalid snapshot structure: ${snapshotPath}`);
  }

  const metadata = value.metadata;
  if (!isSupportedSnapshotVersion(metadata.version)) {
    throw new Error(
      `Unsupported snapshot version: ${String(metadata.version ?? "unknown")}. Expected: ${SNAPSHOT_VERSION}`
    );
  }
  const capabilities = snapshotCapabilities[metadata.version];
  if (metadata.version === SNAPSHOT_VERSION && value.reportingPeriodRule === undefined) {
    throw new Error(`Invalid snapshot reportingPeriodRule: ${snapshotPath}`);
  }
  let reportingPeriodRule: ReportingPeriodRule;
  try {
    reportingPeriodRule = value.reportingPeriodRule === undefined
      ? DEFAULT_REPORTING_PERIOD_RULE
      : validateReportingPeriodRule(value.reportingPeriodRule);
  } catch (error) {
    throw new Error(`Invalid snapshot reportingPeriodRule: ${snapshotPath}`, { cause: error });
  }

  if (
    typeof metadata.createdAtIso !== "string" ||
    Number.isNaN(Date.parse(metadata.createdAtIso))
  ) {
    throw new Error(`Invalid snapshot creation timestamp: ${snapshotPath}`);
  }

  const collections = ["accounts", "transactions", "importJobs", "monthlyCategoryTargets"] as const;
  for (const collectionName of collections) {
    if (!Array.isArray(value[collectionName])) {
      throw new Error(`Invalid snapshot ${collectionName} collection: ${snapshotPath}`);
    }
  }

  const accounts = value.accounts as unknown[];
  const transactions = value.transactions as unknown[];
  const importJobs = value.importJobs as unknown[];
  const monthlyCategoryTargets = value.monthlyCategoryTargets as unknown[];
  const pendingObservations = value.pendingObservations === undefined
    ? []
    : value.pendingObservations;
  if (!Array.isArray(pendingObservations)) {
    throw new Error(`Invalid snapshot pendingObservations collection: ${snapshotPath}`);
  }
  const accountStatementCoveragePeriods = value.accountStatementCoveragePeriods === undefined
    ? []
    : value.accountStatementCoveragePeriods;
  const accountBalanceCheckpoints = value.accountBalanceCheckpoints === undefined
    ? []
    : value.accountBalanceCheckpoints;
  const exchangeRates = value.exchangeRates === undefined ? [] : value.exchangeRates;
  const properties = value.properties === undefined ? [] : value.properties;
  const propertyValuations = value.propertyValuations === undefined
    ? []
    : value.propertyValuations;
  const holdings = value.holdings === undefined ? [] : value.holdings;
  const holdingValuations = value.holdingValuations === undefined
    ? []
    : value.holdingValuations;
  const loanRecords = value.loanRecords === undefined ? [] : value.loanRecords;
  const loanBalanceSnapshots = value.loanBalanceSnapshots === undefined
    ? []
    : value.loanBalanceSnapshots;
  const recurringCommitments = value.recurringCommitments === undefined
    ? []
    : value.recurringCommitments;
  const recurringCommitmentPaymentLinks = value.recurringCommitmentPaymentLinks === undefined
    ? []
    : value.recurringCommitmentPaymentLinks;
  const recurringCommitmentDecisions = value.recurringCommitmentDecisions === undefined
    ? []
    : value.recurringCommitmentDecisions;
  if (
    !Array.isArray(accountStatementCoveragePeriods) ||
    !Array.isArray(accountBalanceCheckpoints) ||
    !Array.isArray(exchangeRates) ||
    !Array.isArray(properties) ||
    !Array.isArray(propertyValuations) ||
    !Array.isArray(holdings) ||
    !Array.isArray(holdingValuations) ||
    !Array.isArray(loanRecords) ||
    !Array.isArray(loanBalanceSnapshots) ||
    !Array.isArray(recurringCommitments) ||
    !Array.isArray(recurringCommitmentPaymentLinks) ||
    !Array.isArray(recurringCommitmentDecisions) ||
    capabilities.requiredCollections.some(collection => value[collection] === undefined)
  ) {
    throw new Error(
      `Invalid snapshot registry, account coverage, exchange-rate, or holding collections: ${snapshotPath}`
    );
  }

  if (
    !Number.isInteger(metadata.transactionCount) ||
    metadata.transactionCount !== transactions.length
  ) {
    throw new Error(`Snapshot transaction count does not match its transaction collection: ${snapshotPath}`);
  }

  if (!Number.isInteger(metadata.accountCount) || metadata.accountCount !== accounts.length) {
    throw new Error(`Snapshot account count does not match its account collection: ${snapshotPath}`);
  }

  validateHousehold(value.household, snapshotPath);
  validateImportJobs(importJobs, value.household.id, snapshotPath);
  validateAccounts(accounts, value.household.id, snapshotPath);
  const accountIds = new Set(accounts.map((account) => account.id));
  const accountCurrencies = new Map(
    accounts.map((account) => [account.id, account.currencyCode] as const)
  );
  const { requiresHouseholdShares } = capabilities;
  validateProperties(properties, value.household.id, snapshotPath, requiresHouseholdShares);
  validatePropertyValuations(
    propertyValuations,
    new Set(properties.map((property) => property.id)),
    snapshotPath
  );
  validateHoldings(holdings, value.household.id, snapshotPath);
  validateHoldingValuations(
    holdingValuations,
    new Set(holdings.map((holding) => holding.id)),
    snapshotPath
  );
  validateLoanRecords(
    loanRecords,
    value.household.id,
    new Set(properties.map((property) => property.id)),
    snapshotPath,
    requiresHouseholdShares
  );
  validateLoanBalanceSnapshots(loanBalanceSnapshots, loanRecords, snapshotPath);
  validateTargets(monthlyCategoryTargets, snapshotPath);
  if (metadata.version !== "1") {
    validateMerchantCategoryRules(value.merchantCategoryRules, snapshotPath);
  }
  validateTransactions(
    transactions,
    value.household.id,
    accountIds,
    new Set(importJobs.map((importJob) => importJob.id)),
    snapshotPath
  );
  validatePendingObservations(
    pendingObservations,
    value.household.id,
    accountIds,
    new Set(importJobs.map((importJob) => importJob.id)),
    new Set(transactions.map((transaction) => transaction.id)),
    snapshotPath
  );
  validateRecurringCommitments(recurringCommitments, value.household.id, snapshotPath);
  validateRecurringCommitmentPaymentLinks(
    recurringCommitmentPaymentLinks,
    recurringCommitments,
    transactions,
    pendingObservations,
    accounts,
    snapshotPath
  );
  validateRecurringCommitmentDecisions(
    recurringCommitmentDecisions,
    recurringCommitments,
    snapshotPath
  );
  validateAccountStatementCoveragePeriods(
    accountStatementCoveragePeriods,
    accountCurrencies,
    new Set(importJobs.map((importJob) => importJob.id)),
    snapshotPath
  );
  validateAccountBalanceCheckpoints(
    accountBalanceCheckpoints,
    accountCurrencies,
    snapshotPath
  );
  validateExchangeRates(exchangeRates, snapshotPath);

  return {
    ...(value as unknown as BackupSnapshot),
    accountStatementCoveragePeriods,
    accountBalanceCheckpoints,
    exchangeRates,
    properties: properties.map((property) => ({
      ...property,
      ownershipShareBasisPoints: defaultHouseholdShare(property.ownershipShareBasisPoints, "Property ownership share"),
    })),
    propertyValuations,
    holdings,
    holdingValuations,
    loanRecords: loanRecords.map((loan) => ({
      ...loan,
      responsibilityShareBasisPoints: defaultHouseholdShare(loan.responsibilityShareBasisPoints, "Loan responsibility share"),
    })),
    loanBalanceSnapshots,
    recurringCommitments,
    recurringCommitmentPaymentLinks,
    recurringCommitmentDecisions,
    reportingPeriodRule,
  };
}
