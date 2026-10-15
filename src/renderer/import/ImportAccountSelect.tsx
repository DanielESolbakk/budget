import React from "react";
import type { Account } from "../../domain/types.js";

interface ImportAccountSelectProps {
  id: string;
  label: string;
  accounts: readonly Account[];
  value: string;
  onChange: (accountId: string) => void;
  disabled?: boolean;
  emptyOption?: string;
}

export function ImportAccountSelect({
  id,
  label,
  accounts,
  value,
  onChange,
  disabled = false,
  emptyOption,
}: ImportAccountSelectProps): React.JSX.Element {
  return (
    <div className="import-account-select">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled || accounts.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {emptyOption !== undefined && <option value="">{emptyOption}</option>}
        {accounts.length === 0 && emptyOption === undefined && (
          <option value="">No accounts available</option>
        )}
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>{account.name}</option>
        ))}
      </select>
    </div>
  );
}