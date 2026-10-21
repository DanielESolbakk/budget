import type { DuplicateImportDecision } from "../../domain/import/filterPreviouslyImportedTransactions.js";

interface DuplicateBulkActionsProps {
  candidateCount: number;
  onChoose: (action: DuplicateImportDecision["action"]) => void;
}

export function DuplicateBulkActions({
  candidateCount,
  onChoose,
}: DuplicateBulkActionsProps): React.JSX.Element {
  return (
    <div className="import-duplicate-bulk-actions" role="group" aria-label="Set duplicate decisions for all candidates">
      <div className="import-duplicate-bulk-copy">
        <p>
          Choose one decision for all {candidateCount} potential duplicate{candidateCount === 1 ? "" : "s"}.
          You can change individual rows below.
        </p>
        <p className="import-duplicate-bulk-warning">
          Importing a candidate may add a transaction that is already in your ledger.
        </p>
      </div>
      <div className="import-duplicate-bulk-buttons">
        <button
          type="button"
          className="action-secondary"
          onClick={() => onChoose("skip")}
        >
          Skip all duplicate candidates
        </button>
        <button
          type="button"
          className="action-secondary"
          onClick={() => onChoose("import")}
        >
          Import all duplicate candidates
        </button>
      </div>
    </div>
  );
}
