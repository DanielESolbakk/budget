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

  it("removes all supported legal suffix variants", () => {
    expect(normalizeMerchantName("Eksempel AS")).toBe("EKSEMPEL");
    expect(normalizeMerchantName("Eksempel ASA")).toBe("EKSEMPEL");
    expect(normalizeMerchantName("Eksempel SA")).toBe("EKSEMPEL");
    expect(normalizeMerchantName("Eksempel ANS")).toBe("EKSEMPEL");
  });

  it("returns empty string when input only contains removable suffix tokens", () => {
    expect(normalizeMerchantName(" AS ")).toBe("");
    expect(normalizeMerchantName("ASA")).toBe("");
  });
});