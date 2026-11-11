export async function assertVisualScreenshot(
  name: string,
  compare: () => Promise<void>,
): Promise<void> {
  if (process.env.PLAYWRIGHT_SKIP_VISUAL_SNAPSHOTS === "true") {
    console.info(`Skipping visual screenshot comparison in CI: ${name}`);
    return;
  }

  await compare();
}
