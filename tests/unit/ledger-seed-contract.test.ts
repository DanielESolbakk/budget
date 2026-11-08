/* eslint vitest/expect-expect: ["error", { "assertFunctionNames": ["expectTypeOf"] }] */
import { expectTypeOf, it } from "vitest";
import type { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import type { LedgerSnapshotData } from "../../src/domain/backup/snapshotContract.js";

type Seed = NonNullable<Parameters<typeof createLocalLedgerDatabase>[0]["seedData"]>;
type RequiredKeys<T> = { [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? never : K }[keyof T];

it("keeps seed collections required and excludes the snapshot creation timestamp", () => {
  expectTypeOf<Seed>().toEqualTypeOf<Omit<LedgerSnapshotData, "createdAtIso">>();
  expectTypeOf<RequiredKeys<Seed>>()
    .toEqualTypeOf<"household" | "accounts" | "transactions" | "importJobs" | "monthlyCategoryTargets">();
  expectTypeOf<Extract<keyof Seed, "createdAtIso">>().toEqualTypeOf<never>();
});
