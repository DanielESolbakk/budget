import type { RecurringCommitment } from "../../src/domain/types.js";
import type { LedgerChannelContext } from "./context.js";
import { parseNonEmptyString, parseRecurringCommitmentInput, parseRecurringCommitmentPaymentLinkInput } from "./validation.js";
export function registerRecurringChannels({
  ipcMain,
  assertTrustedRenderer,
  recurringCommitmentService,
  ledgerOperationCoordinator
}: Pick<LedgerChannelContext,
  | "ipcMain"
  | "assertTrustedRenderer"
  | "recurringCommitmentService"
  | "ledgerOperationCoordinator"
>): void {

  ipcMain.handle("recurringCommitment:schedule", (event, evaluatedAtIso: unknown) => {
    assertTrustedRenderer(event);
    return recurringCommitmentService.getSchedule(
      evaluatedAtIso === undefined
        ? undefined
        : parseNonEmptyString(evaluatedAtIso, "evaluatedAtIso")
    );
  });

  ipcMain.handle("recurringCommitment:create", (event, input: unknown): Promise<RecurringCommitment> => {
    assertTrustedRenderer(event);
    const validated = parseRecurringCommitmentInput(input);
    return ledgerOperationCoordinator.runExclusive(() => recurringCommitmentService.create(validated));
  });

  ipcMain.handle("recurringCommitment:update", (event, input: unknown): Promise<RecurringCommitment> => {
    assertTrustedRenderer(event);
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new Error("Recurring commitment update request must be an object.");
    }
    const record = input as Record<string, unknown>;
    const commitmentId = parseNonEmptyString(record.commitmentId, "commitmentId");
    const validated = parseRecurringCommitmentInput(record.input);
    return ledgerOperationCoordinator.runExclusive(() =>
      recurringCommitmentService.update(commitmentId, validated)
    );
  });

  ipcMain.handle("recurringCommitment:confirm", (event, commitmentId: unknown): Promise<RecurringCommitment> => {
    assertTrustedRenderer(event);
    const id = parseNonEmptyString(commitmentId, "commitmentId");
    return ledgerOperationCoordinator.runExclusive(() => recurringCommitmentService.confirm(id));
  });

  ipcMain.handle("recurringCommitment:pause", (event, commitmentId: unknown): Promise<RecurringCommitment> => {
    assertTrustedRenderer(event);
    const id = parseNonEmptyString(commitmentId, "commitmentId");
    return ledgerOperationCoordinator.runExclusive(() => recurringCommitmentService.pause(id));
  });

  ipcMain.handle("recurringCommitment:resume", (event, commitmentId: unknown): Promise<RecurringCommitment> => {
    assertTrustedRenderer(event);
    const id = parseNonEmptyString(commitmentId, "commitmentId");
    return ledgerOperationCoordinator.runExclusive(() => recurringCommitmentService.resume(id));
  });

  ipcMain.handle("recurringCommitment:end", (event, commitmentId: unknown): Promise<RecurringCommitment> => {
    assertTrustedRenderer(event);
    const id = parseNonEmptyString(commitmentId, "commitmentId");
    return ledgerOperationCoordinator.runExclusive(() => recurringCommitmentService.end(id));
  });

  ipcMain.handle("recurringCommitment:linkPayment", (event, input: unknown): Promise<void> => {
    assertTrustedRenderer(event);
    const validated = parseRecurringCommitmentPaymentLinkInput(input);
    return ledgerOperationCoordinator.runExclusive(() =>
      recurringCommitmentService.linkPayment(validated)
    );
  });

  ipcMain.handle(
    "recurringCommitment:confirmPriceChange",
    (event, input: unknown): Promise<RecurringCommitment> => {
      assertTrustedRenderer(event);
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        throw new Error("Recurring commitment price confirmation must be an object.");
      }
      const record = input as Record<string, unknown>;
      const newAmountMinor = record.newAmountMinor;
      if (typeof newAmountMinor !== "number" || !Number.isSafeInteger(newAmountMinor)) {
        throw new Error("newAmountMinor must be a safe integer.");
      }
      const commitmentId = parseNonEmptyString(record.commitmentId, "commitmentId");
      return ledgerOperationCoordinator.runExclusive(() =>
        recurringCommitmentService.confirmPriceChange(commitmentId, newAmountMinor)
      );
    }
  );
}
