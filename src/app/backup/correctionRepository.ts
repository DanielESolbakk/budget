import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createCorrectionProvenance } from "../../domain/review/correction.js";
import { normalizeMerchantName } from "../../domain/merchant/normalizeMerchantName.js";
import type {
  CategorizationDecision,
  MerchantCorrectionProvenance,
  MerchantCategoryRule,
  SameMerchantPropagationInput,
  SameMerchantPropagationOperation,
} from "../../domain/types.js";
import type { LocalLedgerDatabase } from "./localLedgerContracts.js";

type CorrectionRepository = Pick<LocalLedgerDatabase,
  | "updateTransactionCategory"
  | "updateTransactionCategoryAndRule"
  | "listMerchantCorrectionProvenance"
  | "applySameMerchantPropagation"
  | "listSameMerchantPropagationOperations"
  | "undoSameMerchantPropagation"
  | "listMerchantCategoryRules"
  | "upsertMerchantCategoryRule"
>;

export function createCorrectionRepository(db: DatabaseSync): CorrectionRepository {
  function updateTransactionCategory(transactionId: string, categoryId: string): void {
    const result = db
      .prepare("UPDATE transactions SET category_id = ? WHERE id = ?")
      .run(categoryId, transactionId) as { changes: number | bigint };

    if (Number(result.changes) !== 1) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }
  }

  function updateTransactionCategoryAndRule(
    transactionId: string,
    rule: MerchantCategoryRule,
    categorization?: CategorizationDecision
  ): void {
    db.exec("BEGIN");
    try {
      const originalCategorizationRow = db
        .prepare("SELECT categorization_json FROM transactions WHERE id = ?")
        .get(transactionId) as { categorization_json: string | null } | undefined;
      const correctionProvenance = createCorrectionProvenance({
        id: randomUUID(),
        sourceTransactionId: transactionId,
        merchantAlias: rule.merchantAlias,
        categoryId: rule.categoryId,
        actor: "local-user",
        correctedAtIso: new Date().toISOString(),
        ...(originalCategorizationRow?.categorization_json == null
          ? {}
          : {
              originalCategorization: JSON.parse(
                originalCategorizationRow.categorization_json
              ) as CategorizationDecision,
            }),
      });
      updateTransactionCategory(transactionId, rule.categoryId);
      if (categorization !== undefined) {
        db.prepare("UPDATE transactions SET categorization_json = ? WHERE id = ?").run(
          JSON.stringify(categorization),
          transactionId
        );
      }
      upsertMerchantCategoryRule(rule);
      db.prepare(`
        INSERT INTO merchant_correction_provenance (
          id, source_transaction_id, merchant_alias, category_id, actor, corrected_at_iso,
          original_categorization_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        correctionProvenance.id,
        correctionProvenance.sourceTransactionId,
        correctionProvenance.merchantAlias,
        correctionProvenance.categoryId,
        correctionProvenance.actor,
        correctionProvenance.correctedAtIso,
        correctionProvenance.originalCategorization === undefined
          ? null
          : JSON.stringify(correctionProvenance.originalCategorization)
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listMerchantCorrectionProvenance(): MerchantCorrectionProvenance[] {
    return db
      .prepare(`
        SELECT id, source_transaction_id, merchant_alias, category_id, actor, corrected_at_iso,
          original_categorization_json
        FROM merchant_correction_provenance
        ORDER BY corrected_at_iso, id
      `)
      .all()
      .map((row) => {
        const typedRow = row as {
          id: string;
          source_transaction_id: string;
          merchant_alias: string;
          category_id: string;
          actor: "local-user";
          corrected_at_iso: string;
          original_categorization_json: string | null;
        };
        const provenance: MerchantCorrectionProvenance = {
          id: typedRow.id,
          sourceTransactionId: typedRow.source_transaction_id,
          merchantAlias: typedRow.merchant_alias,
          categoryId: typedRow.category_id,
          actor: typedRow.actor,
          correctedAtIso: typedRow.corrected_at_iso,
        };
        if (typedRow.original_categorization_json !== null) {
          provenance.originalCategorization = JSON.parse(
            typedRow.original_categorization_json
          ) as CategorizationDecision;
        }
        return provenance;
      });
  }

  function applySameMerchantPropagation(
    input: SameMerchantPropagationInput
  ): SameMerchantPropagationOperation {
    if (input.transactionIds.length === 0) {
      throw new Error("At least one transaction must be selected for propagation.");
    }
    if (new Set(input.transactionIds).size !== input.transactionIds.length) {
      throw new Error("Propagation transaction IDs must be unique.");
    }

    const operation: SameMerchantPropagationOperation = {
      id: randomUUID(),
      sourceTransactionId: input.sourceTransactionId,
      merchantAlias: input.merchantAlias,
      categoryId: input.categoryId,
      appliedAtIso: new Date().toISOString(),
      changes: [],
    };
    const insertOperation = db.prepare(`
      INSERT INTO same_merchant_propagation_operations (
        id, source_transaction_id, merchant_alias, category_id, applied_at_iso
      ) VALUES (?, ?, ?, ?, ?)
    `);
    const getTransaction = db.prepare(
      "SELECT household_id, merchant_raw, category_id, categorization_json FROM transactions WHERE id = ?"
    );
    const insertChange = db.prepare(`
      INSERT INTO same_merchant_propagation_changes (
        operation_id, transaction_id, before_category_id, after_category_id,
        before_categorization_json, after_categorization_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const updateCategory = db.prepare(
      "UPDATE transactions SET category_id = ?, categorization_json = ? WHERE id = ? AND category_id IS NULL"
    );

    db.exec("BEGIN");
    try {
      const sourceCorrection = db.prepare(`
        SELECT 1
        FROM merchant_correction_provenance
        WHERE source_transaction_id = ? AND merchant_alias = ? AND category_id = ?
      `).get(input.sourceTransactionId, input.merchantAlias, input.categoryId);
      const sourceTransaction = getTransaction.get(input.sourceTransactionId) as
        | {
          household_id: string;
          merchant_raw: string;
          category_id: string | null;
          categorization_json: string | null;
        }
        | undefined;
      const sourceRule = db.prepare(
        "SELECT category_id FROM merchant_category_rules WHERE merchant_alias = ?"
      ).get(input.merchantAlias) as { category_id: string } | undefined;
      if (
        sourceTransaction === undefined ||
        sourceCorrection === undefined ||
        sourceTransaction.category_id !== input.categoryId ||
        normalizeMerchantName(sourceTransaction.merchant_raw) !== input.merchantAlias ||
        sourceRule?.category_id !== input.categoryId
      ) {
        throw new Error(`Source correction not found: ${input.sourceTransactionId}`);
      }

      insertOperation.run(
        operation.id,
        operation.sourceTransactionId,
        operation.merchantAlias,
        operation.categoryId,
        operation.appliedAtIso
      );
      for (const transactionId of input.transactionIds) {
        const row = getTransaction.get(transactionId) as
          | {
            household_id: string;
            merchant_raw: string;
            category_id: string | null;
            categorization_json: string | null;
          }
          | undefined;
        if (row === undefined) throw new Error(`Transaction not found: ${transactionId}`);
        if (
          row.household_id !== sourceTransaction.household_id ||
          normalizeMerchantName(row.merchant_raw) !== input.merchantAlias
        ) {
          throw new Error(`Transaction is not eligible for same-merchant propagation: ${transactionId}`);
        }
        if (row.category_id !== null) throw new Error(`Transaction is already categorized: ${transactionId}`);

        const result = updateCategory.run(
          input.categoryId,
          sourceTransaction.categorization_json,
          transactionId
        ) as { changes: number | bigint };
        if (Number(result.changes) !== 1) throw new Error(`Transaction could not be propagated: ${transactionId}`);
        insertChange.run(
          operation.id,
          transactionId,
          row.category_id,
          input.categoryId,
          row.categorization_json,
          sourceTransaction.categorization_json
        );
        operation.changes.push({
          transactionId,
          beforeCategoryId: row.category_id,
          afterCategoryId: input.categoryId,
          ...(row.categorization_json === null
            ? {}
            : { beforeCategorization: JSON.parse(row.categorization_json) as CategorizationDecision }),
          ...(sourceTransaction.categorization_json === null
            ? {}
            : { afterCategorization: JSON.parse(sourceTransaction.categorization_json) as CategorizationDecision }),
        });
      }
      db.exec("COMMIT");
      return operation;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listSameMerchantPropagationOperations(): SameMerchantPropagationOperation[] {
    const rows = db.prepare(`
      SELECT
        operation.id,
        operation.source_transaction_id,
        operation.merchant_alias,
        operation.category_id,
        operation.applied_at_iso,
        operation.undone_at_iso,
        change.transaction_id,
        change.before_category_id,
        change.after_category_id,
        change.before_categorization_json,
        change.after_categorization_json
      FROM same_merchant_propagation_operations AS operation
      LEFT JOIN same_merchant_propagation_changes AS change ON change.operation_id = operation.id
      ORDER BY operation.applied_at_iso, operation.id, change.transaction_id
    `).all() as Array<{
      id: string;
      source_transaction_id: string;
      merchant_alias: string;
      category_id: string;
      applied_at_iso: string;
      undone_at_iso: string | null;
      transaction_id: string | null;
      before_category_id: string | null;
      after_category_id: string | null;
      before_categorization_json: string | null;
      after_categorization_json: string | null;
    }>;
    const operations = new Map<string, SameMerchantPropagationOperation>();

    for (const row of rows) {
      let operation = operations.get(row.id);
      if (operation === undefined) {
        operation = {
          id: row.id,
          sourceTransactionId: row.source_transaction_id,
          merchantAlias: row.merchant_alias,
          categoryId: row.category_id,
          appliedAtIso: row.applied_at_iso,
          ...(row.undone_at_iso === null ? {} : { undoneAtIso: row.undone_at_iso }),
          changes: [],
        };
        operations.set(row.id, operation);
      }
      if (row.transaction_id !== null && row.after_category_id !== null) {
        operation.changes.push({
          transactionId: row.transaction_id,
          beforeCategoryId: row.before_category_id,
          afterCategoryId: row.after_category_id,
          ...(row.before_categorization_json === null
            ? {}
            : { beforeCategorization: JSON.parse(row.before_categorization_json) as CategorizationDecision }),
          ...(row.after_categorization_json === null
            ? {}
            : { afterCategorization: JSON.parse(row.after_categorization_json) as CategorizationDecision }),
        });
      }
    }

    return [...operations.values()];
  }

  function undoSameMerchantPropagation(operationId: string): boolean {
    db.exec("BEGIN");
    try {
      const operation = db.prepare(`
        SELECT undone_at_iso
        FROM same_merchant_propagation_operations
        WHERE id = ?
      `).get(operationId) as { undone_at_iso: string | null } | undefined;
      if (operation === undefined || operation.undone_at_iso !== null) {
        db.exec("ROLLBACK");
        return false;
      }

      const changes = db.prepare(`
        SELECT
          transaction_id,
          before_category_id,
          after_category_id,
          before_categorization_json,
          after_categorization_json
        FROM same_merchant_propagation_changes
        WHERE operation_id = ?
        ORDER BY transaction_id
      `).all(operationId) as Array<{
        transaction_id: string;
        before_category_id: string | null;
        after_category_id: string;
        before_categorization_json: string | null;
        after_categorization_json: string | null;
      }>;
      const restoreCategory = db.prepare(`
        UPDATE transactions
        SET category_id = ?, categorization_json = ?
        WHERE id = ? AND category_id = ? AND categorization_json IS ?
      `);
      for (const change of changes) {
        const result = restoreCategory.run(
          change.before_category_id,
          change.before_categorization_json,
          change.transaction_id,
          change.after_category_id,
          change.after_categorization_json
        ) as { changes: number | bigint };
        if (Number(result.changes) !== 1) {
          throw new Error(`Transaction changed since propagation: ${change.transaction_id}`);
        }
      }

      const markUndone = db.prepare(`
        UPDATE same_merchant_propagation_operations
        SET undone_at_iso = ?
        WHERE id = ? AND undone_at_iso IS NULL
      `).run(new Date().toISOString(), operationId) as { changes: number | bigint };
      if (Number(markUndone.changes) !== 1) {
        throw new Error(`Propagation operation could not be undone: ${operationId}`);
      }

      db.exec("COMMIT");
      return true;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listMerchantCategoryRules(): MerchantCategoryRule[] {
    return db
      .prepare("SELECT merchant_alias, category_id FROM merchant_category_rules ORDER BY merchant_alias")
      .all()
      .map((row) => {
        const typedRow = row as { merchant_alias: string; category_id: string };
        return { merchantAlias: typedRow.merchant_alias, categoryId: typedRow.category_id };
      });
  }

  function upsertMerchantCategoryRule(rule: MerchantCategoryRule): void {
    if (typeof rule.merchantAlias !== "string" || !rule.merchantAlias.trim()) {
      throw new Error("merchantAlias must be a non-empty string.");
    }
    db.prepare(
      "INSERT INTO merchant_category_rules (merchant_alias, category_id) VALUES (?, ?) ON CONFLICT(merchant_alias) DO UPDATE SET category_id = excluded.category_id"
    ).run(rule.merchantAlias, rule.categoryId);
  }

  return {
    updateTransactionCategory,
    updateTransactionCategoryAndRule,
    listMerchantCorrectionProvenance,
    applySameMerchantPropagation,
    listSameMerchantPropagationOperations,
    undoSameMerchantPropagation,
    listMerchantCategoryRules,
    upsertMerchantCategoryRule,
  };
}
