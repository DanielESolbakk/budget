import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const stylesheetPath = fileURLToPath(new URL("../../src/renderer/app.css", import.meta.url));

describe("application stylesheet syntax", () => {
  it("parses the complete shipped stylesheet without recovery", () => {
    const stylesheet = readFileSync(stylesheetPath, "utf8");
    expect(() => postcss.parse(stylesheet, { from: stylesheetPath })).not.toThrow();
  });
});
