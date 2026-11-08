import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { writePdfObjects } from "../helpers/pdfObjectWriter.js";
import { createSyntheticPdfWithText } from "../helpers/createSyntheticPdf.js";
import { createPaginatedRogalandPdfWithMalformedSecondPage } from "../helpers/createPaginatedRogalandPdf.js";

describe("synthetic PDF object serialization", () => {
  it("writes byte-based offsets, ordered object numbers and root/trailer references", () => {
    const pdf = writePdfObjects(["<< /Type /Catalog /Note (Øre) >>", "<< /Type /Pages >>"]);
    const bytes = pdf.toString("utf8");
    const firstOffset = pdf.indexOf(Buffer.from("1 0 obj\n"));
    const secondOffset = pdf.indexOf(Buffer.from("2 0 obj\n"));
    const xrefOffset = pdf.indexOf(Buffer.from("xref\n"));
    expect(firstOffset).toBe(9);
    expect(secondOffset).toBe(58);
    expect(bytes).toContain("xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n");
    expect(bytes).toContain(`trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
    expect(pdf.subarray(secondOffset, secondOffset + 7).toString()).toBe("2 0 obj");
  });
  it("rejects empty object collections without fabricating a dangling root", () => {
    expect(() => writePdfObjects([])).toThrow(/object/i);
  });
  it("preserves representative text PDF bytes captured before extraction", () => {
    const pdf = createSyntheticPdfWithText("SYNTHETIC SHOP\nBeløp -12,34 NOK");
    expect(pdf.length).toBe(711);
    expect(createHash("sha256").update(pdf).digest("hex")).toBe("72515a3d29a069c8013579afbe812e4b5a150ccae544e407160bfe8d77308050");
  });
  it("preserves paginated malformed-second-page bytes captured before extraction", () => {
    const pdf = createPaginatedRogalandPdfWithMalformedSecondPage();
    expect(pdf.length).toBe(3492);
    expect(createHash("sha256").update(pdf).digest("hex")).toBe("c08243653bdae2b2c3562a3dc25a75e21813767e07e6530d57823525746a5b48");
  });
});
