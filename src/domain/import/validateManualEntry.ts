export interface ManualEntryPayload {
  accountId: string;
  bookedAtIso: string;
  amountMinor: number;
  merchantRaw: string;
}

export type ManualEntryValidationResult =
  | { valid: true; payload: ManualEntryPayload }
  | { valid: false; errors: string[] };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z)?$/;

function isValidIsoDate(value: string): boolean {
  const trimmed = value.trim();
  if (!ISO_DATE_RE.test(trimmed)) return false;
  const parsed = new Date(trimmed);
  return !isNaN(parsed.getTime());
}

export function validateManualEntry(
  input: unknown
): ManualEntryValidationResult {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null) {
    return { valid: false, errors: ["Payload must be a non-null object."] };
  }

  const raw = input as Record<string, unknown>;

  if (typeof raw["accountId"] !== "string" || raw["accountId"].trim() === "") {
    errors.push("accountId must be a non-empty string.");
  }

  if (
    typeof raw["bookedAtIso"] !== "string" ||
    !isValidIsoDate(raw["bookedAtIso"])
  ) {
    errors.push(
      "bookedAtIso must be a valid ISO 8601 date or datetime string."
    );
  }

  if (
    typeof raw["amountMinor"] !== "number" ||
    !Number.isInteger(raw["amountMinor"])
  ) {
    errors.push("amountMinor must be an integer.");
  }

  if (
    typeof raw["merchantRaw"] !== "string" ||
    raw["merchantRaw"].trim() === ""
  ) {
    errors.push("merchantRaw must be a non-empty string.");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    payload: {
      accountId: (raw["accountId"] as string).trim(),
      bookedAtIso: (raw["bookedAtIso"] as string).trim(),
      amountMinor: raw["amountMinor"] as number,
      merchantRaw: (raw["merchantRaw"] as string).trim(),
    },
  };
}
