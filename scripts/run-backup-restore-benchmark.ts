import { resolve } from "node:path";
import { createPerformanceHarness } from "../src/tooling/performance/createPerformanceHarness.js";

function getOptionValue(args: string[], optionName: string): string | undefined {
  const index = args.indexOf(optionName);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

const args = process.argv.slice(2);
const inputPath = getOptionValue(args, "--input") ?? "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";
const iterationsRaw = getOptionValue(args, "--iterations");
const iterationCount = iterationsRaw === undefined ? 2 : Number.parseInt(iterationsRaw, 10);

if (!Number.isInteger(iterationCount) || iterationCount <= 0) {
  if (iterationsRaw !== undefined) {
    console.error(`Invalid --iterations value: ${iterationsRaw}. Must be a positive integer.`);
  }
  console.error("Usage: npm run benchmark:backup-restore -- [--input <csv-path>] [--iterations <positive-integer>]");
  process.exit(1);
}

const result = createPerformanceHarness({
  fixturePath: resolve(inputPath),
  iterationCount,
  projectRoot: process.cwd(),
});

console.log(JSON.stringify(result, null, 2));

if (!result.metrics.roundTripStable || result.metrics.skippedRowCount !== 0) {
  process.exit(1);
}
