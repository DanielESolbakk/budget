import React from "react";
import type { ImportPreflightProgress } from "../../app/import/importPreflight.js";

export function ImportPreflightStatus({
  pending, cancelled, progress, onCancel, cancellationError,
}: {
  pending: boolean;
  cancelled: boolean;
  progress: ImportPreflightProgress | null;
  onCancel: () => Promise<void>;
  cancellationError: string | null;
}): React.JSX.Element {
  return (
    <>
      {(pending || cancelled) && (
        <div className="import-preflight-status">
          <p role="status" aria-label="Import preflight progress">
            {cancelled
              ? "Preview cancelled. No transactions were saved."
              : progress === null || progress.totalRows === 0
                ? progress?.phase ?? "Preparing statement..."
                : `${progress.phase}: ${progress.completedRows.toLocaleString("nb-NO")} of ${progress.totalRows.toLocaleString("nb-NO")} rows`}
          </p>
          {pending && (
            <button type="button" className="import-secondary-action" onClick={() => void onCancel()}>
              Cancel preview
            </button>
          )}
        </div>
      )}
      {cancellationError !== null && <p role="alert">{cancellationError}</p>}
    </>
  );
}
