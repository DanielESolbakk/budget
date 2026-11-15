import React from "react";
import { useCategoryCatalog } from "./CategoryCatalogContext.js";
import { categorySaveError } from "./categorySaveError.js";
import { filterCategoryCatalog } from "./filterCategoryCatalog.js";

interface SavedCategoryChange {
  mode: "create" | "rename";
  label: string;
  submittedName: string;
}

export function CategoryManagementDialog({
  onClose,
  onSaved,
  returnFocus,
}: { onClose: () => void; onSaved: () => void; returnFocus?: HTMLElement }): React.JSX.Element {
  const { categories, loading, error: catalogError, refresh } = useCategoryCatalog();
  const [newName, setNewName] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [renameName, setRenameName] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saveFailure, setSaveFailure] = React.useState<{
    mode: "create" | "rename"; nameInvalid: boolean;
  } | null>(null);
  const [result, setResult] = React.useState("");
  const [pendingSave, setPendingSave] = React.useState<SavedCategoryChange | null>(null);
  const closedRef = React.useRef(false);
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const newNameRef = React.useRef<HTMLInputElement>(null);
  const renameRef = React.useRef<HTMLInputElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const opener = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    newNameRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, [returnFocus]);

  React.useEffect(() => {
    if (editingId !== null) renameRef.current?.focus();
  }, [editingId]);

  React.useEffect(() => {
    if (!saving && result !== "" && editingId === null && document.activeElement === document.body) {
      newNameRef.current?.focus();
    }
  }, [saving, result, editingId]);

  React.useEffect(() => {
    if (!saving && saveFailure !== null && !closedRef.current) {
      (saveFailure.mode === "create" ? newNameRef : renameRef).current?.focus();
    }
  }, [saving, saveFailure]);

  function finishSavedChange(change: SavedCategoryChange): void {
    if (!closedRef.current) {
      setPendingSave(null);
      setError(null);
      setSaveFailure(null);
      setResult(change.mode === "create" ? `Created ${change.label}.` : `Renamed to ${change.label}.`);
      if (change.mode === "create") {
        setNewName((current) => current === change.submittedName ? "" : current);
      } else {
        setEditingId(null);
        setRenameName("");
      }
      onSaved();
    }
  }

  function close(): void {
    closedRef.current = true;
    if (pendingSave !== null) onSaved();
    onClose();
  }

  async function retryCatalog(): Promise<void> {
    if (await refresh() && pendingSave !== null) finishSavedChange(pendingSave);
  }

  async function save(mode: "create" | "rename"): Promise<void> {
    setSaving(true);
    setError(null);
    setSaveFailure(null);
    setResult("");
    let saved = false;
    try {
      const category = mode === "create"
        ? await window.budgetApi.categories.create({ label: newName })
        : await window.budgetApi.categories.rename({ categoryId: editingId ?? "", label: renameName });
      saved = true;
      const change = { mode, label: category.label, submittedName: mode === "create" ? newName : renameName };
      setPendingSave(change);
      if (!await refresh()) {
        setError("The category was saved, but the list could not refresh. Retry categories before making another change.");
        return;
      }
      finishSavedChange(change);
    } catch (failure) {
      const { message, nameInvalid } = categorySaveError(failure);
      setError(saved ? `The category was saved, but refreshing failed: ${message}` : message);
      if (!saved) setSaveFailure({ mode, nameInvalid });
    } finally {
      setSaving(false);
    }
  }

  const unavailable = saving || loading || catalogError !== null || pendingSave !== null;
  const invalidRename = saveFailure?.mode === "rename" && saveFailure.nameInvalid;
  const visibleCategories = filterCategoryCatalog(categories, search);
  const searchUnavailable = saving || pendingSave !== null || editingId !== null;
  const errorFeedback = (error !== null || catalogError !== null) && (
    <div id="category-management-error" role="alert" className="category-management-error">
      <p>{error ?? catalogError}</p>
      {(catalogError !== null || pendingSave !== null) && (
        <button type="button" className="action-secondary" disabled={loading}
          onClick={() => void retryCatalog()}>Retry categories</button>
      )}
    </div>
  );
  return (
    <dialog
      ref={dialogRef}
      className="category-management-dialog"
      aria-labelledby="category-management-heading"
      aria-describedby="category-management-guidance"
      aria-busy={saving || loading}
      onCancel={(event) => { event.preventDefault(); if (!saving) close(); }}
    >
      <div className="category-management-heading">
        <h2 id="category-management-heading">Manage categories</h2>
        <button type="button" className="action-secondary" aria-label="Close category management"
          disabled={saving} onClick={close}>Close</button>
      </div>
      <div className="category-management-body">
        <p id="category-management-guidance">
          Make categories fit your household. Renaming keeps transactions, budget targets, and merchant rules linked.
        </p>
        <p id="category-name-guidance" className="field-help">
          Examples: Car repairs or Pets. Names must be unique, ignoring capitalization and extra spaces.
        </p>
        <form className="category-management-form" onSubmit={(event) => { event.preventDefault(); void save("create"); }}>
          <label>
            New category name
            <input ref={newNameRef} value={newName} required disabled={saving}
              aria-invalid={saveFailure?.mode === "create" && saveFailure.nameInvalid || undefined}
              aria-describedby={saveFailure?.mode === "create" && saveFailure.nameInvalid
                ? "category-name-guidance category-management-error" : "category-name-guidance"}
              onChange={(event) => {
                setNewName(event.target.value);
                if (saveFailure?.mode === "create" && saveFailure.nameInvalid) {
                  setSaveFailure(null);
                  setError(null);
                }
              }} />
          </label>
          <button type="submit" disabled={unavailable}>Create category</button>
        </form>
        {!invalidRename && errorFeedback}
        <p role="status" aria-label="Category management result">{result}</p>
        <details className="category-management-help" aria-label="How categories work">
          <summary>How categories work</summary>
          <p>Creating a category only adds a choice. Select it and save a transaction or budget target to use it.</p>
          <p>Renaming updates the name in current views without moving transactions or changing amounts.
            Allocations, merchant rules and budget targets stay linked.</p>
          <p>Changes stay on this device and are included in new backups. Existing backup snapshots remain unchanged.</p>
        </details>
        <h3>Your categories</h3>
        <div className="category-management-search">
          <label>
            Find a category
            <input type="search" ref={searchRef} value={search} disabled={searchUnavailable}
              aria-describedby={editingId !== null ? "category-search-result category-search-editing" : "category-search-result"}
              onChange={(event) => setSearch(event.target.value)} />
          </label>
          {search !== "" && (
            <button type="button" className="action-secondary" disabled={searchUnavailable}
              onClick={() => { setSearch(""); searchRef.current?.focus(); }}>Clear search</button>
          )}
        </div>
        <p id="category-search-result" role="status" aria-label="Category search results">
          {visibleCategories.length} of {categories.length} categories
        </p>
        {editingId !== null && (
          <p id="category-search-editing" className="field-help">Finish or cancel renaming before searching again.</p>
        )}
        {loading && <p role="status">Updating categories...</p>}
        {!loading && catalogError === null && visibleCategories.length === 0 && (
          <p>No categories match your search. Clear search to browse all categories.</p>
        )}
        <ul className="category-management-list" aria-label="Household categories">
          {visibleCategories.map((category) => (
            <li key={category.id}>
              {editingId === category.id ? (
                <form className="category-management-form" onSubmit={(event) => { event.preventDefault(); void save("rename"); }}>
                  <label>
                    Category name
                    <input ref={renameRef} value={renameName} required disabled={saving || pendingSave !== null}
                      aria-invalid={invalidRename || undefined}
                      aria-describedby={invalidRename
                        ? "category-name-guidance category-management-error" : "category-name-guidance"}
                      onChange={(event) => {
                        setRenameName(event.target.value);
                        if (invalidRename) {
                          setSaveFailure(null);
                          setError(null);
                        }
                      }} />
                  </label>
                  <div className="category-management-actions">
                    <button type="submit" disabled={unavailable}>Save name</button>
                    <button type="button" className="action-secondary" disabled={saving || pendingSave !== null}
                      onClick={() => {
                        setEditingId(null);
                        setSaveFailure(null);
                        setError(null);
                        newNameRef.current?.focus();
                      }}>Cancel rename</button>
                  </div>
                  {invalidRename && errorFeedback}
                </form>
              ) : (
                <>
                  <span>{category.label}</span>
                  <button type="button" className="action-secondary" disabled={unavailable}
                    aria-label={`Rename ${category.label}`} onClick={() => {
                      setEditingId(category.id);
                      setRenameName(category.label);
                      setError(null);
                      setSaveFailure(null);
                      setResult("");
                    }}>Rename</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}
