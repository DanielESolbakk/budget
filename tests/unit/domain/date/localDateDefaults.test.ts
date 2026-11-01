import { describe, expect, test } from "vitest";
import { toLocalIsoDate, toLocalYearMonth } from "../../../../src/domain/date/localDateDefaults.js";

describe("local date defaults", () => {
  test("uses the local calendar month and date at the start of October", () => {
    const date = new Date(2026, 9, 1, 0, 15);

    expect(toLocalYearMonth(date)).toBe("2026-10");
    expect(toLocalIsoDate(date)).toBe("2026-10-01");
  });

  test("keeps local dates on their side of the year boundary", () => {
    const lastDayOfYear = new Date(2026, 11, 31, 23, 45);
    const firstDayOfYear = new Date(2027, 0, 1, 0, 15);

    expect(toLocalYearMonth(lastDayOfYear)).toBe("2026-12");
    expect(toLocalIsoDate(lastDayOfYear)).toBe("2026-12-31");
    expect(toLocalYearMonth(firstDayOfYear)).toBe("2027-01");
    expect(toLocalIsoDate(firstDayOfYear)).toBe("2027-01-01");
  });
});
