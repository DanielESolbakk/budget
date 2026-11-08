import {
  validateHoldingCorrectionInput,
  validateHoldingRecordInput,
  validateHoldingValuationCorrectionInput,
  validateHoldingValuationInput,
} from "../../src/domain/holdingRecordValidation.js";
import { validateLoanResponsibilityShareUpdate, validatePropertyOwnershipShareUpdate } from "../../src/domain/householdShareValidation.js";
import { validateLoanBalanceInput, validateLoanRecordInput } from "../../src/domain/loanRecordValidation.js";
import {
  validatePropertyLabelUpdateInput,
  validatePropertyRecordInput,
  validatePropertyValuationCorrectionInput,
  validatePropertyValuationInput,
} from "../../src/domain/propertyRecordValidation.js";
import type {
  HoldingRecord,
  HoldingValuationInput,
  HoldingValuationSnapshot,
  HoldingWithValuations,
  LoanBalanceInput,
  LoanBalanceSnapshot,
  LoanRecord,
  LoanWithBalances,
  PropertyRecord,
  PropertyValuationSnapshot,
  PropertyWithValuations,
} from "../../src/domain/types.js";
import type { LedgerChannelContext } from "./context.js";

export function registerRegistriesChannels({
  ipcMain,
  assertTrustedRenderer,
  propertyRegistry,
  holdingRegistry,
  loanRegistry,
  ledgerOperationCoordinator
}: Pick<LedgerChannelContext,
  | "ipcMain"
  | "assertTrustedRenderer"
  | "propertyRegistry"
  | "holdingRegistry"
  | "loanRegistry"
  | "ledgerOperationCoordinator"
>): void {

  ipcMain.handle("propertyRegistry:list", (event): PropertyWithValuations[] => {
    assertTrustedRenderer(event);
    return propertyRegistry.list();
  });

  ipcMain.handle("holdingRegistry:list", (event): HoldingWithValuations[] => {
    assertTrustedRenderer(event);
    return holdingRegistry.list();
  });

  ipcMain.handle("loanRegistry:list", (event): LoanWithBalances[] => {
    assertTrustedRenderer(event);
    return loanRegistry.list();
  });

  ipcMain.handle("loanRegistry:create", (event, input: unknown): Promise<LoanRecord> => {
    assertTrustedRenderer(event);
    const propertyIds = propertyRegistry.list().map((property) => property.id);
    const validated = validateLoanRecordInput(input, propertyIds);
    return ledgerOperationCoordinator.runExclusive(() => loanRegistry.create(validated));
  });

  ipcMain.handle("loanRegistry:updateResponsibilityShare", (event, input: unknown): Promise<LoanRecord> => {
    assertTrustedRenderer(event);
    const validated = validateLoanResponsibilityShareUpdate(input);
    return ledgerOperationCoordinator.runExclusive(() => loanRegistry.updateResponsibilityShare(validated));
  });

  ipcMain.handle(
    "loanRegistry:appendBalance",
    (event, input: unknown): Promise<LoanBalanceSnapshot> => {
      assertTrustedRenderer(event);
      const validated: LoanBalanceInput = validateLoanBalanceInput(input);
      return ledgerOperationCoordinator.runExclusive(() => loanRegistry.appendBalance(validated));
    }
  );

  ipcMain.handle("holdingRegistry:create", (event, input: unknown): Promise<HoldingRecord> => {
    assertTrustedRenderer(event);
    const validated = validateHoldingRecordInput(input);
    return ledgerOperationCoordinator.runExclusive(() => holdingRegistry.create(validated));
  });

  ipcMain.handle("holdingRegistry:correctHolding", (event, input: unknown): Promise<HoldingRecord> => {
    assertTrustedRenderer(event);
    const validated = validateHoldingCorrectionInput(input);
    return ledgerOperationCoordinator.runExclusive(() => holdingRegistry.correctHolding(validated));
  });

  ipcMain.handle(
    "holdingRegistry:correctValuation",
    (event, input: unknown): Promise<HoldingValuationSnapshot> => {
      assertTrustedRenderer(event);
      const validated = validateHoldingValuationCorrectionInput(input);
      return ledgerOperationCoordinator.runExclusive(() => holdingRegistry.correctValuation(validated));
    }
  );

  ipcMain.handle(
    "holdingRegistry:appendValuation",
    (event, input: unknown): Promise<HoldingValuationSnapshot> => {
      assertTrustedRenderer(event);
      const validated: HoldingValuationInput = validateHoldingValuationInput(input);
      return ledgerOperationCoordinator.runExclusive(() => holdingRegistry.appendValuation(validated));
    }
  );

  ipcMain.handle("propertyRegistry:create", (event, input: unknown): Promise<PropertyRecord> => {
    assertTrustedRenderer(event);
    const validated = validatePropertyRecordInput(input);
    return ledgerOperationCoordinator.runExclusive(() => propertyRegistry.create(validated));
  });

  ipcMain.handle("propertyRegistry:updateOwnershipShare", (event, input: unknown): Promise<PropertyRecord> => {
    assertTrustedRenderer(event);
    const validated = validatePropertyOwnershipShareUpdate(input);
    return ledgerOperationCoordinator.runExclusive(() => propertyRegistry.updateOwnershipShare(validated));
  });

  ipcMain.handle(
    "propertyRegistry:rename",
    (event, input: unknown): Promise<PropertyRecord> => {
      assertTrustedRenderer(event);
      const validated = validatePropertyLabelUpdateInput(input);
      return ledgerOperationCoordinator.runExclusive(() => propertyRegistry.renameProperty(validated));
    }
  );

  ipcMain.handle(
    "propertyRegistry:appendValuation",
    (event, input: unknown): Promise<PropertyValuationSnapshot> => {
      assertTrustedRenderer(event);
      const validated = validatePropertyValuationInput(input);
      return ledgerOperationCoordinator.runExclusive(() => propertyRegistry.appendValuation(validated));
    }
  );

  ipcMain.handle(
    "propertyRegistry:appendCorrection",
    (event, input: unknown): Promise<PropertyValuationSnapshot> => {
      assertTrustedRenderer(event);
      const validated = validatePropertyValuationCorrectionInput(input);
      return ledgerOperationCoordinator.runExclusive(() => propertyRegistry.appendCorrection(validated));
    }
  );
}
