import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withIsolatedLedger } from "../helpers/isolatedLedger.js";
import type { LocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";

describe("isolated ledger lifecycle", () => {
  it("removes only its directory and closes the database when an assertion fails", async () => {
    const unrelated = mkdtempSync(join(tmpdir(), "budget-unrelated-ledger-"));
    writeFileSync(join(unrelated, "keep.txt"), "keep");
    let ownedPath = "";
    let closedLedger: LocalLedgerDatabase | undefined;
    try {
      await expect(withIsolatedLedger({}, ({ ledger, directory }) => {
        ownedPath = directory;
        closedLedger = ledger;
        expect(ledger.loadLedgerSnapshotData().household?.id).toBe("hh-isolated");
        throw new Error("synthetic assertion failure");
      })).rejects.toThrow("synthetic assertion failure");
      expect(existsSync(ownedPath)).toBe(false);
      expect(() => closedLedger?.loadLedgerSnapshotData()).toThrow(/closed|not open/i);
      expect(existsSync(join(unrelated, "keep.txt"))).toBe(true);
    } finally {
      rmSync(unrelated, { recursive: true, force: true });
    }
  });
  it("awaits asynchronous work before closing and cleaning its ledger", async () => {
    let ownedPath = "";
    const result = await withIsolatedLedger({}, async ({ ledger, directory, dbPath }) => {
      ownedPath = directory;
      await Promise.resolve();
      expect(existsSync(dbPath)).toBe(true);
      expect(ledger.loadLedgerSnapshotData().accounts).toHaveLength(1);
      return "completed";
    });
    expect(result).toBe("completed");
    expect(existsSync(ownedPath)).toBe(false);
  });
});
