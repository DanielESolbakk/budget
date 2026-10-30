import React from "react";
import {
  isCurrencyCode,
  type PendingTransactionObservation,
} from "../../domain/types.js";
import { formatCurrencyAmount } from "../formatCurrencyAmount.js";

type PendingTransactionsState =
  | { status: "loading" }
  | {
      status: "ready";
      observations: PendingTransactionObservation[];
      accountNames: ReadonlyMap<string, string>;
    }
  | { status: "error"; message: string };

interface PendingTransactionsWorkspaceProps {
  isActive: boolean;
  refreshKey: number;
  onOpenTransactions: () => void;
}

function formatAmount(observation: PendingTransactionObservation): string {
  const currencyCode = observation.currencyCode ?? "NOK";
  const amount = observation.amountMinor / 100;
  if (!isCurrencyCode(currencyCode)) {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }

  return formatCurrencyAmount(observation.amountMinor, currencyCode);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function PendingTransactionsWorkspace({
  isActive,
  refreshKey,
  onOpenTransactions,
}: PendingTransactionsWorkspaceProps): React.JSX.Element {
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const [state, setState] = React.useState<PendingTransactionsState>({ status: "loading" });

  React.useEffect(() => {
    if (!isActive) return;

    let isActiveRequest = true;
    setState({ status: "loading" });
    Promise.all([
      window.budgetApi.pending.list(),
      window.budgetApi.accounts.getCurrent(),
    ])
      .then(([observations, current]) => {
        if (!isActiveRequest) return;
        const accountNames = new Map(
          (current?.accounts ?? []).map((account) => [account.id, account.name])
        );
        setState({ status: "ready", observations, accountNames });
      })
      .catch((error: unknown) => {
        if (!isActiveRequest) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unknown pending list error.",
        });
      });

    return () => {
      isActiveRequest = false;
    };
  }, [isActive, loadAttempt, refreshKey]);

  return (
    <section
      className="destination-workspace"
      aria-label="Pending transactions workspace"
      hidden={!isActive}
    >
      <div className="destination-heading">
        <h2>Pending</h2>
        <p>Reserved and confirmed bank rows wait here until they are booked.</p>
      </div>

      <p className="pending-workspace-summary">
        Pending items are not included in booked totals, budget actuals or forecasts.
      </p>

      {state.status === "loading" && (
        <p role="status">Loading pending transactions...</p>
      )}

      {state.status === "error" && (
        <section className="status-panel status-error" role="alert">
          <div className="status-heading">
            <span className="status-marker" aria-hidden="true">!</span>
            <h2>Pending view unavailable</h2>
          </div>
          <p>{state.message}</p>
          <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Retry pending transactions
          </button>
        </section>
      )}

      {state.status === "ready" && state.observations.length === 0 && (
        <div className="empty-state pending-empty-state">
          <h3>No pending transactions</h3>
          <p>
            Reserved and confirmed payments appear here until booked. A matching booked row moves
            them into Transactions.
          </p>
          <button type="button" onClick={onOpenTransactions}>
            Open transactions
          </button>
        </div>
      )}

      {state.status === "ready" && state.observations.length > 0 && (
        <>
          <div className="pending-list-heading">
            <p role="status" aria-live="polite">
              {state.observations.length} pending{" "}
              {state.observations.length === 1 ? "item" : "items"}
            </p>
            <button type="button" onClick={onOpenTransactions}>
              Open transactions
            </button>
          </div>
          <ul className="pending-observation-list" aria-label="Pending transactions">
            {state.observations.map((observation) => (
              <li className="pending-observation-row" key={observation.id}>
                <div className="pending-observation-primary">
                  <h3>{observation.merchantRaw}</h3>
                  <p>
                    {formatDate(observation.transactionDateIso)} · Account{" "}
                    {state.accountNames.get(observation.accountId) ?? observation.accountId}
                  </p>
                </div>
                <span className="pending-observation-status">
                  {observation.sourceStatus}
                </span>
                <p className="pending-observation-amount" aria-label={`Amount ${formatAmount(observation)}`}>
                  {formatAmount(observation)}
                </p>
                <p className="pending-observation-reference">
                  <span>Source reference</span>
                  <strong>
                    {observation.sourceReference?.trim() || "Not provided"}
                  </strong>
                  {observation.sourceReference?.trim() === undefined ||
                  observation.sourceReference.trim() === "" ? (
                    <small>This item will stay separate because it has no source reference.</small>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
