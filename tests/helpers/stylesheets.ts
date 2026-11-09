import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import postcss, { type ChildNode, type Root } from "postcss";

export function readStylesheetGraph(entry: string) {
  const files = new Set<string>();
  function read(file: string): Root {
    if (files.has(file)) throw new Error(`Repeated or cyclic stylesheet import: ${file}`);
    files.add(file);
    const root = postcss.parse(readFileSync(file, "utf8"), { from: file });
    root.walkAtRules("import", rule => {
      if (rule.parent !== root) throw new Error(`Stylesheet imports must be at the top level: ${file}`);
    });
    let foundRule = false;
    for (const node of [...root.nodes]) {
      if (node.type === "comment") continue;
      if (node.type !== "atrule" || node.name !== "import") {
        foundRule = true;
        continue;
      }
      if (foundRule) throw new Error(`Stylesheet import after a rule: ${file}`);
      const match = /^["'](\.[^"']+\.css)["']$/.exec(node.params);
      if (match === null || isAbsolute(match[1]!)) {
        throw new Error(`Expected an unconditional relative CSS import: ${node.params}`);
      }
      const imported = read(resolve(dirname(file), match[1]!));
      node.replaceWith(...imported.nodes);
    }
    return root;
  }
  const root = read(resolve(entry));
  return { root, files: [...files] };
}

export function stylesheetStructure(root: Root): string {
  function nodesStructure(nodes: ChildNode[]): unknown[] {
    return nodes.filter(node => node.type !== "comment").map(node => {
      switch (node.type) {
        case "rule":
          return { type: node.type, selector: node.selector, nodes: nodesStructure(node.nodes) };
        case "atrule":
          return { type: node.type, name: node.name, params: node.params,
            nodes: node.nodes === undefined ? undefined : nodesStructure(node.nodes) };
        case "decl":
          return { type: node.type, prop: node.prop, value: node.value, important: !!node.important };
      }
    });
  }
  return JSON.stringify(nodesStructure(root.nodes));
}
