import { resolve } from "node:path";
import { sanitizeFixtureCsv } from "../src/tooling/fixtures/sanitizeCsv.js";

function getOptionValue(args: string[], optionName: string): string | undefined {
  const index = args.indexOf(optionName);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

const args = process.argv.slice(2);
const inputPath = getOptionValue(args, "--input");
const outputPath = getOptionValue(args, "--output") ?? "tests/fixtures/synthetic/sanitized-output.csv";
const mapPath = getOptionValue(args, "--map") ?? "local/sanitization-map.json";
const seed = getOptionValue(args, "--seed") ?? "budget-planner";
const dryRun = args.includes("--dry-run");

if (!inputPath) {
  console.error("Usage: npm run sanitizer -- --input <csv-path> [--output <csv-path>] [--map <json-path>] [--seed <seed>] [--dry-run]");
  process.exit(1);
}

const result = sanitizeFixtureCsv({
  inputPath: resolve(inputPath),
  outputPath: resolve(outputPath),
  mapPath: resolve(mapPath),
  seed,
  dryRun
});

console.log(
  JSON.stringify(
    {
      rowCount: result.rowCount,
      mapEntryCount: result.mapEntries.length,
      outputPath: dryRun ? null : resolve(outputPath),
      mapPath: dryRun ? null : resolve(mapPath)
    },
    null,
    2
  )
);