import type { ElectronApplication } from "@playwright/test";

export async function installMainProcessFetchProbe(
  electronApp: ElectronApplication
): Promise<void> {
  await electronApp.evaluate(() => {
    const state = globalThis as typeof globalThis & { __budgetMainFetchRequests?: string[] };
    state.__budgetMainFetchRequests = [];
    globalThis.fetch = async (input) => {
      const requests = state.__budgetMainFetchRequests;
      if (requests === undefined) {
        throw new Error("The main-process fetch probe is not installed.");
      }
      requests.push(String(input));
      throw new Error("Main-process fetch is blocked in local-only tests.");
    };
  });
}

export async function mainProcessFetchRequests(
  electronApp: ElectronApplication
): Promise<string[]> {
  const requests = await electronApp.evaluate(() =>
    (globalThis as typeof globalThis & { __budgetMainFetchRequests?: string[] })
      .__budgetMainFetchRequests
  );
  if (requests === undefined) {
    throw new Error("The main-process fetch probe was not installed.");
  }
  return requests;
}

export async function installMainProcessNetworkProbe(
  electronApp: ElectronApplication
): Promise<void> {
  await electronApp.evaluate(() => {
    const state = globalThis as typeof globalThis & { __budgetMainNetworkRequests?: string[] };
    state.__budgetMainNetworkRequests = [];
    const recordRequest = (transport: string, target: unknown): never => {
      const requests = state.__budgetMainNetworkRequests;
      if (requests === undefined) {
        throw new Error("The main-process network probe is not installed.");
      }
      requests.push(`${transport}: ${String(target)}`);
      throw new Error(`Main-process ${transport} is blocked in local-only tests.`);
    };
    const nodeModule = process.getBuiltinModule("node:module");
    const entryPoint = process.argv[1];
    if (nodeModule === undefined || entryPoint === undefined) {
      throw new Error("Unable to resolve Node modules for the main-process network probe.");
    }
    const requireMain = nodeModule.createRequire(entryPoint);

    globalThis.fetch = async (input) => recordRequest("fetch", input);

    const http = requireMain("node:http") as typeof import("node:http");
    http.request = ((...args: unknown[]) =>
      recordRequest("node:http.request", args[0])) as typeof http.request;
    http.get = ((...args: unknown[]) =>
      recordRequest("node:http.get", args[0])) as typeof http.get;

    const https = requireMain("node:https") as typeof import("node:https");
    https.request = ((...args: unknown[]) =>
      recordRequest("node:https.request", args[0])) as typeof https.request;
    https.get = ((...args: unknown[]) =>
      recordRequest("node:https.get", args[0])) as typeof https.get;

    const net = requireMain("node:net") as typeof import("node:net");
    net.Socket.prototype.connect = ((...args: unknown[]) =>
      recordRequest("node:net.Socket.connect", args[0])) as typeof net.Socket.prototype.connect;

    const electronNet = (requireMain("electron") as typeof import("electron")).net;
    electronNet.request = ((options: unknown) =>
      recordRequest("electron.net.request", options)) as typeof electronNet.request;
  });
}

export async function mainProcessNetworkRequests(
  electronApp: ElectronApplication
): Promise<string[]> {
  const requests = await electronApp.evaluate(() =>
    (globalThis as typeof globalThis & { __budgetMainNetworkRequests?: string[] })
      .__budgetMainNetworkRequests
  );
  if (requests === undefined) {
    throw new Error("The main-process network probe was not installed.");
  }
  return requests;
}
