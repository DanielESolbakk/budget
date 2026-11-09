/* eslint vitest/expect-expect: ["error", { "assertFunctionNames": ["expectTypeOf"] }] */
import { expectTypeOf, it } from "vitest";
import type { PdfImportWorkflowDependencies } from "../../src/app/import/importPdf.js";

it("requires atomic PDF persistence without offering separate job and transaction writers", () => {
  type AtomicWriter = Pick<PdfImportWorkflowDependencies, "appendImportJobAndTransactions">;
  expectTypeOf<AtomicWriter>().toEqualTypeOf<Required<AtomicWriter>>();
  expectTypeOf<Extract<keyof PdfImportWorkflowDependencies, "appendImportJob" | "appendTransactions">>()
    .toEqualTypeOf<never>();
});
