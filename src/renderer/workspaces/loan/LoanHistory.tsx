import React from "react";
import type {
  LoanWithBalances
} from "../../../domain/types.js";
import { formatAmount, formatRecordedAt } from "./loanFormState.js";
interface LoanHistoryProps {
  loan: LoanWithBalances;
}

export function LoanHistory({ loan }: LoanHistoryProps): React.JSX.Element {
  return (<div className="loan-balance-table-wrap">
    <table aria-label="Balance history">
      <thead>
        <tr>
          <th scope="col">Effective date</th>
          <th scope="col">Recorded at</th>
          <th scope="col">Actual balance</th>
        </tr>
      </thead>
      <tbody>
        {loan.balances.map((balance) => (
          <tr key={balance.id}>
            <td>
              <time dateTime={balance.effectiveDateIso}>{balance.effectiveDateIso}</time>
            </td>
            <td>
              <time dateTime={balance.recordedAtIso}>
                {formatRecordedAt(balance.recordedAtIso)}
              </time>
            </td>
            <td className="loan-balance-value">
              {formatAmount(balance.amountMinor, balance.currencyCode)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>);
}
