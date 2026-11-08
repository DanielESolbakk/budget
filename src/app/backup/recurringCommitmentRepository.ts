import {
  mapRecurringCommitmentRow,
  mapRecurringCommitmentPaymentLinkRow,
  mapRecurringCommitmentDecisionRow,
} from "./ledgerRowMappers.js";
import { DatabaseSync } from "node:sqlite";
import { validateRecurringCommitmentInput } from "../../domain/forecast/recurringCommitments.js";
import type {
  RecurringCommitment,
  RecurringCommitmentDecision,
  RecurringCommitmentPaymentLink,
} from "../../domain/types.js";
import type { LocalLedgerDatabase } from "./localLedgerContracts.js";

type RecurringPaymentReaders = Pick<LocalLedgerDatabase,
  | "getTransactionById"
  | "getAccountsForHousehold"
>;
type RecurringCommitmentRepository = Pick<LocalLedgerDatabase,
  | "createRecurringCommitment"
  | "updateRecurringCommitment"
  | "updateRecurringCommitmentAndDecision"
  | "listRecurringCommitments"
  | "createRecurringCommitmentPaymentLink"
  | "listRecurringCommitmentPaymentLinks"
  | "createRecurringCommitmentDecision"
  | "listRecurringCommitmentDecisions"
>;

