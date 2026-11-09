import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/unit/dashboardApi.unit.test.ts",
      "tests/unit/dashboard-month-switch.test.ts",
      "tests/unit/exchange-rates.test.ts",
      "tests/unit/monthly-currency-dashboard.test.ts",
      "tests/integration/dashboard-query-layer.test.ts",
      "tests/integration/dashboard-view-contract.test.ts",
      "tests/integration/cashflow-scenarios-composition.test.ts",
      "tests/integration/exchange-rates-persistence.test.ts",
      "tests/integration/target-feature-pack.test.ts",
      "tests/integration/csv-import-runtime-contract.test.ts",
      "tests/integration/pending-transaction-lifecycle.test.ts",
      "tests/integration/import-history-backfill-recovery.test.ts",
      "tests/integration/ledger-schema-upgrades.test.ts",
      "tests/integration/ledger-atomic-boundaries.test.ts",
    ],
    environment: "node",
    pool: "forks",
    maxWorkers: 2,
  },
});
