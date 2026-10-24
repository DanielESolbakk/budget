import type { ElectronApplication } from "@playwright/test";

export async function installMainProcessFetchProbe(
  electronApp: ElectronApplication
): Promise<void> {
  await electronApp.evaluate(() => {
    const state = globalThis as typeof globalThis & { __budgetMainFetchRequests?: string[] };
    state.__budgetMainFetchRequests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      state.__budgetMainFetchRequests?.push(String(input));
      return originalFetch(input, init);
    };
  });
}

export async function mainProcessFetchRequests(
  electronApp: ElectronApplication
): Promise<string[]> {
  return electronApp.evaluate(() =>
    (globalThis as typeof globalThis & { __budgetMainFetchRequests?: string[] })
      .__budgetMainFetchRequests ?? []
  );
}
