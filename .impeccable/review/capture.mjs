import { _electron as electron } from "@playwright/test";
import { join } from "node:path";

const app = await electron.launch({
  args: [join(process.cwd(), "out", "main", "index.js")],
  env: { ...process.env, NODE_ENV: "test" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1100));
await page.screenshot({ path: ".impeccable/review/desktop.png" });
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(390, 844));
await page.screenshot({ path: ".impeccable/review/mobile.png" });
await app.close();
