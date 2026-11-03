import { isCurrencyCode } from "../types.js";
import type {
  RecurringCommitment,
  RecurringCommitmentInput,
  RecurringCommitmentOccurrence,
  RecurringCommitmentPaymentObservation,
  RecurringCommitmentPriceChange,
} from "../types.js";

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function dueDateAtIndex(
  firstDueDateIso: string,
  cadence: RecurringCommitment["cadence"],
  index: number
): string {
  const [yearText, monthText, dayText] = firstDueDateIso.split("-");
  const anchorYear = Number(yearText);
  const anchorMonth = Number(monthText);
  const anchorDay = Number(dayText);
  const monthOffset = cadence === "monthly" ? index : index * 12;
  const absoluteMonth = anchorYear * 12 + anchorMonth - 1 + monthOffset;
  const year = Math.floor(absoluteMonth / 12);
  const month = (absoluteMonth % 12) + 1;
  const day = Math.min(anchorDay, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function validateRecurringCommitmentInput(input: unknown): RecurringCommitmentInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Recurring commitment input must be an object.");
  }
  const record = input as Record<string, unknown>;
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const currencyCode = record.currencyCode;
  const amountMinor = record.amountMinor;
  const isVariable = record.isVariable;
  const cadence = record.cadence;
  const firstDueDateIso = record.firstDueDateIso;
  const activeFromIso = record.activeFromIso;
  const activeUntilIso = record.activeUntilIso;
  const normalizedAmountMinor = typeof amountMinor === "number" ? amountMinor : null;

  if (description.length === 0) {
    throw new Error("Recurring commitment description must be non-empty.");
  }
  if (!isCurrencyCode(currencyCode)) {
    throw new Error("Recurring commitment currencyCode must be a three-letter uppercase currency code.");
  }
  if (typeof isVariable !== "boolean") {
    throw new Error("Recurring commitment isVariable must be a boolean.");
  }
  if (amountMinor !== null &&
      (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor <= 0)) {
    throw new Error("Recurring commitment amount must be a positive safe integer or null.");
  }
  if (!isVariable && amountMinor === null) {
    throw new Error("A fixed recurring commitment requires an amount.");
  }
  if (cadence !== "monthly" && cadence !== "annual") {
    throw new Error("Recurring commitment cadence must be monthly or annual.");
  }
  if (!isCalendarDate(firstDueDateIso) || !isCalendarDate(activeFromIso)) {
    throw new Error("Recurring commitment due and active dates must be valid calendar dates.");
  }
  if (activeUntilIso !== undefined && !isCalendarDate(activeUntilIso)) {
    throw new Error("Recurring commitment activeUntilIso must be a valid calendar date.");
  }
  if (firstDueDateIso < activeFromIso ||
      (activeUntilIso !== undefined && firstDueDateIso > activeUntilIso) ||
      (activeUntilIso !== undefined && activeUntilIso < activeFromIso)) {
    throw new Error("Recurring commitment active period must contain its first due date.");
  }

  return {
    description,
    currencyCode,
    amountMinor: normalizedAmountMinor,
    isVariable,
    cadence,
    firstDueDateIso,
    activeFromIso,
    ...(activeUntilIso === undefined ? {} : { activeUntilIso }),
  };
}

export function generateRecurringCommitmentOccurrences(
  commitment: RecurringCommitment,
  fromDateIso: string,
  throughDateIso: string
): RecurringCommitmentOccurrence[] {
  if (!isCalendarDate(fromDateIso) || !isCalendarDate(throughDateIso) || fromDateIso > throughDateIso) {
    throw new Error("Recurring commitment schedule date range is invalid.");
  }
  const validated = validateRecurringCommitmentInput(commitment);
  if (commitment.status !== "active") return [];

  const occurrences: RecurringCommitmentOccurrence[] = [];
  for (let index = 0; ; index++) {
    const dueDateIso = dueDateAtIndex(validated.firstDueDateIso, validated.cadence, index);
    if (dueDateIso > throughDateIso) break;
    if (dueDateIso < fromDateIso ||
        dueDateIso < validated.activeFromIso ||
        (validated.activeUntilIso !== undefined && dueDateIso > validated.activeUntilIso)) {
      continue;
    }
    occurrences.push({
      commitmentId: commitment.id,
      dueDateIso,
      amountMinor: validated.amountMinor,
      currencyCode: validated.currencyCode,
      isEstimate: validated.isVariable,
    });
  }
  return occurrences;
}

export function getRecurringCommitmentPriceChange(
  payments: readonly RecurringCommitmentPaymentObservation[],
  commitment: RecurringCommitment
): RecurringCommitmentPriceChange | null {
  const confirmedPayments = payments
    .filter((payment) =>
      payment.status === "confirmed" &&
      payment.currencyCode === commitment.currencyCode &&
      Number.isSafeInteger(payment.amountMinor)
    )
    .slice()
    .sort((left, right) =>
      left.occurrenceDateIso.localeCompare(right.occurrenceDateIso) ||
      left.id.localeCompare(right.id)
    );
  if (confirmedPayments.length < 2) return null;

  const previous = confirmedPayments[confirmedPayments.length - 2]!;
  const current = confirmedPayments[confirmedPayments.length - 1]!;
  if (previous.amountMinor === current.amountMinor ||
      current.amountMinor === commitment.amountMinor) {
    return null;
  }
  return {
    previousAmountMinor: previous.amountMinor,
    observedAmountMinor: current.amountMinor,
    differenceMinor: current.amountMinor - previous.amountMinor,
    currencyCode: current.currencyCode,
  };
}
