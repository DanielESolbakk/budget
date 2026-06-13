import { resolve } from "node:path";
import { verifyFixture } from "../src/tooling/fixtures/verifyFixture.js";

function getOptionValue(args: string[], optionName: string): string | undefined {
  const index = args.indexOf(optionName);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

const args = process.argv.slice(2);
const inputPath = getOptionValue(args, "--input");
const reportPath = getOptionValue(args, "--report");

if (!inputPath) {
  console.error("Usage: npm run verify-fixture -- --input <csv-path> [--report <json-path>]");
  process.exit(1);
}

const report = verifyFixture({
  inputPath: resolve(inputPath),
  reportPath: reportPath ? resolve(reportPath) : undefined
});

console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  process.exit(1);
}