import React from "react";
import { LedgerSection } from "../dashboard/LedgerSection.js";
import { CategoryReviewSection } from "../import/CategoryReviewSection.js";

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
  return (
    <section className="destination-workspace" aria-label="Transactions workspace" hidden={!isActive}>
      <div className="destination-heading">
        <h2>Transactions</h2>
        <p>Search the ledger and resolve entries that still need a category.</p>
      </div>
      <div className="transactions-workspace-grid">
        <LedgerSection refreshKey={refreshKey} />
        <CategoryReviewSection refreshKey={refreshKey} onCategorySaved={onCategorySaved} />
      </div>
    </section>
  );
}