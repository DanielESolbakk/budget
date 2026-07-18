import { validatePackagedRuntime } from "../src/tooling/runtime/validatePackagedRuntime.js";

const result = validatePackagedRuntime({
  projectRoot: process.cwd(),
  requireBuiltArtifacts: true,
});

console.log(JSON.stringify(result, null, 2));

if (
  result.startupReadiness.status !== "ready" ||
  result.baselineShell.status !== "ready" ||
  !result.noNetworkByDefault
) {
  process.exit(1);
}
