const legalSuffixPattern = /\b(AS|ASA|SA|ANS)\b/g;

export function normalizeMerchantName(rawMerchantName: string): string {
  return rawMerchantName
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(legalSuffixPattern, "")
    .replace(/\s+/g, " ")
    .trim();
}