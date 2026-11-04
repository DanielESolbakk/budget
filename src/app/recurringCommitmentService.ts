import { randomUUID } from "node:crypto";
import { convertCurrencyAmount } from "../domain/money/convertCurrencyAmount.js";
import {
  generateRecurringCommitmentOccurrences,
  getRecurringCommitmentPriceChange,
  validateRecurringCommitmentInput,
} from "../domain/forecast/recurringCommitments.js";
import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import type {
  ExchangeRate,
  PendingTransactionObservation,
  RecurringCommitment,
  RecurringCommitmentDecision,
  RecurringCommitmentInput,
  RecurringCommitmentPaymentLink,
  RecurringCommitmentPaymentCandidate,
  RecurringCommitmentPaymentLinkInput,
  RecurringCommitmentPaymentObservation,
  RecurringCommitmentSchedule,
  RecurringCommitmentScheduleOccurrence,
  Transaction,
} from "../domain/types.js";

export interface RecurringCommitmentServiceOptions {
  createId?: () => string;
  now?: () => Date;
}

export interface RecurringCommitmentService {
  list: () => RecurringCommitment[];
  create: (input: RecurringCommitmentInput) => RecurringCommitment;
  update: (commitmentId: string, input: RecurringCommitmentInput) => RecurringCommitment;
  confirm: (commitmentId: string) => RecurringCommitment;
  pause: (commitmentId: string) => RecurringCommitment;
  resume: (commitmentId: string) => RecurringCommitment;
  end: (commitmentId: string) => RecurringCommitment;
  linkPayment: (input: RecurringCommitmentPaymentLinkInput) => void;
  getSchedule: (evaluatedAtIso?: string) => RecurringCommitmentSchedule;
  confirmPriceChange: (commitmentId: string, newAmountMinor: number) => RecurringCommitment;
}

interface ResolvedPayment {
  candidate: RecurringCommitmentPaymentCandidate;
  observation: RecurringCommitmentPaymentObservation;
  transactionId?: string;
  pendingObservationId?: string;
}

function isIsoTimestamp(value: string): boolean {
  return value.includes("T") && !Number.isNaN(Date.parse(value));
}

function calendarDate(value: string): string {
  if (!isIsoTimestamp(value)) {
    throw new Error("Recurring commitment evaluation time must be an ISO timestamp.");
  }
  return value.slice(0, 10);
}

