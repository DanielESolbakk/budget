import { createHash, createHmac } from "node:crypto";

export interface MortgageIdentityFingerprinter {
  readonly keyId: string;
  fingerprint: (reference: string) => string;
}

export function createMortgageIdentityFingerprinter(
  key: Uint8Array
): MortgageIdentityFingerprinter {
  if (key.byteLength !== 32) {
    throw new RangeError("Mortgage identity fingerprint keys must contain exactly 32 bytes.");
  }
  const protectedKey = Buffer.from(key);
  const keyId = createHash("sha256")
    .update("budget:mortgage-identity-key-id:v1\0", "utf8")
    .update(protectedKey)
    .digest("hex")
    .slice(0, 16);

  return {
    keyId,
    fingerprint: (reference) => {
      const normalizedReference = reference.trim().toUpperCase().replace(/\s+/g, "");
      if (normalizedReference === "") {
        throw new RangeError("Mortgage identity references must not be empty.");
      }
      return createHmac("sha256", protectedKey)
        .update("budget:mortgage-loan-reference:v1\0", "utf8")
        .update(normalizedReference, "utf8")
        .digest("hex");
    },
  };
}
