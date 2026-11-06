import { convertCurrencyAmount } from "../money/convertCurrencyAmount.js";
import type { CurrencyConversionResult } from "../money/convertCurrencyAmount.js";
import type {
  Account,
  CurrencyCode,
  ExchangeRate,
  PendingTransactionObservation,
  RecurringCommitmentScheduleOccurrence,
  Transaction,
} from "../types.js";

export type SpendableBalanceVerificationStatus =
  | "verified"
  | "stale"
  | "unverified"
  | "missing";

export interface SpendableAccountBalance {
  accountId: string;
  balanceMinor: number | null;
  balanceDateIso: string | null;
  currencyCode: CurrencyCode;
  verificationStatus: SpendableBalanceVerificationStatus;
}

export interface SpendableUntilIncomeInput {
  accounts: readonly Account[];
  selectedAccountIds: readonly string[];
  balances: readonly SpendableAccountBalance[];
  transactions?: readonly Transaction[];
  pendingObservations: readonly PendingTransactionObservation[];
  commitments: readonly RecurringCommitmentScheduleOccurrence[];
  rates: readonly ExchangeRate[];
  monthlyReferenceRateIds?: Readonly<Record<string, string>>;
  evaluatedAtIso: string;
  nextIncomeDateIso: string;
  reserveMinor: number;
}

export interface SpendableEstimateIncompleteReason {
  code:
    | "no-accounts-selected"
    | "unknown-account"
    | "missing-balance"
    | "stale-balance"
    | "unverified-balance"
    | "missing-exchange-rate"
    | "unknown-variable-commitment"
    | "missing-reconciled-transaction"
    | "invalid-reconciled-transaction";
  message: string;
  accountId?: string;
  commitmentId?: string;
  currencyCode?: CurrencyCode;
  dateIso?: string;
}

export interface SpendableSelectedAccount {
  accountId: string;
  accountName: string;
  balanceMinor: number;
  currencyCode: CurrencyCode;
  balanceDateIso: string;
  balanceNokMinor: number;
  exchangeRate: ExchangeRate | null;
  isEstimate: boolean;
}

export type SpendableCashLineItemKind =
  | "booked-transaction"
  | "pending-debit"
  | "confirmed-commitment";

export interface SpendableCashLineItem {
  id: string;
  kind: SpendableCashLineItemKind;
  dateIso: string;
  description: string;
  amountMinor: number;
  currencyCode: CurrencyCode;
  amountNokMinor: number;
  exchangeRate: ExchangeRate | null;
  isEstimate: boolean;
}

export interface SpendableNativeSubtotal {
  currencyCode: CurrencyCode;
  balanceMinor: number;
  bookedMinor: number;
  pendingMinor: number;
  commitmentsMinor: number;
}

export interface SpendableUntilIncomeResult {
  state: "complete" | "incomplete";
  evaluatedAtIso: string;
  nextIncomeDateIso: string;
  selectedAccountIds: string[];
  lowestProjectedCashNokMinor: number | null;
  spendableCashNokMinor: number | null;
  reserveNokMinor: number;
  incompleteReasons: SpendableEstimateIncompleteReason[];
  selectedAccounts: SpendableSelectedAccount[];
  lineItems: SpendableCashLineItem[];
  nativeSubtotals: SpendableNativeSubtotal[];
}

interface CashFlow {
  lineItem: SpendableCashLineItem;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value: string): boolean {
  return value.includes("T") && !Number.isNaN(Date.parse(value));
}

function addMinorUnits(total: number, amountMinor: number): number {
  const result = total + amountMinor;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Spendable cash exceeds the safe integer range.");
  }
  return result;
}

function convertAmount(
  amountMinor: number,
  currencyCode: CurrencyCode,
  dateIso: string,
  rates: readonly ExchangeRate[],
  monthlyReferenceRateId?: string
): CurrencyConversionResult {
  return convertCurrencyAmount({
    amountMinor,
    currencyCode,
    asOfDateIso: dateIso,
    rates,
    ...(monthlyReferenceRateId === undefined ? {} : { monthlyReferenceRateId }),
  });
}

function monthlyReferenceRateId(
  input: SpendableUntilIncomeInput,
  currencyCode: CurrencyCode,
  dateIso: string
): string | undefined {
  return input.monthlyReferenceRateIds?.[`${currencyCode}/${dateIso.slice(0, 7)}`] ??
    input.monthlyReferenceRateIds?.[currencyCode];
}

