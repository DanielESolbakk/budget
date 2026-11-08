import { posix, win32 } from "node:path";

/** Native lexical path identity, not symlink identity. Tests supply the actual platform parser. */
export function canonicalSourcePath(
  filePath: string,
  paths: Pick<typeof win32, "resolve" | "sep"> = process.platform === "win32" ? win32 : posix
): string {
  const resolvedPath = paths.resolve(filePath);
  return paths.sep === "\\" ? resolvedPath.toLowerCase() : resolvedPath;
}
