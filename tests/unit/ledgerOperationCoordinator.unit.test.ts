import { describe, expect, it } from "vitest";
import { LedgerOperationCoordinator } from "../../src/app/ledgerOperationCoordinator.js";

describe("LedgerOperationCoordinator", () => {
  it("runs operations in invocation order, including asynchronous work", async () => {
    const coordinator = new LedgerOperationCoordinator();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = coordinator.runExclusive(async () => {
      events.push("first-start");
      await firstReleased;
      events.push("first-end");
      return "first";
    });
    const second = coordinator.runExclusive(() => {
      events.push("second");
      return "second";
    });

    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    releaseFirst!();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });

  it("continues after a rejected operation", async () => {
    const coordinator = new LedgerOperationCoordinator();
    const failed = coordinator.runExclusive(() => {
      throw new Error("expected failure");
    });
    const recovered = coordinator.runExclusive(() => "recovered");

    await expect(failed).rejects.toThrow("expected failure");
    await expect(recovered).resolves.toBe("recovered");
  });
});