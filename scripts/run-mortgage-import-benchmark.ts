import { runMortgageImportBenchmark } from "../src/tooling/performance/runMortgageImportBenchmark.js";
import type { MortgageImportBenchmarkScenario } from "../src/tooling/performance/runMortgageImportBenchmark.js";

function getOptionValue(args: string[], optionName: string): string | undefined {
  const index = args.indexOf(optionName);
  return index === -1 ? undefined : args[index + 1];
}

const scenarioValues = new Set<string>([
  "three-year",
  "thirty-year",
  "near-limit",
] satisfies readonly MortgageImportBenchmarkScenario[]);
const args = process.argv.slice(2);
const scenarioValue = getOptionValue(args, "--case");
const iterationsRaw = getOptionValue(args, "--iterations");
const hypervisorName = getOptionValue(args, "--hypervisor");
const physicalHostCpuModel = getOptionValue(args, "--physical-host-cpu");
const physicalHostMemoryGiBRaw = getOptionValue(args, "--physical-host-memory-gib");
const iterationCount = iterationsRaw === undefined ? 5 : Number(iterationsRaw);
const isScenario = (
  value: string | undefined
): value is MortgageImportBenchmarkScenario => (
  value !== undefined && scenarioValues.has(value)
);
const physicalHostValues = [hypervisorName, physicalHostCpuModel, physicalHostMemoryGiBRaw];
const hasPhysicalHostMetadata = physicalHostValues.some((value) => value !== undefined);
const physicalHostMemoryGiB = Number(physicalHostMemoryGiBRaw);
const physicalHost = hypervisorName !== undefined &&
  physicalHostCpuModel !== undefined &&
  physicalHostMemoryGiBRaw !== undefined &&
  hypervisorName?.trim() !== "" &&
  physicalHostCpuModel?.trim() !== "" &&
  Number.isFinite(physicalHostMemoryGiB) &&
  physicalHostMemoryGiB > 0
  ? {
      hypervisorName,
      cpuModel: physicalHostCpuModel,
      totalMemoryBytes: Math.round(physicalHostMemoryGiB * 1024 ** 3),
    }
  : undefined;

if (!isScenario(scenarioValue) ||
    !Number.isSafeInteger(iterationCount) ||
    iterationCount <= 0 ||
    (hasPhysicalHostMetadata && physicalHost === undefined)) {
  console.error("Usage: npm run benchmark:mortgage-import -- --case <three-year|thirty-year|near-limit> [--iterations <positive-integer>] [--hypervisor <name> --physical-host-cpu <model> --physical-host-memory-gib <positive-number>]");
  process.exit(1);
}

const result = await runMortgageImportBenchmark({
  scenario: scenarioValue,
  iterationCount,
  ...(physicalHost === undefined ? {} : { physicalHost }),
});
console.log(JSON.stringify(result, null, 2));
if (result.evidenceStatus === "preliminary") {
  console.error("Preliminary only: observed VM does not match the approved Windows VM proxy profile.");
} else if (!result.physicalHost.metadataComplete) {
  console.error("VM profile matches; physical host metadata is missing or unavailable from the provider.");
}
