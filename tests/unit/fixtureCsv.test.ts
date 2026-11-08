import { describe, expect, it } from "vitest";
import { parseFixtureCsv, stringifyFixtureCsv } from "../../src/tooling/fixtures/fixtureCsv.js";

describe("fixture CSV serialization", () => {
  it("escapes headers and cells including whitespace at file boundaries", () => {
    const parsed = {
      header: [" header ", "semi;colon", 'a"quote', "line\nfeed", "return\r", "pair\r\n", "Beløp"],
      rows: [[" ordinary ", "A;B", 'say "hei"', "one\ntwo", "one\rtwo", "one\r\ntwo", " Øre "]],
    };
    const text = stringifyFixtureCsv(parsed);
    expect(text).toBe('" header ";"semi;colon";"a""quote";"line\nfeed";"return\r";"pair\r\n";Beløp\n" ordinary ";"A;B";"say ""hei""";"one\ntwo";"one\rtwo";"one\r\ntwo";" Øre "\n');
    expect(parseFixtureCsv(text)).toEqual(parsed);
  });
  it("preserves ordinary rows, empty adjacent cells and the final LF", () => {
    expect(stringifyFixtureCsv({ header: ["a", "b", "c"], rows: [["1", "", "3"]] })).toBe("a;b;c\n1;;3\n");
  });
  it.each([{ row: [] }, { row: ["one"] }, { row: ["one", "two", "three"] }])("rejects mismatched row widths: $row", ({ row }) => {
    expect(() => stringifyFixtureCsv({ header: ["a", "b"], rows: [row] })).toThrow(/Row 2.*expected 2/);
  });
  it("rejects a missing header instead of writing an empty CSV", () => {
    expect(() => stringifyFixtureCsv({ header: [], rows: [] })).toThrow(/header/i);
  });
  it("retains intentional blank and bank-summary filtering", () => {
    expect(parseFixtureCsv("a;b\n;;\nTotal beløp inn på konto:;100\nordinary;value\n")).toEqual({ header: ["a", "b"], rows: [["ordinary", "value"]] });
  });
  it("rejects empty text and handles a BOM without changing ordinary cells", () => {
    expect(() => parseFixtureCsv(" \r\n ")).toThrow(/empty/i);
    expect(parseFixtureCsv("\uFEFFa;b\none;two\n")).toEqual({ header: ["a", "b"], rows: [["one", "two"]] });
  });
});
