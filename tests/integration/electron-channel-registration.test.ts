import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";

const harness = vi.hoisted(() => {
  const handlers = new Map<string, (event: object, ...args: unknown[]) => unknown>();
  const ready: Array<() => Promise<void>> = [];
  const appEvents = new Map<string, () => void>();
  const windows: Array<{ webContents: { mainFrame: { url: string }; send: ReturnType<typeof vi.fn> } }> = [];
  const readGate: { filePath: string; wait?: Promise<void>; onEnter?: () => void } = { filePath: "" };
  return { handlers, ready, appEvents, windows, readGate, dialogs: vi.fn() };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (args[0] === harness.readGate.filePath) {
        harness.readGate.onEnter?.();
        await harness.readGate.wait;
      }
      return actual.readFile(...args);
    },
  };
});

vi.mock("electron", () => ({
  app: {
    whenReady: () => ({
      then: (callback: () => Promise<void>) => harness.ready.push(callback),
    }),
    on: (name: string, callback: () => void) => harness.appEvents.set(name, callback),
    quit: vi.fn(),
  },
  BrowserWindow: class {
    webContents = { mainFrame: { url: "" }, send: vi.fn() };
    constructor() { harness.windows.push(this); }
    static getAllWindows() { return harness.windows; }
    on() {}
    loadURL(url: string) { this.webContents.mainFrame.url = url; }
    loadFile() {}
  },
  ipcMain: {
    handle: (name: string, handler: (event: object, ...args: unknown[]) => unknown) => {
      if (harness.handlers.has(name)) throw new Error(`Duplicate channel: ${name}`);
      harness.handlers.set(name, handler);
    },
  },
  session: { defaultSession: { webRequest: { onBeforeRequest: vi.fn() } } },
  dialog: { showSaveDialog: harness.dialogs, showOpenDialog: harness.dialogs },
}));

let directory: string;
let dbPath: string;

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = harness.handlers.get(channel);
  const window = harness.windows[0];
  if (handler === undefined || window === undefined) throw new Error(`Missing channel/window: ${channel}`);
  return handler({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, ...args);
}

function previewId(response: unknown): string {
  if (typeof response !== "object" || response === null ||
    !("ok" in response) || response.ok !== true ||
    !("previewId" in response) || typeof response.previewId !== "string") {
    throw new Error(`Expected a successful preview: ${JSON.stringify(response)}`);
  }
  return response.previewId;
}

function createHousehold(): void {
  invoke("setup:create", { householdName: "Synthetic home", accountName: "Daily", currencyCode: "NOK" });
}

function writeReplacementSnapshot(): string {
  const snapshotPath = join(directory, "replacement.json");
  createBackupSnapshot({
    outputPath: snapshotPath,
    household: { id: "restored-household", name: "Restored home", createdAtIso: "2026-01-01T00:00:00Z" },
    accounts: [{ id: "restored-account", householdId: "restored-household", name: "Restored account", currencyCode: "NOK" }],
    transactions: [{
      id: "restored-transaction", householdId: "restored-household", accountId: "restored-account",
      bookedAtIso: "2026-05-05T12:00:00Z", amountMinor: -2500, merchantRaw: "Kiwi", categoryId: "groceries",
    }],
    importJobs: [],
    monthlyCategoryTargets: [{ yearMonth: "2026-05", categoryId: "groceries", targetMinor: 5000 }],
  });
  return snapshotPath;
}

