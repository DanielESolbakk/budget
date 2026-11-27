import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
import { buildBackupSnapshot, createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import type { TransactionCategoryEditContext } from "../../src/shared/transactionCategoryEdit.js";

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
    open: async (...args: Parameters<typeof actual.open>) => {
      if (args[0] === harness.readGate.filePath) {
        harness.readGate.onEnter?.();
        await harness.readGate.wait;
      }
      return actual.open(...args);
    },
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

  it("keeps mortgage HTML paths inside main-process file selection", async () => {
    createHousehold();
    const dialogSetting = process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"];
    const pathsSetting = process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"];
    const selectedPath = join(
      process.cwd(),
      "tests",
      "fixtures",
      "synthetic",
      "rogaland-2026-11-mortgage-details.html"
    );
    const target = { kind: "new-source-only", label: "Synthetic mortgage", currencyCode: "NOK" };
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = "selected";
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = JSON.stringify([selectedPath]);
    try {
      await expect(Promise.resolve().then(() => invoke("mortgageImport:previewFiles", {
        target,
        filePaths: [selectedPath],
        attachmentConfirmed: true,
      }))).rejects.toThrow("Mortgage file paths must be chosen by the desktop dialog.");

      const preview = await invoke("mortgageImport:previewFiles", {
        target,
        requestId: "mortgage-registration-request",
      });
      expect(preview).toMatchObject({
        target,
        documents: [{ role: "details" }],
        reviewState: "attachment-confirmation-required",
      });
      expect(preview).not.toHaveProperty("filePaths");
      if (
        typeof preview !== "object" ||
        preview === null ||
        !("previewId" in preview) ||
        typeof preview.previewId !== "string"
      ) {
        throw new Error("Expected mortgage preview to have an id.");
      }
      const confirmedPreview = await invoke("mortgageImport:confirmAttachment", preview.previewId);
      expect(confirmedPreview).toMatchObject({
        previewId: preview.previewId,
        attachment: { status: "confirmed", verification: "explicit-user-attachment" },
        reviewState: "details-checks-passed",
      });
      await invoke("mortgageImport:cancelPreview", preview.previewId);
      expect(() => invoke("dialog:chooseMortgageHtmlPaths")).toThrow("Missing channel/window");
    } finally {
      if (dialogSetting === undefined) delete process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"];
      else process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = dialogSetting;
      if (pathsSetting === undefined) delete process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"];
      else process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = pathsSetting;
    }
  });

  it("rejects an invalid selected currency for source-only mortgage imports at IPC", async () => {
    createHousehold();
    const dialogSetting = process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"];
    const pathsSetting = process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"];
    const selectedPath = join(
      process.cwd(),
      "tests",
      "fixtures",
      "synthetic",
      "rogaland-2026-11-mortgage-details.html"
    );
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = "selected";
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = JSON.stringify([selectedPath]);
    try {
      await expect(Promise.resolve().then(() => invoke("mortgageImport:previewFiles", {
        target: {
          kind: "new-source-only",
          label: "Synthetic mortgage",
          currencyCode: "not-a-currency",
        },
        requestId: "mortgage-invalid-currency-request",
      }))).rejects.toThrow("currencyCode must be a three-letter currency code.");
    } finally {
      if (dialogSetting === undefined) delete process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"];
      else process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = dialogSetting;
      if (pathsSetting === undefined) delete process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"];
      else process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = pathsSetting;
    }
  });

  it("cancels a mortgage file read through its preview request ID", async () => {
    createHousehold();
    const dialogSetting = process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"];
    const pathsSetting = process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"];
    const selectedPath = join(
      process.cwd(),
      "tests",
      "fixtures",
      "synthetic",
      "rogaland-2026-11-mortgage-details.html"
    );
    const requestId = "mortgage-cancel-in-flight";
    let releaseRead: (() => void) | undefined;
    let resolveReadEntered: (() => void) | undefined;
    const readEntered = new Promise<void>((resolve) => {
      resolveReadEntered = resolve;
    });
    harness.readGate.filePath = selectedPath;
    harness.readGate.wait = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    harness.readGate.onEnter = () => resolveReadEntered?.();
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = "selected";
    process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = JSON.stringify([selectedPath]);

    try {
      const previewPromise = Promise.resolve(invoke("mortgageImport:previewFiles", {
        target: { kind: "new-source-only", label: "Synthetic mortgage", currencyCode: "NOK" },
        requestId,
      }));
      await readEntered;
      const cancellationResponse = await Promise.resolve(
        invoke("mortgageImport:cancelPreview", requestId)
      );
      releaseRead?.();
      const outcome = await Promise.allSettled([previewPromise]);

      expect(cancellationResponse).toBe(true);
      expect(outcome[0]?.status).toBe("rejected");
      expect(invoke("mortgageImport:listEvidenceSummaries")).toEqual([]);
    } finally {
      releaseRead?.();
      harness.readGate.filePath = "";
      delete harness.readGate.wait;
      delete harness.readGate.onEnter;
      if (dialogSetting === undefined) delete process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"];
      else process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_DIALOG"] = dialogSetting;
      if (pathsSetting === undefined) delete process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"];
      else process.env["BUDGET_TEST_MORTGAGE_HTML_IMPORT_PATHS"] = pathsSetting;
    }
  });

  it("persists category commands with main-owned identity, household, and timestamps", async () => {
    createHousehold();
    const database = createLocalLedgerDatabase({ dbPath });
    try {
      const householdId = database.loadRuntimeMetadata()!.household.id;
      const created = await Promise.resolve().then(() => invoke("category:create", {
        label: "  Car \t repairs  ",
        id: "renderer-category",
        householdId: "renderer-household",
        createdAtIso: "1970-01-01T00:00:00.000Z",
        updatedAtIso: "1970-01-01T00:00:00.000Z",
      }));
      const persisted = database.listCategories(householdId).find((category) => category.label === "Car repairs");
      expect(persisted).toMatchObject({ label: "Car repairs", householdId });
      if (persisted === undefined) throw new Error("Expected persisted category.");
      expect(persisted.id).not.toBe("renderer-category");
      expect(persisted.createdAtIso).not.toBe("1970-01-01T00:00:00.000Z");
      expect(created).toEqual(persisted);
      await expect(Promise.resolve().then(() => invoke("category:rename", {
        categoryId: persisted.id, label: " Vehicle \t maintenance ",
      }))).resolves.toMatchObject({
        id: persisted.id, label: "Vehicle maintenance", householdId, createdAtIso: persisted.createdAtIso,
      });
      expect(invoke("category:list")).toEqual(database.listCategories(householdId));
      expect(database.listCategories(householdId)).toContainEqual(expect.objectContaining({
        id: persisted.id, label: "Vehicle maintenance",
      }));
    } finally {
      database.close();
    }
  });

  it("rejects malformed and duplicate category commands without changing the catalog", async () => {
    createHousehold();
    const database = createLocalLedgerDatabase({ dbPath });
    try {
      const householdId = database.loadRuntimeMetadata()!.household.id;
      const before = database.listCategories(householdId);
      const requests = [
        { channel: "category:create", input: [], error: /object/i },
        { channel: "category:create", input: { label: 42 }, error: /label/i },
        { channel: "category:create", input: { label: "" }, error: /label/i },
        { channel: "category:create", input: { label: " groceries \t & food " }, error: /already exists/i },
        { channel: "category:rename", input: { categoryId: 42, label: "Food" }, error: /categoryId/i },
        { channel: "category:rename", input: { categoryId: "missing", label: "Food" }, error: /not found/i },
      ];
      for (const { channel, input, error } of requests) {
        await expect(Promise.resolve().then(() => invoke(channel, input))).rejects.toThrow(error);
        expect(database.listCategories(householdId)).toEqual(before);
      }
    } finally {
      database.close();
    }
  });

  it("normalizes request whitespace when renaming a category through IPC", async () => {
    createHousehold();
    const database = createLocalLedgerDatabase({ dbPath });
    try {
      const householdId = database.loadRuntimeMetadata()!.household.id;
      database.createCategoryRecord({
        id: "category-workshop", householdId, label: "Workshop",
        createdAtIso: "2026-05-01T00:00:00.000Z", updatedAtIso: "2026-05-01T00:00:00.000Z",
      });
      await expect(Promise.resolve().then(() => invoke("category:rename", {
        categoryId: " category-workshop ", label: "Vehicle repairs",
      }))).resolves.toMatchObject({ id: "category-workshop", label: "Vehicle repairs" });
      expect(database.listCategories(householdId)).toContainEqual(expect.objectContaining({
        id: "category-workshop", label: "Vehicle repairs",
      }));
    } finally {
      database.close();
    }
  });

  it("rejects category access before household setup instead of returning an empty catalog", async () => {
    await expect(Promise.resolve().then(() => invoke("category:list"))).rejects.toThrow(/household/i);
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

  it("creates an account through trusted IPC and refreshes the current household context", async () => {
    createHousehold();

    await expect(Promise.resolve().then(() => invoke("account:create", {
      accountName: "  Savings  ",
      currencyCode: "sek",
    }))).resolves.toMatchObject({
      householdId: (invoke("account:getCurrent") as { householdId: string }).householdId,
      name: "Savings",
      currencyCode: "SEK",
    });
    expect((invoke("account:getCurrent") as { accounts: unknown[] }).accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Daily", currencyCode: "NOK" }),
        expect.objectContaining({ name: "Savings", currencyCode: "SEK" }),
      ])
    );
  });

  it("updates an account through trusted IPC and refreshes the current household context", async () => {
    createHousehold();
    const current = invoke("account:getCurrent") as { accounts: Array<{ id: string }> };
    const account = current.accounts[0];
    if (account === undefined) throw new Error("Initial account is unavailable.");

    await expect(Promise.resolve().then(() => invoke("account:update", {
      accountId: account.id,
      accountName: "  Main account  ",
      currencyCode: "sek",
    }))).resolves.toMatchObject({
      id: account.id,
      name: "Main account",
      currencyCode: "SEK",
    });
    expect(invoke("account:getCurrent")).toMatchObject({
      accounts: [{ id: account.id, name: "Main account", currencyCode: "SEK" }],
    });
  });

  it("rejects invalid account details without adding an account", async () => {
    createHousehold();

    await expect(Promise.resolve().then(() => invoke("account:create", {
      accountName: " ",
      currencyCode: "NOK",
    }))).rejects.toThrow("Enter an account name.");
    expect(invoke("account:getCurrent")).toMatchObject({
      accounts: [{ name: "Daily", currencyCode: "NOK" }],
    });
  });

  it.each([
    ["csv", "rogaland-2026-05-synthetic.csv"],
    ["pdf", "rogaland-2026-05-statement.txt"],
  ])("excludes archived accounts from %s import targets and rejects stale selections", async (format, fixture) => {
    createHousehold();
    const archivedAccount = (invoke("account:getCurrent") as {
      accounts: Array<{ id: string }>;
    }).accounts[0];
    if (archivedAccount === undefined) throw new Error("Initial account is unavailable.");
    const activeAccount = await invoke("account:create", {
      accountName: "Savings",
      currencyCode: "NOK",
    }) as { id: string };
    const filePath = join(process.cwd(), "tests", "fixtures", "synthetic", fixture);
    const stalePreviewId = previewId(await invoke(`import:${format}Preview`, {
      filePath,
      accountId: archivedAccount.id,
    }));

    await invoke("account:archive", archivedAccount.id);
    expect(invoke("account:getCurrent")).toMatchObject({
      accounts: [{ id: activeAccount.id }],
    });

    const activePreview = await invoke(`import:${format}Preview`, { filePath });
    expect(activePreview).toMatchObject({
      ok: true,
      transactions: expect.arrayContaining([
        expect.objectContaining({ accountId: activeAccount.id }),
      ]),
    });
    const archivedPreview = await invoke(`import:${format}Preview`, {
      filePath,
      accountId: archivedAccount.id,
    });
    expect(archivedPreview).toMatchObject(format === "csv"
      ? { ok: false, code: "INVALID_ACCOUNT_ID" }
      : { ok: false, errors: [{ code: "INVALID_ACCOUNT_ID" }] });

    const ledger = createLocalLedgerDatabase({ dbPath });
    try {
      const beforeImport = ledger.loadLedgerSnapshotData();
      const staleImport = await invoke(`import:${format}`, {
        filePath,
        previewId: stalePreviewId,
        accountId: archivedAccount.id,
      });
      expect(staleImport).toMatchObject(format === "csv"
        ? { ok: false, errors: [{ codes: ["INVALID_ACCOUNT_ID"] }] }
        : { ok: false, errors: [{ code: "INVALID_ACCOUNT_ID" }] });
      const afterImport = ledger.loadLedgerSnapshotData();
      expect(afterImport.transactions).toEqual(beforeImport.transactions);
      expect(afterImport.importJobs).toEqual(beforeImport.importJobs);
    } finally {
      ledger.close();
    }
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
    const twoDateRule = {
      type: "two-fixed-days",
      firstDayOfMonth: 15,
      secondDayOfMonth: 31,
    };
    expect(await invoke("reportingPreferences:savePeriodRule", twoDateRule)).toEqual(twoDateRule);
    expect(invoke("reportingPreferences:getPeriodRule")).toEqual(twoDateRule);
    expect(await invoke(
      "dashboard:getViewData",
      "2026-02",
      twoDateRule,
      "2026-02-28"
    )).toMatchObject({
      state: "empty",
      snapshot: {
        reportingPeriodRange: {
          startDateIso: "2026-02-28",
          endDateExclusiveIso: "2026-03-15",
        },
      },
    });
    await expect(Promise.resolve().then(() => invoke("reportingPreferences:savePeriodRule", {
      type: "two-fixed-days", firstDayOfMonth: 28, secondDayOfMonth: 29,
    }))).rejects.toThrow("Reporting period preference is malformed.");
    expect(invoke("reportingPreferences:getPeriodRule"))
      .toEqual(twoDateRule);
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

  it("rejects a malformed category snapshot through restore IPC without replacing destination data or runtime", async () => {
    createHousehold();
    const database = createLocalLedgerDatabase({ dbPath });
    try {
      const metadata = database.loadRuntimeMetadata();
      if (metadata === null || metadata.accounts[0] === undefined) throw new Error("Expected a synthetic household.");
      database.appendTransactions([{
        id: "protected-transaction", householdId: metadata.household.id, accountId: metadata.accounts[0].id,
        bookedAtIso: "2026-05-23", amountMinor: -12345, currencyCode: "NOK",
        merchantRaw: "Synthetic protected workshop", categoryId: "groceries",
      }]);
      const original = database.loadLedgerSnapshotData();
      const accountContext = invoke("account:getCurrent");
      const snapshotPath = join(directory, "invalid-category-restore.json");
      writeFileSync(snapshotPath, JSON.stringify({
        ...buildBackupSnapshot(original), categories: [],
      }), "utf8");
      await expect(invoke("backup:restore", { snapshotPath })).rejects.toThrow(/Invalid snapshot categories/i);
      expect(database.loadLedgerSnapshotData()).toEqual(original);
      expect(database.listBackupSnapshots()).toEqual([]);
      expect(invoke("account:getCurrent")).toEqual(accountContext);
      expect(await invoke("transaction:list")).toMatchObject({
        transactions: [{ id: "protected-transaction", amountMinor: -12345, categoryId: "groceries" }],
      });
    } finally {
      database.close();
    }
    const reopened = createLocalLedgerDatabase({ dbPath });
    try {
      expect(reopened.getTransactionById("protected-transaction")).toMatchObject({
        amountMinor: -12345, categoryId: "groceries",
      });
    } finally {
      reopened.close();
    }
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

  it("rejects an open category edit after restore and a repeated committed edit without partial writes", async () => {
    createHousehold();
    const snapshotPath = writeReplacementSnapshot();
    const snapshot = restoreBackupSnapshot({ snapshotPath });
    writeFileSync(snapshotPath, JSON.stringify(buildBackupSnapshot({
      ...snapshot,
      transactions: snapshot.transactions.flatMap((transaction) => [
        {
          ...transaction,
          categoryAllocations: [
            { categoryId: "groceries", amountMinor: -1000 },
            { categoryId: "transport", amountMinor: -1500 },
          ],
        },
        { ...transaction, id: "filtered-before", merchantRaw: "Z synthetic" },
        { ...transaction, id: "filtered-after", merchantRaw: "A synthetic" },
      ]),
      merchantCategoryRules: [{ merchantAlias: "KIWI", categoryId: "transport" }],
    })), "utf8");
    await invoke("backup:restore", { snapshotPath });
    const context = await invoke(
      "transaction:categoryEditContext", "restored-transaction"
    ) as TransactionCategoryEditContext;
    const staleRequest = {
      transactionId: "restored-transaction",
      expectedState: context.expectedState,
      mode: "single",
      categoryId: "housing",
      rememberForMerchant: true,
    };

    await invoke("backup:restore", { snapshotPath });
    const database = createLocalLedgerDatabase({ dbPath });
    try {
      const restored = database.loadLedgerSnapshotData();
      expect(await invoke("transaction:editCategory", staleRequest))
        .toMatchObject({ ok: false, code: "STALE_EDIT" });
      const afterStaleEdit = database.loadLedgerSnapshotData();
      expect(afterStaleEdit.transactions).toEqual(restored.transactions);
      expect(afterStaleEdit.merchantCategoryRules).toEqual(restored.merchantCategoryRules);
      expect(afterStaleEdit.recoveryHistory).toEqual(restored.recoveryHistory);
      const afterRestore = await invoke(
        "transaction:categoryEditContext", "restored-transaction"
      ) as TransactionCategoryEditContext;
      expect(afterRestore.transaction).toEqual(context.transaction);
      expect(afterRestore.transaction.categoryAllocations).toEqual([
        { categoryId: "groceries", amountMinor: -1000 },
        { categoryId: "transport", amountMinor: -1500 },
      ]);
      expect(afterRestore.merchantCategoryRule)
        .toEqual({ merchantAlias: "KIWI", categoryId: "transport" });
      expect(afterRestore.expectedState.databaseGeneration)
        .toBe(context.expectedState.databaseGeneration + 1);

      const query = Object.freeze({
        categoryId: "groceries", sortBy: "merchantRaw", sortDirection: "desc", page: 2, pageSize: 1,
      });
      expect(await invoke("transaction:list", query)).toMatchObject({
        transactions: [{ id: "restored-transaction" }], totalCount: 3, page: 2, pageSize: 1,
      });
      const request = { ...staleRequest, expectedState: afterRestore.expectedState };
      expect(await invoke("transaction:editCategory", request))
        .toMatchObject({ ok: true, transactionChanged: true, merchantRuleEffect: "updated" });
      expect(await invoke("transaction:list", query)).toMatchObject({
        transactions: [{ id: "filtered-after" }], totalCount: 2, page: 2, pageSize: 1,
      });
      expect(query).toEqual({
        categoryId: "groceries", sortBy: "merchantRaw", sortDirection: "desc", page: 2, pageSize: 1,
      });
      const committed = database.loadLedgerSnapshotData();
      expect(await invoke("transaction:editCategory", request))
        .toMatchObject({ ok: false, code: "STALE_EDIT" });
      expect(database.loadLedgerSnapshotData()).toEqual(committed);
      expect(database.getTransactionById("restored-transaction"))
        .toMatchObject({ amountMinor: -2500, categoryId: "housing" });
      expect(database.getTransactionById("restored-transaction")?.categoryAllocations).toBeUndefined();
      expect(database.listMerchantCategoryRules())
        .toEqual([{ merchantAlias: "KIWI", categoryId: "housing" }]);
      expect(database.loadLedgerSnapshotData().recoveryHistory?.transactionCategoryEdits)
        .toHaveLength(1);
    } finally {
      database.close();
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

  it("serializes account creation with restore and applies it to the restored household", async () => {
    createHousehold();
    const snapshotPath = writeReplacementSnapshot();
    const recoveryDelayVariable = "BUDGET_TEST_RECOVERY_OPERATION_DELAY_MS";
    const originalRecoveryDelay = process.env[recoveryDelayVariable];
    vi.stubEnv(recoveryDelayVariable, "100");
    const restore = Promise.resolve(invoke("backup:restore", { snapshotPath }));
    await Promise.resolve();

    let accountCreated = false;
    const createAccount = Promise.resolve(invoke("account:create", {
      accountName: "Savings",
      currencyCode: "SEK",
    })).then((account) => {
      accountCreated = true;
      return account;
    });

    await Promise.resolve();
    const createdBeforeRestore = accountCreated;
    try {
      await restore;
    } finally {
      if (originalRecoveryDelay === undefined) delete process.env[recoveryDelayVariable];
      else process.env[recoveryDelayVariable] = originalRecoveryDelay;
    }
    expect(createdBeforeRestore).toBe(false);
    await expect(createAccount).resolves.toMatchObject({
      householdId: "restored-household",
      name: "Savings",
      currencyCode: "SEK",
    });
    expect(invoke("account:getCurrent")).toMatchObject({
      householdId: "restored-household",
      accounts: expect.arrayContaining([
        expect.objectContaining({ id: "restored-account" }),
        expect.objectContaining({ name: "Savings", currencyCode: "SEK" }),
      ]),
    });
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
