import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { Shelf, ShelfSettings } from "../types/Shelf";

const MAX_SHELF_DIMENSION = 10;

export type ShelfDialogAction = { kind: "create" } | { kind: "edit" | "delete"; shelf: Shelf };

type ShelfDialogProps = {
  action: ShelfDialogAction;
  onClose: () => void;
  onSave: (settings: ShelfSettings, shelfId?: number) => Promise<void>;
  onDelete: (shelfId: number) => Promise<void>;
};

export default function ShelfDialog({ action, onClose, onSave, onDelete }: ShelfDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deleting = action.kind === "delete";
  const shelf = action.kind === "create" ? undefined : action.shelf;
  const title = deleting ? "Delete Shelf" : shelf ? "Edit Shelf" : "New Shelf";
  const maxRows = Math.max(MAX_SHELF_DIMENSION, shelf?.rows ?? 0);
  const maxColumns = Math.max(MAX_SHELF_DIMENSION, shelf?.columns ?? 0);
  const oversized = maxRows > MAX_SHELF_DIMENSION || maxColumns > MAX_SHELF_DIMENSION;

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;

    const fields = new FormData(event.currentTarget);
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (action.kind === "delete") {
        await onDelete(action.shelf.id);
      } else {
        const name = String(fields.get("name") ?? "").trim();
        if (!name) throw new Error("Enter a shelf name.");
        await onSave({
          name,
          rows: Number(fields.get("rows")),
          columns: Number(fields.get("columns")),
          orientation: fields.get("orientation") === "horizontal" ? "horizontal" : "vertical"
        }, shelf?.id);
      }
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="album-modal shelf-dialog"
      aria-labelledby="shelf-dialog-title"
      aria-describedby={deleting ? "shelf-delete-description" : undefined}
      aria-busy={busy}
      onCancel={event => {
        event.preventDefault();
        if (!pending.current) onClose();
      }}
    >
      <div className="album-modal-header">
        <h2 id="shelf-dialog-title">{title}</h2>
      </div>
      <form onSubmit={submit}>
        {deleting ? (
          <p id="shelf-delete-description">
            Delete “{shelf?.name}” and its placements? Your albums will remain in the collection.
          </p>
        ) : (
          <fieldset className="shelf-dialog-fields" disabled={busy}>
            <div className="album-form-field">
              <label htmlFor="shelf-name">Shelf name</label>
              <input id="shelf-name" name="name" defaultValue={shelf?.name} maxLength={80} required />
            </div>
            <div className="album-form-row">
              <div className="album-form-field">
                <label htmlFor="shelf-rows">Rows</label>
                <input id="shelf-rows" name="rows" type="number" min={1} max={maxRows} step={1} defaultValue={shelf?.rows ?? 3} required aria-describedby="shelf-size-description" />
              </div>
              <div className="album-form-field">
                <label htmlFor="shelf-columns">Columns</label>
                <input id="shelf-columns" name="columns" type="number" min={1} max={maxColumns} step={1} defaultValue={shelf?.columns ?? 5} required aria-describedby="shelf-size-description" />
              </div>
            </div>
            <p id="shelf-size-description">
              {oversized
                ? `The shelf limit is ${MAX_SHELF_DIMENSION} × ${MAX_SHELF_DIMENSION}. You can keep or reduce an oversized dimension. Move any albums outside the new dimensions before saving.`
                : `Shelves can have up to ${MAX_SHELF_DIMENSION} rows and ${MAX_SHELF_DIMENSION} columns.`}
            </p>
            <div className="album-form-field">
              <label htmlFor="shelf-orientation">Media orientation</label>
              <select id="shelf-orientation" name="orientation" defaultValue={shelf?.orientation ?? "vertical"}>
                <option value="vertical">Vertical (upright spines)</option>
                <option value="horizontal">Horizontal (stacked spines)</option>
              </select>
            </div>
          </fieldset>
        )}
        {error && <p className="shelf-error" role="alert">{error}</p>}
        <div className="album-modal-actions">
          <button type="button" className="album-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={deleting ? "album-submit shelf-delete-confirm" : "album-submit"} disabled={busy}>
            {busy ? (deleting ? "Deleting…" : "Saving…") : deleting ? "Delete Shelf" : shelf ? "Save Changes" : "Create Shelf"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
