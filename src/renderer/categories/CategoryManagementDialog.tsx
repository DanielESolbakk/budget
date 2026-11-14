import React from "react";
import { useCategoryCatalog } from "./CategoryCatalogContext.js";

interface SavedCategoryChange {
  mode: "create" | "rename";
  label: string;
  submittedName: string;
}

export function CategoryManagementDialog({
  onClose,
  onSaved,
}: { onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const { categories, loading, error: catalogError, refresh } = useCategoryCatalog();
  const [newName, setNewName] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [renameName, setRenameName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState("");
  const [pendingSave, setPendingSave] = React.useState<SavedCategoryChange | null>(null);
  const closedRef = React.useRef(false);
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const newNameRef = React.useRef<HTMLInputElement>(null);
  const renameRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    newNameRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, []);

  React.useEffect(() => {
    if (editingId !== null) renameRef.current?.focus();
  }, [editingId]);

  React.useEffect(() => {
    if (!saving && result !== "" && editingId === null) newNameRef.current?.focus();
  }, [saving, result, editingId]);

  function finishSavedChange(change: SavedCategoryChange): void {
    if (!closedRef.current) {
      setPendingSave(null);
      setError(null);
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
      const message = failure instanceof Error ? failure.message : "Unable to save the category.";
      setError(saved ? `The category was saved, but refreshing failed: ${message}` : message);
    } finally {
      setSaving(false);
    }
  }

  const unavailable = saving || loading || catalogError !== null || pendingSave !== null;
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
      <p id="category-management-guidance">
        Make categories fit your household. Renaming keeps transactions, budget targets, and merchant rules linked.
      </p>
      <form className="category-management-form" onSubmit={(event) => { event.preventDefault(); void save("create"); }}>
        <label>
          New category name
          <input ref={newNameRef} value={newName} required disabled={saving}
            onChange={(event) => setNewName(event.target.value)} />
        </label>
        <button type="submit" disabled={unavailable}>Create category</button>
      </form>
      {(error !== null || catalogError !== null) && (
        <div role="alert" className="category-management-error">
          <p>{error ?? catalogError}</p>
          {(catalogError !== null || pendingSave !== null) && (
            <button type="button" className="action-secondary" disabled={loading}
              onClick={() => void retryCatalog()}>Retry categories</button>
          )}
        </div>
      )}
      <p role="status" aria-label="Category management result">{result}</p>
      <h3>Your categories</h3>
      {loading && <p role="status">Updating categories...</p>}
      <ul className="category-management-list" aria-label="Household categories">
        {categories.map((category) => (
          <li key={category.id}>
            {editingId === category.id ? (
              <form className="category-management-form" onSubmit={(event) => { event.preventDefault(); void save("rename"); }}>
                <label>
                  Category name
                  <input ref={renameRef} value={renameName} required disabled={saving || pendingSave !== null}
                    onChange={(event) => setRenameName(event.target.value)} />
                </label>
                <div className="category-management-actions">
                  <button type="submit" disabled={unavailable}>Save name</button>
                  <button type="button" className="action-secondary" disabled={saving || pendingSave !== null}
                    onClick={() => setEditingId(null)}>Cancel rename</button>
                </div>
              </form>
            ) : (
              <>
                <span>{category.label}</span>
                <button type="button" className="action-secondary" disabled={unavailable}
                  aria-label={`Rename ${category.label}`} onClick={() => {
                    setEditingId(category.id);
                    setRenameName(category.label);
                    setError(null);
                    setResult("");
                  }}>Rename</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </dialog>
  );
}
