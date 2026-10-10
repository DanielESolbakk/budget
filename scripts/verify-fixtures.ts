import { mkdirSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { verifyFixture } from "../src/tooling/fixtures/verifyFixture.js";

function getOptionValue(args: string[], optionName: string): string | undefined {
  const index = args.indexOf(optionName);
  return index === -1 ? undefined : args[index + 1];
}

const args = process.argv.slice(2);
const inputDirectory = getOptionValue(args, "--input-dir");
const reportDirectory = getOptionValue(args, "--report-dir");

if (!inputDirectory || !reportDirectory) {
  console.error(
    "Usage: npm run verify-fixtures -- --input-dir <csv-directory> --report-dir <report-directory>"
  );
  process.exit(1);
}

const resolvedInputDirectory = resolve(inputDirectory);
const resolvedReportDirectory = resolve(reportDirectory);
const fixtureNames = readdirSync(resolvedInputDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, "en"));

mkdirSync(resolvedReportDirectory, { recursive: true });

if (fixtureNames.length === 0) {
  console.error(`No CSV fixtures found under ${resolvedInputDirectory}.`);
  process.exit(1);
}

let hasFailedFixture = false;

for (const fixtureName of fixtureNames) {
  const reportPath = resolve(
    resolvedReportDirectory,
    `${basename(fixtureName, ".csv")}.verification-report.json`
  );
  const report = verifyFixture({
    inputPath: resolve(resolvedInputDirectory, fixtureName),
    reportPath
  });

  if (!report.ok) {
    hasFailedFixture = true;
  }

  console.log(`${fixtureName}: ${report.ok ? "ok" : "failed"}`);
}

if (hasFailedFixture) {
  process.exitCode = 1;
}