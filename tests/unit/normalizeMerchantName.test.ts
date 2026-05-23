import { describe, expect, it } from "vitest";
import { normalizeMerchantName } from "../../src/domain/merchant/normalizeMerchantName.js";

describe("normalizeMerchantName", () => {
  it("normalizes spacing and legal suffixes for Norwegian merchants", () => {
    expect(normalizeMerchantName("  Rema   1000  AS ")).toBe("REMA 1000");
    expect(normalizeMerchantName("NorgesGruppen asa")).toBe("NORGESGRUPPEN");
  });

  it("keeps meaningful merchant text", () => {
    expect(normalizeMerchantName("Vy Gruppen")).toBe("VY GRUPPEN");
  });
});