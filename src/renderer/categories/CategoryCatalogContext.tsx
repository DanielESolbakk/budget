import React from "react";
import type { Category } from "../../domain/types.js";
import { CategoryManagementDialog } from "./CategoryManagementDialog.js";

interface CategoryCatalogState {
  categories: readonly Category[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<boolean>;
  openManagement: (returnFocus: HTMLElement) => void;
}

const CategoryCatalogContext = React.createContext<CategoryCatalogState | undefined>(undefined);

export function CategoryCatalogProvider({
  enabled,
  refreshKey,
  onCategorySaved,
  children,
}: { enabled: boolean; refreshKey: number; onCategorySaved: () => void; children: React.ReactNode }): React.JSX.Element {
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [managementReturnFocus, setManagementReturnFocus] = React.useState<HTMLElement | null>(null);
  const pendingReturnFocus = React.useRef<HTMLElement | null>(null);
  const generation = React.useRef(0);
  const refresh = React.useCallback(async (): Promise<boolean> => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const records = await window.budgetApi.categories.list();
      if (request !== generation.current) return false;
      setCategories(records);
      return true;
    } catch (failure) {
      if (request === generation.current) {
        setError(failure instanceof Error ? failure.message : "Unable to load categories.");
      }
      return false;
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    void refresh();
    return () => { generation.current += 1; };
  }, [enabled, refreshKey, refresh]);

  React.useEffect(() => {
    const target = pendingReturnFocus.current;
    if (managementReturnFocus !== null || loading || target === null || target.matches(":disabled")) return;
    pendingReturnFocus.current = null;
    if (target.isConnected && document.activeElement === document.body) target.focus();
  }, [managementReturnFocus, loading]);

  return (
    <CategoryCatalogContext.Provider value={{
      categories, loading, error, refresh, openManagement: setManagementReturnFocus,
    }}>
      {enabled && error !== null && (
        <div className="category-catalog-error" role="alert">
          <p>Categories could not be loaded: {error}</p>
          <button type="button" className="action-secondary" onClick={() => void refresh()}>
            Retry categories
          </button>
        </div>
      )}
      {children}
      {enabled && managementReturnFocus !== null && (
        <CategoryManagementDialog key={categories[0]?.householdId}
          returnFocus={managementReturnFocus} onClose={() => {
            pendingReturnFocus.current = managementReturnFocus;
            setManagementReturnFocus(null);
          }}
          onSaved={onCategorySaved} />
      )}
    </CategoryCatalogContext.Provider>
  );
}

export function useCategoryCatalog(): CategoryCatalogState {
  const catalog = React.useContext(CategoryCatalogContext);
  if (catalog === undefined) throw new Error("Category catalog provider is required.");
  return catalog;
}
