import React from "react";
import { BackupSection } from "../backup/BackupSection.js";
import { ExportSection } from "../backup/ExportSection.js";
import { RestoreSnapshotSection } from "../dashboard/RestoreSnapshotSection.js";
interface DataSafetyWorkspaceProps {
  isActive: boolean;
  onRestoreSuccess: () => void;
}

export function DataSafetyWorkspace({ isActive, onRestoreSuccess }: DataSafetyWorkspaceProps): React.JSX.Element {
  const [catalogRevision, setCatalogRevision] = React.useState(0);

  function refreshSnapshotCatalog(): void {
    setCatalogRevision((revision) => revision + 1);
  }

  return (
    <section
      className="destination-workspace household-workspace"
      aria-label="Data safety workspace"
      hidden={!isActive}
    >
      <div className="destination-heading">
        <h2>Data safety</h2>
        <p>Create a local backup, export ledger data, or restore a saved snapshot.</p>
      </div>
      <div className="workflow-recovery-grid">
        <BackupSection onBackupSuccess={refreshSnapshotCatalog} />
        <ExportSection />
        <RestoreSnapshotSection
          catalogRevision={catalogRevision}
          onRestoreSuccess={() => {
            onRestoreSuccess();
            refreshSnapshotCatalog();
          }}
        />
      </div>
    </section>
  );
}