export function createRecurringCommitmentRepository(db: DatabaseSync, readers: RecurringPaymentReaders): RecurringCommitmentRepository {
  const { getTransactionById, getAccountsForHousehold } = readers;

  function createRecurringCommitment(commitment: RecurringCommitment): void {
    const validated = validateRecurringCommitmentInput(commitment);
    if (
      commitment.id.trim().length === 0 ||
      commitment.householdId.trim().length === 0 ||
      !["suggested", "active", "paused", "ended"].includes(commitment.status) ||
      !commitment.createdAtIso.includes("T") ||
      Number.isNaN(Date.parse(commitment.createdAtIso)) ||
      !commitment.updatedAtIso.includes("T") ||
      Number.isNaN(Date.parse(commitment.updatedAtIso))
    ) {
      throw new Error("Recurring commitment identity or timestamps are invalid.");
    }
    if (db.prepare("SELECT 1 FROM households WHERE id = ?").get(commitment.householdId) === undefined) {
      throw new Error(`Household not found for recurring commitment: ${commitment.householdId}`);
    }
    db.prepare(`
      INSERT INTO recurring_commitments (
        id, household_id, description, currency_code, amount_minor, is_variable, cadence,
        first_due_date_iso, active_from_iso, active_until_iso, status, created_at_iso, updated_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      commitment.id,
      commitment.householdId,
      validated.description,
      validated.currencyCode,
      validated.amountMinor,
      validated.isVariable ? 1 : 0,
      validated.cadence,
      validated.firstDueDateIso,
      validated.activeFromIso,
      validated.activeUntilIso ?? null,
      commitment.status,
      commitment.createdAtIso,
      commitment.updatedAtIso
    );
  }

  function updateRecurringCommitment(commitment: RecurringCommitment): void {
    const validated = validateRecurringCommitmentInput(commitment);
    if (
      commitment.id.trim().length === 0 ||
      commitment.householdId.trim().length === 0 ||
      !["suggested", "active", "paused", "ended"].includes(commitment.status) ||
      !commitment.updatedAtIso.includes("T") ||
      Number.isNaN(Date.parse(commitment.updatedAtIso))
    ) {
      throw new Error("Recurring commitment update is invalid.");
    }
    const result = db.prepare(`
      UPDATE recurring_commitments
      SET description = ?, currency_code = ?, amount_minor = ?, is_variable = ?, cadence = ?,
        first_due_date_iso = ?, active_from_iso = ?, active_until_iso = ?, status = ?, updated_at_iso = ?
      WHERE id = ? AND household_id = ?
    `).run(
      validated.description,
      validated.currencyCode,
      validated.amountMinor,
      validated.isVariable ? 1 : 0,
      validated.cadence,
      validated.firstDueDateIso,
      validated.activeFromIso,
      validated.activeUntilIso ?? null,
      commitment.status,
      commitment.updatedAtIso,
      commitment.id,
      commitment.householdId
    );
    if (Number(result.changes) !== 1) {
      throw new Error(`Recurring commitment not found: ${commitment.id}`);
    }
  }

  function updateRecurringCommitmentAndDecision(
    commitment: RecurringCommitment,
    decision: RecurringCommitmentDecision
  ): void {
    if (decision.commitmentId !== commitment.id) {
      throw new Error("Recurring commitment decision must reference the updated commitment.");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      updateRecurringCommitment(commitment);
      createRecurringCommitmentDecision(decision);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listRecurringCommitments(householdId: string): RecurringCommitment[] {
    return db.prepare(`
      SELECT id, household_id, description, currency_code, amount_minor, is_variable, cadence,
        first_due_date_iso, active_from_iso, active_until_iso, status, created_at_iso, updated_at_iso
      FROM recurring_commitments
      WHERE household_id = ?
      ORDER BY first_due_date_iso, description COLLATE NOCASE, id
    `).all(householdId).map(mapRecurringCommitmentRow);
  }

  function createRecurringCommitmentPaymentLink(link: RecurringCommitmentPaymentLink): void {
    if (
      link.id.trim().length === 0 ||
      link.commitmentId.trim().length === 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(link.occurrenceDateIso) ||
      Number.isNaN(Date.parse(`${link.occurrenceDateIso}T00:00:00.000Z`)) ||
      new Date(`${link.occurrenceDateIso}T00:00:00.000Z`).toISOString().slice(0, 10) !== link.occurrenceDateIso ||
      !link.linkedAtIso.includes("T") ||
      Number.isNaN(Date.parse(link.linkedAtIso)) ||
      (link.transactionId === undefined) === (link.pendingObservationId === undefined)
    ) {
      throw new Error("Recurring commitment payment link is invalid.");
    }
    const commitment = db.prepare(`
      SELECT household_id, currency_code FROM recurring_commitments WHERE id = ?
    `).get(link.commitmentId) as { household_id: string; currency_code: string } | undefined;
    if (commitment === undefined) {
      throw new Error(`Recurring commitment not found: ${link.commitmentId}`);
    }

    let resolvedTransactionId: string | undefined;
    let paymentAccountId: string;
    let paymentHouseholdId: string;
    let paymentCurrencyCode: string | undefined;
    if (link.transactionId !== undefined) {
      const transaction = getTransactionById(link.transactionId);
      if (transaction === undefined) {
        throw new Error(`Transaction not found for recurring commitment payment: ${link.transactionId}`);
      }
      if (transaction.amountMinor >= 0) {
        throw new Error("Recurring commitment must be linked to an outgoing payment.");
      }
      resolvedTransactionId = transaction.id;
      paymentAccountId = transaction.accountId;
      paymentHouseholdId = transaction.householdId;
      paymentCurrencyCode = transaction.currencyCode;
    } else {
      const pendingObservationId = link.pendingObservationId;
      if (pendingObservationId === undefined) {
        throw new Error("A recurring commitment payment link requires a payment source.");
      }
      const observation = db.prepare(`
        SELECT id, household_id, account_id, amount_minor, currency_code, reconciled_transaction_id
        FROM pending_transaction_observations
        WHERE id = ?
      `).get(pendingObservationId) as {
        id: string;
        household_id: string;
        account_id: string;
        amount_minor: number;
        currency_code: string | null;
        reconciled_transaction_id: string | null;
      } | undefined;
      if (observation === undefined) {
        throw new Error(`Pending observation not found for recurring commitment payment: ${pendingObservationId}`);
      }
      if (observation.amount_minor >= 0) {
        throw new Error("Recurring commitment must be linked to an outgoing payment.");
      }
      paymentAccountId = observation.account_id;
      paymentHouseholdId = observation.household_id;
      paymentCurrencyCode = observation.currency_code ?? undefined;
      resolvedTransactionId = observation.reconciled_transaction_id ?? undefined;
      if (resolvedTransactionId !== undefined) {
        const transaction = getTransactionById(resolvedTransactionId);
        if (transaction === undefined) {
          throw new Error(`Reconciled transaction not found: ${resolvedTransactionId}`);
        }
        if (transaction.amountMinor >= 0) {
          throw new Error("Recurring commitment must be linked to an outgoing payment.");
        }
      }
    }
    const accountCurrency = getAccountsForHousehold(paymentHouseholdId)
      .find((account) => account.id === paymentAccountId)?.currencyCode;
    if (
      paymentHouseholdId !== commitment.household_id ||
      (paymentCurrencyCode ?? accountCurrency) !== commitment.currency_code
    ) {
      throw new Error("Recurring commitment payment must belong to the same household and currency.");
    }

    const sourceId = link.transactionId ?? link.pendingObservationId!;
    const sourceType = link.transactionId === undefined ? "pending" : "transaction";
    const priorLink = db.prepare(`
      SELECT 1
      FROM recurring_commitment_payment_links
      WHERE (commitment_id = ? AND occurrence_date_iso = ?)
        OR (transaction_id = ?)
        OR (pending_observation_id = ?)
        OR (? IS NOT NULL AND pending_observation_id IN (
          SELECT id FROM pending_transaction_observations WHERE reconciled_transaction_id = ?
        ))
        OR (? IS NOT NULL AND transaction_id = ?)
      LIMIT 1
    `).get(
      link.commitmentId,
      link.occurrenceDateIso,
      sourceType === "transaction" ? sourceId : null,
      sourceType === "pending" ? sourceId : null,
      sourceType === "transaction" ? sourceId : null,
      sourceType === "transaction" ? sourceId : null,
      resolvedTransactionId ?? null,
      resolvedTransactionId ?? null
    );
    if (priorLink !== undefined) {
      throw new Error("Recurring commitment occurrence or payment is already linked.");
    }
    db.prepare(`
      INSERT INTO recurring_commitment_payment_links (
        id, commitment_id, occurrence_date_iso, transaction_id, pending_observation_id, linked_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      link.id,
      link.commitmentId,
      link.occurrenceDateIso,
      link.transactionId ?? null,
      link.pendingObservationId ?? null,
      link.linkedAtIso
    );
  }

  function listRecurringCommitmentPaymentLinks(
    householdId: string
  ): RecurringCommitmentPaymentLink[] {
    return db.prepare(`
      SELECT payment_link.id, payment_link.commitment_id, payment_link.occurrence_date_iso,
        payment_link.transaction_id, payment_link.pending_observation_id, payment_link.linked_at_iso
      FROM recurring_commitment_payment_links AS payment_link
      JOIN recurring_commitments AS commitment
        ON commitment.id = payment_link.commitment_id
      WHERE commitment.household_id = ?
      ORDER BY payment_link.commitment_id, payment_link.occurrence_date_iso, payment_link.id
    `).all(householdId).map(mapRecurringCommitmentPaymentLinkRow);
  }

  function createRecurringCommitmentDecision(decision: RecurringCommitmentDecision): void {
    if (
      decision.id.trim().length === 0 ||
      decision.commitmentId.trim().length === 0 ||
      !decision.decidedAtIso.includes("T") ||
      Number.isNaN(Date.parse(decision.decidedAtIso)) ||
      (decision.previousAmountMinor !== undefined &&
        decision.previousAmountMinor !== null &&
        (!Number.isSafeInteger(decision.previousAmountMinor) || decision.previousAmountMinor <= 0)) ||
      (decision.newAmountMinor !== undefined &&
        decision.newAmountMinor !== null &&
        (!Number.isSafeInteger(decision.newAmountMinor) || decision.newAmountMinor <= 0))
    ) {
      throw new Error("Recurring commitment decision is invalid.");
    }
    if (db.prepare("SELECT 1 FROM recurring_commitments WHERE id = ?").get(decision.commitmentId) === undefined) {
      throw new Error(`Recurring commitment not found: ${decision.commitmentId}`);
    }
    db.prepare(`
      INSERT INTO recurring_commitment_decisions (
        id, commitment_id, decision_type, decided_at_iso, previous_amount_minor, new_amount_minor
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      decision.id,
      decision.commitmentId,
      decision.decisionType,
      decision.decidedAtIso,
      decision.previousAmountMinor ?? null,
      decision.newAmountMinor ?? null
    );
  }

  function listRecurringCommitmentDecisions(
    householdId: string
  ): RecurringCommitmentDecision[] {
    return db.prepare(`
      SELECT decision.id, decision.commitment_id, decision.decision_type, decision.decided_at_iso,
        decision.previous_amount_minor, decision.new_amount_minor
      FROM recurring_commitment_decisions AS decision
      JOIN recurring_commitments AS commitment
        ON commitment.id = decision.commitment_id
      WHERE commitment.household_id = ?
      ORDER BY decision.commitment_id, decision.decided_at_iso, decision.id
    `).all(householdId).map(mapRecurringCommitmentDecisionRow);
  }

  return {
    createRecurringCommitment,
    updateRecurringCommitment,
    updateRecurringCommitmentAndDecision,
    listRecurringCommitments,
    createRecurringCommitmentPaymentLink,
    listRecurringCommitmentPaymentLinks,
    createRecurringCommitmentDecision,
    listRecurringCommitmentDecisions,
  };
}
