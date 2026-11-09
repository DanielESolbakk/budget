import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readStylesheetGraph } from "../helpers/stylesheets.js";

const stylesheetPath = fileURLToPath(new URL("../../src/renderer/app.css", import.meta.url));

describe("application stylesheet syntax", () => {
  it("parses the complete shipped stylesheet without recovery", () => {
    const ownedStylesheets = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? ownedStylesheets(join(directory, entry.name))
          : entry.name.endsWith(".css") ? [join(directory, entry.name)] : []
      );
    const { files } = readStylesheetGraph(stylesheetPath);
    expect(files.sort()).toEqual(ownedStylesheets(dirname(stylesheetPath)).sort());
  });

  it("checks imported files and retains their cascade order", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-css-"));
    try {
      writeFileSync(join(directory, "app.css"), '@import "./base.css";\n@import "./state.css";');
      writeFileSync(join(directory, "base.css"), '@import "./tokens.css";\n.record { color: red; }');
      writeFileSync(join(directory, "tokens.css"), ".record { color: black !important; }");
      writeFileSync(join(directory, "state.css"), ".record { color: blue; }");
      const { root, files } = readStylesheetGraph(join(directory, "app.css"));
      const colors: string[] = [];
      root.walkDecls("color", ({ value }) => { colors.push(value); });
      expect(colors).toEqual(["black", "red", "blue"]);
      expect(files).toEqual(["app.css", "base.css", "tokens.css", "state.css"].map(file => join(directory, file)));
      writeFileSync(join(directory, "state.css"), ".record { color: blue;");
      expect(() => readStylesheetGraph(join(directory, "app.css"))).toThrow(/Unclosed block/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { css: '@import "./missing.css";', child: "", error: /ENOENT/ },
    { css: '@import "./child.css";', child: '@import "./app.css";', error: /cyclic/ },
    { css: '@import "./child.css";\n@import "./child.css";', child: "", error: /Repeated/ },
    { css: '.record { color: red; }\n@import "./child.css";', child: "", error: /after a rule/ },
    { css: '@import "https://example.invalid/style.css";', child: "", error: /relative CSS import/ },
    { css: '@import "./child.css" screen;', child: "", error: /unconditional/ },
    { css: '@media screen { @import "./child.css"; }', child: "", error: /top level/ },
  ])("rejects an invalid stylesheet graph: $css", ({ css, child, error }) => {
    const directory = mkdtempSync(join(tmpdir(), "budget-css-"));
    try {
      writeFileSync(join(directory, "app.css"), css);
      writeFileSync(join(directory, "child.css"), child);
      expect(() => readStylesheetGraph(join(directory, "app.css"))).toThrow(error);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