function emptyNativeSubtotal(currencyCode: CurrencyCode): SpendableNativeSubtotal {
  return {
    currencyCode,
    balanceMinor: 0,
    bookedMinor: 0,
    pendingMinor: 0,
    commitmentsMinor: 0,
  };
}

function addSubtotal(
  subtotals: Map<CurrencyCode, SpendableNativeSubtotal>,
  currencyCode: CurrencyCode,
  field: Exclude<keyof SpendableNativeSubtotal, "currencyCode">,
  amountMinor: number
): void {
  const subtotal = subtotals.get(currencyCode) ?? emptyNativeSubtotal(currencyCode);
  subtotal[field] = addMinorUnits(subtotal[field], amountMinor);
  subtotals.set(currencyCode, subtotal);
}

export function calculateSpendableUntilIncome(
  input: SpendableUntilIncomeInput
): SpendableUntilIncomeResult {
  if (
    !isIsoTimestamp(input.evaluatedAtIso) ||
    !isCalendarDate(input.nextIncomeDateIso) ||
    input.nextIncomeDateIso < input.evaluatedAtIso.slice(0, 10) ||
    !Number.isSafeInteger(input.reserveMinor) ||
    input.reserveMinor < 0
  ) {
    throw new Error("Spendable estimate dates or reserve are invalid.");
  }

  const incomplete = (
    reason: SpendableEstimateIncompleteReason
  ): SpendableUntilIncomeResult => ({
    state: "incomplete",
    evaluatedAtIso: input.evaluatedAtIso,
    nextIncomeDateIso: input.nextIncomeDateIso,
    selectedAccountIds: [...input.selectedAccountIds],
    lowestProjectedCashNokMinor: null,
    spendableCashNokMinor: null,
    reserveNokMinor: input.reserveMinor,
    incompleteReasons: [reason],
    selectedAccounts: [],
    lineItems: [],
    nativeSubtotals: [],
  });

  const selectedIds = new Set(input.selectedAccountIds);
  if (selectedIds.size === 0 || selectedIds.size !== input.selectedAccountIds.length) {
    return incomplete({
      code: "no-accounts-selected",
      message: "Select at least one liquid account to estimate spendable cash.",
    });
  }

  const accounts = input.accounts.filter((account) => selectedIds.has(account.id));
  if (accounts.length !== selectedIds.size) {
    return incomplete({
      code: "unknown-account",
      message: "A selected account is no longer available.",
    });
  }
  const accountsById = new Map(accounts.map((account) => [account.id, account] as const));

  const balancesByAccountId = new Map(
    input.balances.map((balance) => [balance.accountId, balance] as const)
  );
  const balanceDatesByAccountId = new Map<string, string>();
  const selectedAccounts: SpendableSelectedAccount[] = [];
  const lineItems: SpendableCashLineItem[] = [];
  const nativeSubtotals = new Map<CurrencyCode, SpendableNativeSubtotal>();
  let currentCashMinor = 0;
  for (const account of accounts) {
    const balance = balancesByAccountId.get(account.id);
    if (balance === undefined || balance.verificationStatus === "missing") {
      return incomplete({
        code: "missing-balance",
        message: `No verified balance is available for ${account.name}.`,
        accountId: account.id,
      });
    }
    if (balance.verificationStatus === "stale") {
      return incomplete({
        code: "stale-balance",
        message: `The latest balance for ${account.name} is stale.`,
        accountId: account.id,
      });
    }
    if (balance.verificationStatus === "unverified") {
      return incomplete({
        code: "unverified-balance",
        message: `The latest balance for ${account.name} is not verified.`,
        accountId: account.id,
      });
    }
    if (
      balance.balanceMinor === null ||
      balance.balanceDateIso === null ||
      !Number.isSafeInteger(balance.balanceMinor) ||
      !isCalendarDate(balance.balanceDateIso) ||
      balance.balanceDateIso > input.evaluatedAtIso.slice(0, 10) ||
      balance.currencyCode !== account.currencyCode
    ) {
      return incomplete({
        code: "unverified-balance",
        message: `The latest balance for ${account.name} is inconsistent.`,
        accountId: account.id,
      });
    }
    balanceDatesByAccountId.set(account.id, balance.balanceDateIso);
    const balanceConversion = convertAmount(
      balance.balanceMinor,
      balance.currencyCode,
      balance.balanceDateIso,
      input.rates,
      monthlyReferenceRateId(input, balance.currencyCode, balance.balanceDateIso)
    );
    if (balanceConversion.state === "incomplete") {
      return incomplete({
        code: "missing-exchange-rate",
        message: `No eligible exchange rate is available for ${balance.currencyCode} on ${balance.balanceDateIso}.`,
        accountId: account.id,
        currencyCode: balance.currencyCode,
        dateIso: balance.balanceDateIso,
      });
    }
    selectedAccounts.push({
      accountId: account.id,
      accountName: account.name,
      balanceMinor: balance.balanceMinor,
      currencyCode: balance.currencyCode,
      balanceDateIso: balance.balanceDateIso,
      balanceNokMinor: balanceConversion.nokAmountMinor,
      exchangeRate: balanceConversion.exchangeRate,
      isEstimate: balanceConversion.isEstimate,
    });
    addSubtotal(nativeSubtotals, balance.currencyCode, "balanceMinor", balance.balanceMinor);
    currentCashMinor = addMinorUnits(currentCashMinor, balanceConversion.nokAmountMinor);
  }

  const cashFlows: CashFlow[] = [];
  for (const transaction of input.transactions ?? []) {
    const account = accountsById.get(transaction.accountId);
    if (account === undefined) continue;
    const dateIso = transaction.bookedAtIso.slice(0, 10);
    const balanceDateIso = balanceDatesByAccountId.get(account.id);
    if (
      balanceDateIso === undefined ||
      dateIso <= balanceDateIso ||
      dateIso >= input.nextIncomeDateIso
    ) {
      continue;
    }
    const currencyCode = transaction.currencyCode ?? account.currencyCode;
    const amountConversion = convertAmount(
      transaction.amountMinor,
      currencyCode,
      dateIso,
      input.rates,
      monthlyReferenceRateId(input, currencyCode, dateIso)
    );
    if (amountConversion.state === "incomplete") {
      return incomplete({
        code: "missing-exchange-rate",
        message: `No eligible exchange rate is available for ${currencyCode} on ${dateIso}.`,
        accountId: account.id,
        currencyCode,
        dateIso,
      });
    }
    const lineItem: SpendableCashLineItem = {
      id: transaction.id,
      kind: "booked-transaction",
      dateIso,
      description: transaction.merchantRaw,
      amountMinor: transaction.amountMinor,
      currencyCode,
      amountNokMinor: amountConversion.nokAmountMinor,
      exchangeRate: amountConversion.exchangeRate,
      isEstimate: amountConversion.isEstimate,
    };
    lineItems.push(lineItem);
    addSubtotal(nativeSubtotals, currencyCode, "bookedMinor", transaction.amountMinor);
    if (dateIso <= input.evaluatedAtIso.slice(0, 10)) {
      currentCashMinor = addMinorUnits(currentCashMinor, amountConversion.nokAmountMinor);
    } else {
      cashFlows.push({ lineItem });
    }
  }

  for (const pending of input.pendingObservations) {
    const balanceDateIso = balanceDatesByAccountId.get(pending.accountId);
    if (
      !selectedIds.has(pending.accountId) ||
      pending.amountMinor >= 0 ||
      balanceDateIso === undefined ||
      pending.transactionDateIso <= balanceDateIso ||
      pending.transactionDateIso >= input.nextIncomeDateIso
    ) {
      continue;
    }
    if (pending.reconciledTransactionId !== undefined) {
      const reconciledTransaction = input.transactions?.find((transaction) =>
        transaction.id === pending.reconciledTransactionId
      );
      if (
        reconciledTransaction === undefined ||
        reconciledTransaction.accountId !== pending.accountId ||
        reconciledTransaction.amountMinor >= 0
      ) {
        return incomplete({
          code: reconciledTransaction === undefined
            ? "missing-reconciled-transaction"
            : "invalid-reconciled-transaction",
          message: `The matched payment for ${pending.merchantRaw} is inconsistent.`,
          accountId: pending.accountId,
          dateIso: pending.transactionDateIso,
        });
      }
      continue;
    }
    const account = accountsById.get(pending.accountId);
    if (account === undefined) continue;
    const currencyCode = pending.currencyCode ?? account.currencyCode;
    const amountConversion = convertAmount(
      pending.amountMinor,
      currencyCode,
      pending.transactionDateIso,
      input.rates,
      monthlyReferenceRateId(input, currencyCode, pending.transactionDateIso)
    );
    if (amountConversion.state === "incomplete") {
      return incomplete({
        code: "missing-exchange-rate",
        message: `No eligible exchange rate is available for ${currencyCode} on ${pending.transactionDateIso}.`,
        accountId: account.id,
        currencyCode,
        dateIso: pending.transactionDateIso,
      });
    }
    const lineItem: SpendableCashLineItem = {
      id: pending.id,
      kind: "pending-debit",
      dateIso: pending.transactionDateIso,
      description: pending.merchantRaw,
      amountMinor: pending.amountMinor,
      currencyCode,
      amountNokMinor: amountConversion.nokAmountMinor,
      exchangeRate: amountConversion.exchangeRate,
      isEstimate: amountConversion.isEstimate,
    };
    lineItems.push(lineItem);
    addSubtotal(nativeSubtotals, currencyCode, "pendingMinor", pending.amountMinor);
    if (pending.transactionDateIso <= input.evaluatedAtIso.slice(0, 10)) {
      currentCashMinor = addMinorUnits(currentCashMinor, amountConversion.nokAmountMinor);
    } else {
      cashFlows.push({ lineItem });
    }
  }

  for (const commitment of input.commitments) {
    if (
      commitment.dueDateIso < input.evaluatedAtIso.slice(0, 10) ||
      commitment.dueDateIso >= input.nextIncomeDateIso ||
      commitment.paymentStatus === "matched"
    ) {
      continue;
    }
    if (commitment.amountMinor === null) {
      return incomplete({
        code: "unknown-variable-commitment",
        message: `The amount for ${commitment.description} is not known.`,
        commitmentId: commitment.commitmentId,
        dateIso: commitment.dueDateIso,
        currencyCode: commitment.currencyCode,
      });
    }
    const amountConversion = convertAmount(
      commitment.amountMinor,
      commitment.currencyCode,
      commitment.dueDateIso,
      input.rates,
      monthlyReferenceRateId(input, commitment.currencyCode, commitment.dueDateIso)
    );
    if (amountConversion.state === "incomplete") {
      return incomplete({
        code: "missing-exchange-rate",
        message: `No eligible exchange rate is available for ${commitment.currencyCode} on ${commitment.dueDateIso}.`,
        commitmentId: commitment.commitmentId,
        currencyCode: commitment.currencyCode,
        dateIso: commitment.dueDateIso,
      });
    }
    const lineItem: SpendableCashLineItem = {
      id: commitment.commitmentId,
      kind: "confirmed-commitment",
      dateIso: commitment.dueDateIso,
      description: commitment.description,
      amountMinor: -commitment.amountMinor,
      currencyCode: commitment.currencyCode,
      amountNokMinor: -amountConversion.nokAmountMinor,
      exchangeRate: amountConversion.exchangeRate,
      isEstimate: amountConversion.isEstimate,
    };
    lineItems.push(lineItem);
    addSubtotal(
      nativeSubtotals,
      commitment.currencyCode,
      "commitmentsMinor",
      lineItem.amountMinor
    );
    if (commitment.dueDateIso <= input.evaluatedAtIso.slice(0, 10)) {
      currentCashMinor = addMinorUnits(currentCashMinor, amountConversion.nokAmountMinor * -1);
    } else {
      cashFlows.push({ lineItem });
    }
  }

  cashFlows.sort((left, right) =>
    left.lineItem.dateIso.localeCompare(right.lineItem.dateIso) ||
    left.lineItem.kind.localeCompare(right.lineItem.kind) ||
    left.lineItem.id.localeCompare(right.lineItem.id)
  );
  let lowestProjectedCashMinor = currentCashMinor;
  for (const flow of cashFlows) {
    currentCashMinor = addMinorUnits(currentCashMinor, flow.lineItem.amountNokMinor);
    lowestProjectedCashMinor = Math.min(lowestProjectedCashMinor, currentCashMinor);
  }
  lineItems.sort((left, right) =>
    left.dateIso.localeCompare(right.dateIso) ||
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id)
  );

  return {
    state: "complete",
    evaluatedAtIso: input.evaluatedAtIso,
    nextIncomeDateIso: input.nextIncomeDateIso,
    selectedAccountIds: [...input.selectedAccountIds],
    lowestProjectedCashNokMinor: lowestProjectedCashMinor,
    spendableCashNokMinor: lowestProjectedCashMinor - input.reserveMinor,
    reserveNokMinor: input.reserveMinor,
    incompleteReasons: [],
    selectedAccounts,
    lineItems,
    nativeSubtotals: [...nativeSubtotals.values()].sort((left, right) =>
      left.currencyCode.localeCompare(right.currencyCode)
    ),
  };
}
