import { expect, test } from "@playwright/test";

function linearizeColorChannel(channel: string | undefined): number {
  if (channel === undefined) {
    throw new Error("Expected an RGB color channel.");
  }

  const normalized = Number(channel) / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
  const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3);
  if (channels === undefined || channels.length !== 3) {
    throw new Error(`Expected an RGB color, received "${color}".`);
  }

  const [red, green, blue] = channels.map(linearizeColorChannel);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

test("browser-preview notice text meets WCAG AA contrast on its dark header", async ({
  page,
}) => {
  await page.goto("/");

  const notice = page.getByRole("status").filter({ hasText: "Browser preview" });
  await expect(notice).toBeVisible();

  const textColors = await notice.evaluate((element) => {
    const backgroundColor = window.getComputedStyle(element).backgroundColor;
    return Array.from(element.querySelectorAll("strong, span"), (text) => ({
      foregroundColor: window.getComputedStyle(text).color,
      backgroundColor,
    }));
  });

  expect(textColors).toHaveLength(2);
  for (const { foregroundColor, backgroundColor } of textColors) {
    expect(contrastRatio(foregroundColor, backgroundColor)).toBeGreaterThanOrEqual(4.5);
  }
});
