import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalSourcePath } from "../../src/app/import/sourceIdentity.js";

describe("native import source identity", () => {
  it("uses Windows drive and UNC resolution with case-insensitive identity", () => {
    expect(canonicalSourcePath("C:\\Statements\\..\\Imports\\BANK.csv", win32)).toBe("c:\\imports\\bank.csv");
    expect(canonicalSourcePath("\\\\Server\\Share\\Statements\\..\\BANK.pdf", win32))
      .toBe("\\\\server\\share\\bank.pdf");
  });
  it("uses POSIX resolution without discarding significant case", () => {
    expect(canonicalSourcePath("/Statements/../Imports/BANK.csv", posix)).toBe("/Imports/BANK.csv");
    expect(canonicalSourcePath("/Imports/BANK.csv", posix)).not.toBe(canonicalSourcePath("/imports/bank.csv", posix));
  });
  it("resolves relative paths using the real native working directory", () => {
    const paths = process.platform === "win32" ? win32 : posix;
    const expected = paths.resolve("synthetic", "statement.csv");
    expect(canonicalSourcePath(paths.join("synthetic", "..", "synthetic", "statement.csv")))
      .toBe(process.platform === "win32" ? expected.toLowerCase() : expected);
  });
});
