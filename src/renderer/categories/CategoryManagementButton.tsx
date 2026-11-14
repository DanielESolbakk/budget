import React from "react";
import { useCategoryCatalog } from "./CategoryCatalogContext.js";

export function CategoryManagementButton({
  label = "Manage categories",
  returnFocusRef,
  disabled = false,
}: {
  label?: string;
  returnFocusRef?: React.RefObject<HTMLElement>;
  disabled?: boolean;
}): React.JSX.Element {
  const { loading, error, openManagement } = useCategoryCatalog();
  return (
    <button type="button" className="action-secondary" aria-label={label}
      disabled={disabled || loading || error !== null}
      onClick={(event) => openManagement(returnFocusRef?.current ?? event.currentTarget)}>
      Manage categories
    </button>
  );
}