describe("Electron channel registration and live ledger wiring", () => {
  beforeEach(async () => {
    vi.resetModules();
    harness.handlers.clear();
    harness.ready.length = 0;
    harness.appEvents.clear();
    harness.windows.length = 0;
    harness.dialogs.mockReset();
    harness.readGate.filePath = "";
    delete harness.readGate.wait;
    delete harness.readGate.onEnter;
    directory = mkdtempSync(join(tmpdir(), "budget-channel-boundary-"));
    dbPath = join(directory, "ledger.sqlite");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BUDGET_TEST_LEDGER_SEED", "empty");
    vi.stubEnv("BUDGET_DB_PATH", dbPath);
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://127.0.0.1:5173");
    vi.stubGlobal("__dirname", join(process.cwd(), "electron"));
    await import("../../electron/main.js");
    const start = harness.ready[0];
    if (start === undefined || harness.ready.length !== 1) throw new Error("Expected one Electron startup callback.");
    await start();
  });

  afterEach(() => {
    harness.appEvents.get("window-all-closed")?.();
    rmSync(directory, { recursive: true, force: true });
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("registers every preload invocation once without executing dialogs or writes", async () => {
    const { readFileSync } = await import("node:fs");
    const { createSourceFile, forEachChild, isCallExpression, isStringLiteral, ScriptTarget } =
      await import("typescript");
    const preload = createSourceFile("preload.ts",
      readFileSync(join(process.cwd(), "src", "renderer", "preload.ts"), "utf8"), ScriptTarget.Latest);
    const channels = new Set<string>();
    const visit = (node: import("typescript").Node): void => {
      if (isCallExpression(node) && node.expression.getText(preload) === "ipcRenderer.invoke") {
        const channel = node.arguments[0];
        if (channel !== undefined && isStringLiteral(channel)) channels.add(channel.text);
      }
      forEachChild(node, visit);
    };
    visit(preload);
    expect(channels.size).toBeGreaterThan(50);
    expect([...harness.handlers.keys()].sort()).toEqual([...channels].sort());
    expect(harness.dialogs).not.toHaveBeenCalled();
    expect(invoke("setup:isRequired")).toBe(true);
  });

  it("rejects foreign senders, child frames and foreign origins on every channel before side effects", async () => {
    const window = harness.windows[0]!;
    const events = [
      { sender: {}, senderFrame: {} },
      { sender: window.webContents, senderFrame: { url: "http://127.0.0.1:5173" } },
      { sender: window.webContents, senderFrame: window.webContents.mainFrame },
    ];
    const filesBefore = readdirSync(directory).sort();
    window.webContents.mainFrame.url = "https://untrusted.invalid";
    try {
      for (const event of events) {
        for (const handler of harness.handlers.values()) {
          await expect(Promise.resolve().then(() => handler(event, {})))
            .rejects.toThrow("Untrusted renderer sender.");
        }
      }
    } finally {
      window.webContents.mainFrame.url = "http://127.0.0.1:5173";
    }
    expect(harness.dialogs).not.toHaveBeenCalled();
    expect(readdirSync(directory).sort()).toEqual(filesBefore);
    expect(invoke("setup:isRequired")).toBe(true);
  });

  it("keeps setup validation and current household/account state visible to separate channel groups", async () => {
    await expect(Promise.resolve().then(() => invoke("setup:create", {
      householdName: " ", accountName: "Daily", currencyCode: "NOK",
    }))).rejects.toThrow("Enter a household name.");
    expect(invoke("setup:isRequired")).toBe(true);
    invoke("setup:create", { householdName: " Synthetic home ", accountName: " Daily ", currencyCode: " nok " });
    expect(invoke("setup:isRequired")).toBe(false);
    expect(invoke("account:getCurrent")).toMatchObject({
      householdName: "Synthetic home", accounts: [{ name: "Daily", currencyCode: "NOK" }],
    });
    const reopened = createLocalLedgerDatabase({ dbPath });
    try {
      expect(reopened.loadRuntimeMetadata()).toMatchObject({
        household: { name: "Synthetic home" }, accounts: [{ name: "Daily", currencyCode: "NOK" }],
      });
    } finally {
      reopened.close();
    }
    expect(await invoke("dashboard:getViewData", "2026-05")).toMatchObject({ state: "empty" });
  });

  it("loads and saves validated reporting-period preferences through trusted IPC", async () => {
    createHousehold();
    expect(invoke("reportingPreferences:getPeriodRule")).toEqual({ type: "calendar-month" });
    expect(await invoke("reportingPreferences:savePeriodRule", {
      type: "last-weekday",
      weekday: 4,
    })).toEqual({ type: "last-weekday", weekday: 4 });
    expect(invoke("reportingPreferences:getPeriodRule"))
      .toEqual({ type: "last-weekday", weekday: 4 });
    await expect(Promise.resolve().then(() => invoke("reportingPreferences:savePeriodRule", {
      type: "fixed-day", dayOfMonth: 32,
    }))).rejects.toThrow("Reporting period preference is malformed.");
    expect(invoke("reportingPreferences:getPeriodRule"))
      .toEqual({ type: "last-weekday", weekday: 4 });
  });

  it("preserves cancellation results for every chooser without creating files", async () => {
    const filesBefore = readdirSync(directory).sort();
    harness.dialogs.mockResolvedValue({ canceled: true, filePaths: [], filePath: "" });
    for (const channel of [
      "dialog:chooseCsvExportPath", "dialog:chooseImportStatementPath",
      "dialog:chooseBackupOutputPath", "dialog:chooseRestoreSnapshotPath",
      "exchangeRate:importFromFile",
    ]) {
      expect(await invoke(channel)).toBeNull();
    }
    expect(readdirSync(directory).sort()).toEqual(filesBefore);
  });

  it.each([
    ["csv", "rogaland-2026-05-synthetic.csv", { ok: false, code: "PREVIEW_CANCELLED" }],
    ["pdf", "rogaland-2026-05-statement.txt", { ok: false, errors: [{ code: "PREVIEW_CANCELLED" }] }],
  ])("cancels a real %s preflight and cleans its request identity before retry", async (format, fixture, expected) => {
    createHousehold();
    const requestId = `cancel-${format}`;
    const filePath = join(process.cwd(), "tests", "fixtures", "synthetic", fixture);
    harness.windows[0]!.webContents.send.mockImplementation((_channel, progress) => {
      invoke("import:preflight:cancel", progress.requestId);
    });
    try {
      const cancelled = await invoke(`import:${format}Preview`, { requestId, filePath });
      expect(cancelled).toMatchObject(expected);
    } finally {
      harness.windows[0]!.webContents.send.mockReset();
    }
    expect(invoke("import:preflight:cancel", requestId)).toBe(false);
    previewId(await invoke(`import:${format}Preview`, { requestId, filePath }));
    expect(await invoke("import:history:list")).toEqual([]);
  });

  it("uses restored household/accounts/targets across channel groups and invalidates both preview formats", async () => {
    createHousehold();
    const csvFile = join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-05-synthetic.csv");
    const pdfFile = join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-05-statement.txt");
    const csvPreviewId = previewId(await invoke("import:csvPreview", { filePath: csvFile }));
    const pdfPreviewId = previewId(await invoke("import:pdfPreview", { filePath: pdfFile }));
    const snapshotPath = writeReplacementSnapshot();
    await invoke("backup:restore", { snapshotPath });
    expect(invoke("account:getCurrent")).toMatchObject({
      householdId: "restored-household", householdName: "Restored home",
      accounts: [{ id: "restored-account" }],
    });
    expect(await invoke("dashboard:getViewData", "2026-05")).toMatchObject({
      state: "ready", snapshot: { monthlyTotals: { expenseMinor: 2500 } },
    });
    expect(invoke("categoryTarget:listByMonth", "2026-05")).toEqual([
      { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 5000 },
    ]);
    expect(await invoke("transaction:list")).toMatchObject({
      transactions: [{ id: "restored-transaction" }], accounts: [{ id: "restored-account" }],
    });
    expect(await invoke("import:csv", { filePath: csvFile, previewId: csvPreviewId })).toMatchObject({
      ok: false, errors: [{ codes: ["PREVIEW_NOT_FOUND"] }],
    });
    expect(await invoke("import:pdf", { filePath: pdfFile, previewId: pdfPreviewId })).toMatchObject({
      ok: false, errors: [{ code: "PREVIEW_NOT_FOUND" }],
    });
    const reopened = createLocalLedgerDatabase({ dbPath });
    try {
      expect(reopened.loadLedgerSnapshotData().transactions.map(({ id }) => id))
        .toEqual(["restored-transaction"]);
    } finally {
      reopened.close();
    }
  });

  it("serializes writes from different groups with recovery on the same coordinator", async () => {
    createHousehold();
    const outputPath = join(directory, "before-target.json");
    const backup = invoke("backup:create", outputPath);
    const update = invoke("categoryTarget:upsert", {
      yearMonth: "2026-05", categoryId: "groceries", targetMinor: 7500,
    });
    await update;
    await backup;
    expect(restoreBackupSnapshot({ snapshotPath: outputPath }).monthlyCategoryTargets).toEqual([]);
    expect(invoke("categoryTarget:listByMonth", "2026-05")).toEqual([
      { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 7500 },
    ]);
  });

  it.each([
    ["csv", "rogaland-2026-05-synthetic.csv", { ok: false, code: "PREVIEW_STALE" }],
    ["pdf", "rogaland-2026-05-statement.txt", {
      ok: false, errors: [{ code: "FILE_READ_ERROR", message: "The ledger changed while the statement was being checked. Preview the statement again." }],
    }],
  ])("rejects a %s preview whose real file read spans a restore", async (format, fixture, expected) => {
    createHousehold();
    const requestId = `restore-race-${format}`;
    const filePath = join(process.cwd(), "tests", "fixtures", "synthetic", fixture);
    const snapshotPath = writeReplacementSnapshot();
    let release!: () => void;
    const reading = new Promise<void>((resolve) => { harness.readGate.onEnter = resolve; });
    harness.readGate.filePath = filePath;
    harness.readGate.wait = new Promise<void>((resolve) => { release = resolve; });
    const pending = invoke(`import:${format}Preview`, { filePath, requestId });
    await reading;
    try {
      await invoke("backup:restore", { snapshotPath });
    } finally {
      release();
    }
    expect(await pending).toMatchObject(expected);
    expect(invoke("import:preflight:cancel", requestId)).toBe(false);
    expect(invoke("import:history:list")).toEqual([]);
  });
});
