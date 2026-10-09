import React from "react";
import { LedgerSection } from "../dashboard/LedgerSection.js";
import { CategoryReviewSection, type UncategorizedQueueState } from "../import/CategoryReviewSection.js";

interface TransactionsWorkspaceProps {
  isActive: boolean;
  refreshKey: number;
  reviewQueueFocusRequest: number;
  onCategorySaved: () => void;
}

export function TransactionsWorkspace({
  isActive,
  refreshKey,
  reviewQueueFocusRequest,
  onCategorySaved,
}: TransactionsWorkspaceProps): React.JSX.Element {
  const [uncategorizedQueueState, setUncategorizedQueueState] = React.useState<UncategorizedQueueState>({
    count: 0,
    isReady: false,
  });
  const [focusFirstRequest, setFocusFirstRequest] = React.useState(0);

  React.useEffect(() => {
    if (reviewQueueFocusRequest > 0) {
      setFocusFirstRequest((current) => current + 1);
    }
  }, [reviewQueueFocusRequest]);

  return (
    <section className="destination-workspace" aria-label="Transactions workspace" hidden={!isActive}>
      <div className="destination-heading">
        <h2>Transactions</h2>
        <p>Search the ledger and resolve entries that still need a category.</p>
      </div>
      {uncategorizedQueueState.isReady && uncategorizedQueueState.count > 0 && (
        <div className="ledger-review-action">
          <button
            className="ledger-review-uncategorized"
            type="button"
            aria-describedby="ledger-review-uncategorized-scope"
            onClick={() => setFocusFirstRequest((current) => current + 1)}
          >
            Review uncategorized ({uncategorizedQueueState.count})
          </button>
          <small id="ledger-review-uncategorized-scope">
            Includes all transactions, regardless of ledger filters.
          </small>
        </div>
      )}
      <div className="transactions-workspace-grid">
        <CategoryReviewSection
          refreshKey={refreshKey}
          onCategorySaved={onCategorySaved}
          onUncategorizedQueueStateChange={setUncategorizedQueueState}
          focusFirstRequest={focusFirstRequest}
        />
        <LedgerSection
          refreshKey={refreshKey}
        />
      </div>
    </section>
  );
}
