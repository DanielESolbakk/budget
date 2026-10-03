import React from "react";
import { LedgerSection } from "../dashboard/LedgerSection.js";
import { CategoryReviewSection, type UncategorizedQueueState } from "../import/CategoryReviewSection.js";

interface TransactionsWorkspaceProps {
  isActive: boolean;
  refreshKey: number;
  onCategorySaved: () => void;
}

export function TransactionsWorkspace({
  isActive,
  refreshKey,
  onCategorySaved,
}: TransactionsWorkspaceProps): React.JSX.Element {
  const [uncategorizedQueueState, setUncategorizedQueueState] = React.useState<UncategorizedQueueState>({
    count: 0,
    isReady: false,
  });
  const [focusFirstRequest, setFocusFirstRequest] = React.useState(0);

  return (
    <section className="destination-workspace" aria-label="Transactions workspace" hidden={!isActive}>
      <div className="destination-heading">
        <h2>Transactions</h2>
        <p>Search the ledger and resolve entries that still need a category.</p>
      </div>
      <div className="transactions-workspace-grid">
        <LedgerSection
          refreshKey={refreshKey}
          uncategorizedCount={uncategorizedQueueState.count}
          isUncategorizedQueueReady={uncategorizedQueueState.isReady}
          onReviewUncategorized={() => setFocusFirstRequest((current) => current + 1)}
        />
        <CategoryReviewSection
          refreshKey={refreshKey}
          onCategorySaved={onCategorySaved}
          onUncategorizedQueueStateChange={setUncategorizedQueueState}
          focusFirstRequest={focusFirstRequest}
        />
      </div>
    </section>
  );
}