import { contextBridge, ipcRenderer } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { BudgetApi } from "../../src/renderer/preload.js";

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn() },
}));

import "../../src/renderer/preload.js";

describe("review preload bridge", () => {
  it("forwards correction history, propagation apply/history, and undo to their IPC channels", async () => {
    const call = vi.mocked(contextBridge.exposeInMainWorld).mock.calls[0];
    expect(call?.[0]).toBe("budgetApi");
    if (!call) throw new Error("Preload did not expose budgetApi.");
    const exposedApi: BudgetApi = call[1];
    const review = exposedApi.review;
    const propagationInput: Parameters<BudgetApi["review"]["propagation"]["apply"]>[0] = {
      sourceTransactionId: "tx-corrected",
      merchantAlias: "REMA 1000",
      categoryId: "groceries",
      transactionIds: ["tx-selected"],
      confirmed: true,
    };

    expect(typeof review?.history?.corrections).toBe("function");
    expect(typeof review?.history?.propagations).toBe("function");
    expect(typeof review?.propagation?.apply).toBe("function");
    expect(typeof review?.propagation?.undo).toBe("function");

    await review.history.corrections();
    await review.history.propagations();
    await review.propagation.apply(propagationInput);
    await review.propagation.undo("operation-1");

    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(1, "review:correctionHistory:list");
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(2, "review:propagationHistory:list");
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(3, "review:propagation:apply", propagationInput);
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(4, "review:propagation:undo", "operation-1");
  });
});