function monthStart(yearMonth: string, offset: number): string {
  const [yearText, monthText] = yearMonth.split("-");
  const absoluteMonth = Number(yearText) * 12 + Number(monthText) - 1 + offset;
  const year = Math.floor(absoluteMonth / 12);
  const month = (absoluteMonth % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

function monthEnd(yearMonth: string): string {
  const [yearText, monthText] = yearMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
}

function scheduleRange(
  evaluatedDateIso: string
): { recentStartDateIso: string; endDateIso: string } {
  const yearMonth = evaluatedDateIso.slice(0, 7);
  return {
    recentStartDateIso: monthStart(yearMonth, -3),
    endDateIso: monthEnd(monthStart(yearMonth, 3).slice(0, 7)),
  };
}

function resolvePayment(
  transactionId: string | undefined,
  pendingObservationId: string | undefined,
  transactions: readonly Transaction[],
  pendingObservations: readonly PendingTransactionObservation[],
  accountCurrencies: ReadonlyMap<string, string>
): ResolvedPayment | undefined {
  if (transactionId !== undefined) {
    const transaction = transactions.find((candidate) => candidate.id === transactionId);
    if (transaction === undefined || transaction.amountMinor >= 0) return undefined;
    const currencyCode = transaction.currencyCode ?? accountCurrencies.get(transaction.accountId);
    if (currencyCode === undefined) return undefined;
    return {
      candidate: {
        id: transaction.id,
        sourceType: "transaction",
        dateIso: transaction.bookedAtIso.slice(0, 10),
        amountMinor: transaction.amountMinor,
        currencyCode,
        description: transaction.merchantRaw,
      },
      observation: {
        id: transaction.id,
        occurrenceDateIso: transaction.bookedAtIso.slice(0, 10),
        amountMinor: Math.abs(transaction.amountMinor),
        currencyCode,
        description: transaction.merchantRaw,
        status: "confirmed",
      },
      transactionId: transaction.id,
    };
  }
  if (pendingObservationId === undefined) return undefined;
  const pending = pendingObservations.find((candidate) => candidate.id === pendingObservationId);
  if (pending === undefined) return undefined;
  if (pending.amountMinor >= 0) return undefined;
  const currencyCode = pending.currencyCode ?? accountCurrencies.get(pending.accountId);
  if (currencyCode === undefined) return undefined;
  if (pending.reconciledTransactionId !== undefined) {
    const transaction = transactions.find((candidate) =>
      candidate.id === pending.reconciledTransactionId
    );
    if (transaction === undefined || transaction.amountMinor >= 0) return undefined;
    return {
      candidate: {
        id: pending.id,
        sourceType: "pending",
        dateIso: pending.transactionDateIso,
        amountMinor: pending.amountMinor,
        currencyCode,
        description: pending.merchantRaw,
      },
      observation: {
        id: pending.id,
        occurrenceDateIso: transaction.bookedAtIso.slice(0, 10),
        amountMinor: Math.abs(transaction.amountMinor),
        currencyCode,
        description: transaction.merchantRaw,
        status: "confirmed",
      },
      transactionId: transaction.id,
      pendingObservationId: pending.id,
    };
  }
  return {
    candidate: {
      id: pending.id,
      sourceType: "pending",
      dateIso: pending.transactionDateIso,
      amountMinor: pending.amountMinor,
      currencyCode,
      description: pending.merchantRaw,
    },
    observation: {
      id: pending.id,
      occurrenceDateIso: pending.transactionDateIso,
      amountMinor: Math.abs(pending.amountMinor),
      currencyCode,
      description: pending.merchantRaw,
      status: "pending",
    },
    pendingObservationId: pending.id,
  };
}

function convertOccurrence(
  occurrence: ReturnType<typeof generateRecurringCommitmentOccurrences>[number],
  description: string,
  dueStatus: RecurringCommitmentScheduleOccurrence["dueStatus"],
  paymentStatus: RecurringCommitmentScheduleOccurrence["paymentStatus"],
  rates: readonly ExchangeRate[],
  resolvedPayment: ResolvedPayment | undefined
): RecurringCommitmentScheduleOccurrence {
  const conversion = occurrence.amountMinor === null
    ? undefined
    : convertCurrencyAmount({
        amountMinor: occurrence.amountMinor,
        currencyCode: occurrence.currencyCode,
        asOfDateIso: occurrence.dueDateIso,
        rates,
      });
  const nokAmountMinor = conversion?.nokAmountMinor ?? null;
  return {
    ...occurrence,
    description,
    dueStatus,
    paymentStatus,
    nativeAmountMinor: occurrence.amountMinor,
    nativeCurrencyCode: occurrence.currencyCode,
    nokAmountMinor,
    exchangeRate: conversion?.exchangeRate ?? null,
    conversionStatus: nokAmountMinor === null ? "incomplete" : "converted",
    ...(resolvedPayment?.transactionId === undefined
      ? {}
      : { linkedTransactionId: resolvedPayment.transactionId }),
    ...(resolvedPayment?.pendingObservationId === undefined
      ? {}
      : { linkedPendingObservationId: resolvedPayment.pendingObservationId }),
    ...(resolvedPayment === undefined
      ? {}
      : { linkedPaymentDateIso: resolvedPayment.observation.occurrenceDateIso }),
    ...(resolvedPayment === undefined
      ? {}
      : { observedPaymentAmountMinor: resolvedPayment.observation.amountMinor }),
    isEstimate: occurrence.isEstimate || (conversion?.isEstimate ?? false),
  };
}

export function createRecurringCommitmentService(
  database: LocalLedgerDatabase,
  options: RecurringCommitmentServiceOptions = {}
): RecurringCommitmentService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  function currentHouseholdId(): string {
    const metadata = database.loadRuntimeMetadata();
    if (metadata === null) {
      throw new Error("Local household is not available for recurring commitments.");
    }
    return metadata.household.id;
  }

  function findCommitment(commitmentId: string): RecurringCommitment {
    if (commitmentId.trim().length === 0) {
      throw new Error("Recurring commitment id must be non-empty.");
    }
    const commitment = database.listRecurringCommitments(currentHouseholdId())
      .find((candidate) => candidate.id === commitmentId);
    if (commitment === undefined) {
      throw new Error(`Recurring commitment not found: ${commitmentId}`);
    }
    return commitment;
  }

  function writeDecision(
    commitment: RecurringCommitment,
    decisionType: RecurringCommitmentDecision["decisionType"],
    amounts: Pick<RecurringCommitmentDecision, "previousAmountMinor" | "newAmountMinor"> = {}
  ): void {
    const timestamp = now().toISOString();
    const updated = { ...commitment, updatedAtIso: timestamp };
    const decision: RecurringCommitmentDecision = {
      id: createId(),
      commitmentId: commitment.id,
      decisionType,
      decidedAtIso: timestamp,
      ...amounts,
    };
    database.updateRecurringCommitmentAndDecision(updated, decision);
  }

  function list(): RecurringCommitment[] {
    return database.listRecurringCommitments(currentHouseholdId());
  }

  function create(input: RecurringCommitmentInput): RecurringCommitment {
    const validated = validateRecurringCommitmentInput(input);
    const timestamp = now().toISOString();
    const commitment: RecurringCommitment = {
      ...validated,
      id: createId(),
      householdId: currentHouseholdId(),
      status: "suggested",
      createdAtIso: timestamp,
      updatedAtIso: timestamp,
    };
    database.createRecurringCommitment(commitment);
    return commitment;
  }

  function update(
    commitmentId: string,
    input: RecurringCommitmentInput
  ): RecurringCommitment {
    const existing = findCommitment(commitmentId);
    if (existing.status === "ended") {
      throw new Error("An ended recurring commitment cannot be edited.");
    }
    const validated = validateRecurringCommitmentInput(input);
    if (
      existing.status !== "suggested" &&
      (validated.amountMinor !== existing.amountMinor || validated.isVariable !== existing.isVariable)
    ) {
      throw new Error("Confirm a price-change review before changing a confirmed commitment amount.");
    }
    const updated: RecurringCommitment = {
      ...existing,
      ...validated,
      updatedAtIso: now().toISOString(),
    };
    const changed = Object.keys(validated).some((key) =>
      validated[key as keyof RecurringCommitmentInput] !==
      existing[key as keyof RecurringCommitment]
    );
    if (changed) writeDecision(updated, "edited");
    else database.updateRecurringCommitment(updated);
    return updated;
  }

  function transition(
    commitmentId: string,
    expectedStatus: RecurringCommitment["status"],
    status: RecurringCommitment["status"],
    decisionType: RecurringCommitmentDecision["decisionType"]
  ): RecurringCommitment {
    const commitment = findCommitment(commitmentId);
    if (commitment.status !== expectedStatus) {
      throw new Error(`Recurring commitment must be ${expectedStatus} before it can be ${status}.`);
    }
    const updated = { ...commitment, status, updatedAtIso: now().toISOString() };
    writeDecision(updated, decisionType);
    return updated;
  }

  function confirm(commitmentId: string): RecurringCommitment {
    return transition(commitmentId, "suggested", "active", "confirmed");
  }

  function pause(commitmentId: string): RecurringCommitment {
    return transition(commitmentId, "active", "paused", "paused");
  }

  function resume(commitmentId: string): RecurringCommitment {
    return transition(commitmentId, "paused", "active", "resumed");
  }

  function end(commitmentId: string): RecurringCommitment {
    const commitment = findCommitment(commitmentId);
    if (commitment.status === "ended") {
      throw new Error("Recurring commitment is already ended.");
    }
    const updated = { ...commitment, status: "ended" as const, updatedAtIso: now().toISOString() };
    writeDecision(updated, "ended");
    return updated;
  }

  function linkPayment(input: RecurringCommitmentPaymentLinkInput): RecurringCommitmentPaymentLink {
    const commitment = findCommitment(input.commitmentId);
    if (commitment.status !== "active") {
      throw new Error("Only an active recurring commitment can be matched to a payment.");
    }
    if ((input.transactionId === undefined) === (input.pendingObservationId === undefined)) {
      throw new Error("A recurring commitment link must identify exactly one payment.");
    }
    const [occurrence] = generateRecurringCommitmentOccurrences(
      commitment,
      input.occurrenceDateIso,
      input.occurrenceDateIso
    );
    if (occurrence === undefined) {
      throw new Error("Payment date is not an active due date for this recurring commitment.");
    }
    const snapshot = database.loadLedgerSnapshotData();
    const paymentAmountMinor = input.transactionId !== undefined
      ? snapshot.transactions.find((transaction) => transaction.id === input.transactionId)?.amountMinor
      : snapshot.pendingObservations?.find((observation) =>
          observation.id === input.pendingObservationId
        )?.amountMinor;
    if (paymentAmountMinor === undefined) {
      throw new Error("Recurring commitment payment was not found.");
    }
    if (paymentAmountMinor >= 0) {
      throw new Error("Recurring commitment must be linked to an outgoing payment.");
    }
    const link: RecurringCommitmentPaymentLink = {
      ...input,
      id: createId(),
      linkedAtIso: now().toISOString(),
    };
    database.createRecurringCommitmentPaymentLink(link);
    return link;
  }

  function getSchedule(evaluatedAtIso = now().toISOString()): RecurringCommitmentSchedule {
    const evaluatedDateIso = calendarDate(evaluatedAtIso);
    const { recentStartDateIso, endDateIso } = scheduleRange(evaluatedDateIso);
    const snapshot = database.loadLedgerSnapshotData();
    const householdId = currentHouseholdId();
    const commitments = database.listRecurringCommitments(householdId);
    const activeCommitments = commitments.filter((commitment) => commitment.status === "active");
    const candidateStartDateIso = activeCommitments
      .map((commitment) => commitment.firstDueDateIso)
      .sort((left, right) => left.localeCompare(right))[0] ?? recentStartDateIso;
    const activeCurrencyCodes = new Set(
      activeCommitments.map((commitment) => commitment.currencyCode)
    );
    const paymentLinks = database.listRecurringCommitmentPaymentLinks(householdId);
    const rates = database.listExchangeRates();
    const accountCurrencies = new Map(
      snapshot.accounts.map((account) => [account.id, account.currencyCode] as const)
    );
    const occurrences: RecurringCommitmentScheduleOccurrence[] = [];
    const priceChanges: RecurringCommitmentSchedule["priceChanges"] = [];
    const linkedPaymentIds = new Set<string>();

    for (const commitment of commitments) {
      const commitmentLinks = paymentLinks.filter((link) => link.commitmentId === commitment.id);
      const paymentObservations: RecurringCommitmentPaymentObservation[] = [];
      for (const link of commitmentLinks) {
        const payment = resolvePayment(
          link.transactionId,
          link.pendingObservationId,
          snapshot.transactions,
          snapshot.pendingObservations ?? [],
          accountCurrencies
        );
        if (payment === undefined) continue;
        if (payment.transactionId !== undefined) linkedPaymentIds.add(payment.transactionId);
        if (payment.pendingObservationId !== undefined) linkedPaymentIds.add(payment.pendingObservationId);
        paymentObservations.push(payment.observation);

        const pending = payment.pendingObservationId === undefined
          ? undefined
          : snapshot.pendingObservations?.find((candidate) =>
              candidate.id === payment.pendingObservationId
            );
        if (pending?.reconciledTransactionId !== undefined) {
          linkedPaymentIds.add(pending.reconciledTransactionId);
        }
      }

      const priceChange = commitment.status === "ended"
        ? null
        : getRecurringCommitmentPriceChange(paymentObservations, commitment);
      if (priceChange !== null) {
        priceChanges.push({
          commitmentId: commitment.id,
          description: commitment.description,
          ...priceChange,
        });
      }

      const occurrenceStartDateIso = commitment.firstDueDateIso > endDateIso
        ? endDateIso
        : commitment.firstDueDateIso;
      for (const occurrence of generateRecurringCommitmentOccurrences(
        commitment,
        occurrenceStartDateIso,
        endDateIso
      )) {
        const paymentLink = commitmentLinks.find((link) =>
          link.occurrenceDateIso === occurrence.dueDateIso
        );
        const payment = paymentLink === undefined
          ? undefined
          : resolvePayment(
              paymentLink.transactionId,
              paymentLink.pendingObservationId,
              snapshot.transactions,
              snapshot.pendingObservations ?? [],
              accountCurrencies
            );
        const dueStatus = occurrence.dueDateIso < evaluatedDateIso
          ? "past-due"
          : occurrence.dueDateIso === evaluatedDateIso
            ? "due"
            : "upcoming";
        occurrences.push(convertOccurrence(
          occurrence,
          commitment.description,
          dueStatus,
          payment === undefined ? "unmatched" : "matched",
          rates,
          payment
        ));
      }
    }

    const paymentCandidates: RecurringCommitmentPaymentCandidate[] = [];
    for (const transaction of snapshot.transactions) {
      const dateIso = transaction.bookedAtIso.slice(0, 10);
      if (
        transaction.amountMinor >= 0 ||
        dateIso < candidateStartDateIso ||
        dateIso > endDateIso ||
        linkedPaymentIds.has(transaction.id)
      ) {
        continue;
      }
      const currencyCode = transaction.currencyCode ?? accountCurrencies.get(transaction.accountId);
      if (currencyCode === undefined || !activeCurrencyCodes.has(currencyCode)) continue;
      paymentCandidates.push({
        id: transaction.id,
        sourceType: "transaction",
        dateIso,
        amountMinor: transaction.amountMinor,
        currencyCode,
        description: transaction.merchantRaw,
      });
    }
    for (const observation of snapshot.pendingObservations ?? []) {
      if (
        observation.amountMinor >= 0 ||
        observation.reconciledTransactionId !== undefined ||
        observation.transactionDateIso < candidateStartDateIso ||
        observation.transactionDateIso > endDateIso ||
        linkedPaymentIds.has(observation.id)
      ) {
        continue;
      }
      const currencyCode = observation.currencyCode ?? accountCurrencies.get(observation.accountId);
      if (currencyCode === undefined || !activeCurrencyCodes.has(currencyCode)) continue;
      paymentCandidates.push({
        id: observation.id,
        sourceType: "pending",
        dateIso: observation.transactionDateIso,
        amountMinor: observation.amountMinor,
        currencyCode,
        description: observation.merchantRaw,
      });
    }
    paymentCandidates.sort((left, right) =>
      left.dateIso.localeCompare(right.dateIso) ||
      left.description.localeCompare(right.description) ||
      left.id.localeCompare(right.id)
    );
    occurrences.sort((left, right) =>
      left.dueDateIso.localeCompare(right.dueDateIso) ||
      left.description.localeCompare(right.description) ||
      left.commitmentId.localeCompare(right.commitmentId)
    );

    return {
      evaluatedAtIso,
      commitments,
      occurrences,
      paymentCandidates,
      priceChanges,
    };
  }

  function confirmPriceChange(
    commitmentId: string,
    newAmountMinor: number
  ): RecurringCommitment {
    const commitment = findCommitment(commitmentId);
    if (commitment.status === "ended") {
      throw new Error("An ended recurring commitment cannot be edited.");
    }
    if (!Number.isSafeInteger(newAmountMinor) || newAmountMinor <= 0) {
      throw new Error("Confirmed recurring commitment amount must be a positive safe integer.");
    }
    const suggestion = getSchedule().priceChanges.find((candidate) =>
      candidate.commitmentId === commitmentId
    );
    if (suggestion === undefined || suggestion.observedAmountMinor !== newAmountMinor) {
      throw new Error("Confirm the currently observed payment amount from the price-change review.");
    }
    const updated: RecurringCommitment = {
      ...commitment,
      amountMinor: newAmountMinor,
      updatedAtIso: now().toISOString(),
    };
    database.updateRecurringCommitmentAndDecision(updated, {
      id: createId(),
      commitmentId,
      decisionType: "amount-change-confirmed",
      decidedAtIso: updated.updatedAtIso,
      previousAmountMinor: commitment.amountMinor,
      newAmountMinor,
    });
    return updated;
  }

  return {
    list,
    create,
    update,
    confirm,
    pause,
    resume,
    end,
    linkPayment,
    getSchedule,
    confirmPriceChange,
  };
}
