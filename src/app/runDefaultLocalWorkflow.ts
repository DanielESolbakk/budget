import { normalizeMerchantName } from "../domain/merchant/normalizeMerchantName.js";

export interface LocalWorkflowInput {
  merchantRaw: string;
}

export interface LocalWorkflowOutput {
  normalizedMerchant: string;
}

export function runDefaultLocalWorkflow(input: LocalWorkflowInput): LocalWorkflowOutput {
  return {
    normalizedMerchant: normalizeMerchantName(input.merchantRaw)
  };
}