import { describe, expect, it } from "vitest";
import * as dashboardApi from "../../src/app/dashboardApi.js";

const commitment = {
  id: "commitment-monthly",
  householdId: "household-recurring",
  description: "Synthetic household bill",
  currencyCode: "NOK",
  amountMinor: 12_900,
  isVariable: false,
  cadence: "monthly" as const,
  firstDueDateIso: "2026-01-31",
  activeFromIso: "2026-01-01",
  status: "active" as const,
  createdAtIso: "2026-01-01T00:00:00.000Z",
  updatedAtIso: "2026-01-01T00:00:00.000Z",
};

function scheduleGenerator() {
  const generate = Reflect.get(dashboardApi, "generateRecurringCommitmentOccurrences");
  expect(typeof generate).toBe("function");
  return generate;
}

function priceChangeDetector() {
  const detect = Reflect.get(dashboardApi, "getRecurringCommitmentPriceChange");
  expect(typeof detect).toBe("function");
  return detect;
}

function commitmentInputValidator() {
  const validate = Reflect.get(dashboardApi, "validateRecurringCommitmentInput");
  expect(typeof validate).toBe("function");
  return validate;
}

describe("recurring commitment schedule", () => {
  it("rejects a fixed commitment with a negative minor-unit amount", () => {
    const validate = commitmentInputValidator();

    expect(() => validate({
      ...commitment,
      amountMinor: -1,
    })).toThrow(/amount/i);
  });

  it("accepts an explicitly variable commitment without a known amount", () => {
    expect(commitmentInputValidator()({
      ...commitment,
      amountMinor: null,
      isVariable: true,
    })).toMatchObject({
      amountMinor: null,
      isVariable: true,
    });
  });

  it("rejects an active period that ends before it starts", () => {
    const validate = commitmentInputValidator();

    expect(() => validate({
      ...commitment,
      activeFromIso: "2026-06-01",
      activeUntilIso: "2026-05-31",
    })).toThrow(/active period/i);
  });

  it("keeps a monthly due date anchored to the original day after shorter months", () => {
    const occurrences = scheduleGenerator()(
      commitment,
      "2026-01-01",
      "2026-04-30"
    );

    expect(occurrences.map(({ dueDateIso }) => dueDateIso)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("returns a January 31 anchor to March 31 after leap-year February", () => {
    const occurrences = scheduleGenerator()(
      {
        ...commitment,
        firstDueDateIso: "2024-01-31",
        activeFromIso: "2024-01-01",
      },
      "2024-01-01",
      "2024-03-31"
    );

    expect(occurrences.map(({ dueDateIso }) => dueDateIso)).toEqual([
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
    ]);
  });

  it("uses the original annual anchor when a scheduled year has no payment", () => {
    const occurrences = scheduleGenerator()(
      {
        ...commitment,
        id: "commitment-annual",
        cadence: "annual",
        firstDueDateIso: "2023-10-15",
        activeFromIso: "2023-10-01",
      },
      "2023-10-01",
      "2026-10-31"
    );

    expect(occurrences.map(({ dueDateIso }) => dueDateIso)).toEqual([
      "2023-10-15",
      "2024-10-15",
      "2025-10-15",
      "2026-10-15",
    ]);
  });

  it("marks a variable commitment with no known amount as an estimate", () => {
    const [occurrence] = scheduleGenerator()(
      {
        ...commitment,
        id: "commitment-variable",
        amountMinor: null,
        isVariable: true,
        firstDueDateIso: "2026-05-10",
        activeFromIso: "2026-05-01",
      },
      "2026-05-01",
      "2026-05-31"
    );

    expect(occurrence).toMatchObject({
      dueDateIso: "2026-05-10",
      amountMinor: null,
      isEstimate: true,
    });
  });

  it("suggests the exact payment difference without changing the commitment amount", () => {
    const priceChange = priceChangeDetector()(
      [
        {
          id: "payment-march",
          occurrenceDateIso: "2026-03-31",
          amountMinor: 12_900,
          currencyCode: "NOK",
          description: "Synthetic previous payment",
          status: "confirmed",
        },
        {
          id: "payment-april",
          occurrenceDateIso: "2026-04-30",
          amountMinor: 17_900,
          currencyCode: "NOK",
          description: "Synthetic latest payment",
          status: "confirmed",
        },
      ],
      commitment
    );

    expect(priceChange).toEqual({
      previousAmountMinor: 12_900,
      observedAmountMinor: 17_900,
      differenceMinor: 5_000,
      currencyCode: "NOK",
      previousPaymentDateIso: "2026-03-31",
      previousPaymentDescription: "Synthetic previous payment",
      observedPaymentDateIso: "2026-04-30",
      observedPaymentDescription: "Synthetic latest payment",
    });
    expect(commitment.amountMinor).toBe(12_900);
  });
});
