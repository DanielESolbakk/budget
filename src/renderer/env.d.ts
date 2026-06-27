import type { BudgetApi } from "./preload.js";

declare global {
  interface Window {
    budgetApi: BudgetApi;
  }
}
