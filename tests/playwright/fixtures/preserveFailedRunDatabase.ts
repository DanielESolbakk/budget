import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface PreservedDatabaseArtifacts {
  databaseFile?: string;
  sourcePathFile: string;
}

export function preserveFailedRunDatabase(options: {
  databasePath: string;
  artifactDirectory: string;
  status: string | null | undefined;
  expectedStatus: string;
}): PreservedDatabaseArtifacts | undefined {
  if (
    options.status === null ||
    options.status === undefined ||
    options.status === "skipped" ||
    options.status === options.expectedStatus
  ) {
    return undefined;
  }

  mkdirSync(options.artifactDirectory, { recursive: true });
  const sourcePathFile = join(options.artifactDirectory, "database-path.txt");
  writeFileSync(sourcePathFile, options.databasePath, "utf8");
  const artifacts: PreservedDatabaseArtifacts = { sourcePathFile };

  if (existsSync(options.databasePath)) {
    const databaseFile = join(options.artifactDirectory, basename(options.databasePath));
    copyFileSync(options.databasePath, databaseFile);
    artifacts.databaseFile = databaseFile;

    for (const suffix of ["-wal", "-shm"]) {
      const sidecarPath = `${options.databasePath}${suffix}`;
      if (existsSync(sidecarPath)) {
        copyFileSync(sidecarPath, `${databaseFile}${suffix}`);
      }
    }
  }

  return artifacts;
}
