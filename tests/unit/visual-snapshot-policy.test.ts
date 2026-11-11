import { afterEach, describe, expect, it, vi } from "vitest";
import { assertVisualScreenshot } from "../playwright/visualScreenshot.js";

describe("visual screenshot policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("skips screenshot comparisons when the skip policy is enabled", async () => {
    vi.stubEnv("PLAYWRIGHT_SKIP_VISUAL_SNAPSHOTS", "true");
    const compare = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await assertVisualScreenshot("dashboard.png", compare);

    expect(compare).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "Skipping visual screenshot comparison in CI: dashboard.png",
    );
  });

  it("runs screenshot comparisons when the skip policy is disabled", async () => {
    vi.stubEnv("PLAYWRIGHT_SKIP_VISUAL_SNAPSHOTS", "");
    const compare = vi.fn<() => Promise<void>>(() => Promise.resolve());

    await assertVisualScreenshot("dashboard.png", compare);

    expect(compare).toHaveBeenCalledTimes(1);
  });

  it("does not suppress screenshot failures outside CI", async () => {
    vi.stubEnv("PLAYWRIGHT_SKIP_VISUAL_SNAPSHOTS", "");
    const failure = new Error("snapshot differs");

    await expect(
      assertVisualScreenshot("dashboard.png", () => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });
});
