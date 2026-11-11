import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { Album } from "../types/Album";
import type { Crate, CrateSettings } from "../types/Crate";
import CrateAlbumPicker from "./CrateAlbumPicker";

export type CrateDialogAction = { kind: "create" } | { kind: "edit" | "delete"; crate: Crate };

export default function CrateDialog({ action, albums, onSave, onDelete, onClose }: {
  action: CrateDialogAction;
  albums: readonly Album[];
  onSave: (settings: CrateSettings, crateId?: number, albumIds?: string[]) => Promise<void>;
  onDelete: (crateId: number) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const creating = action.kind === "create";
  const crate = action.kind === "create" ? undefined : action.crate;
  const deleting = action.kind === "delete";
  const title = deleting ? "Delete Crate" : crate ? "Edit Crate" : "Create Crate";

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
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
        await onDelete(action.crate.id);
      } else {
        const name = String(fields.get("name") ?? "").trim();
        if (!name) throw new Error("Enter a crate name.");
        const description = String(fields.get("description") ?? "").trim() || null;
        await onSave({ name, description }, crate?.id, creating ? [...selected] : undefined);
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
    <dialog ref={dialog} className={`album-modal crate-dialog${creating ? " crate-dialog-create" : ""}`} aria-labelledby="crate-dialog-title"
      aria-describedby={deleting ? "crate-delete-description" : undefined} aria-busy={busy}
      onCancel={event => {
        event.preventDefault();
        if (!pending.current) onClose();
      }}>
      <div className="album-modal-header"><h2 id="crate-dialog-title">{title}</h2></div>
      <form onSubmit={submit}>
        <div className="crate-dialog-body">
          {deleting ? <p id="crate-delete-description">Delete “{crate?.name}”? Its albums will stay in your collection.</p> : (
            <fieldset className="crate-dialog-fields" disabled={busy}>
              <div className="album-form-field">
                <label htmlFor="crate-name">Name</label>
                <input id="crate-name" name="name" defaultValue={crate?.name} required />
              </div>
              <div className="album-form-field">
                <label htmlFor="crate-description">Description (optional)</label>
                <textarea id="crate-description" name="description" rows={3} defaultValue={crate?.description ?? ""} />
              </div>
              {creating && <CrateAlbumPicker albums={albums} selected={selected} onToggle={id => setSelected(previous => {
                const next = new Set(previous);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })} />}
            </fieldset>
          )}
        </div>
        {error && <p className="crate-error" role="alert">{error}</p>}
        <div className="crate-dialog-footer">
          {creating && <p className="crate-selected-count" role="status">{selected.size} selected</p>}
          <div className="album-modal-actions">
            <button type="button" className="album-cancel" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={`album-submit${deleting ? " crate-delete" : ""}`} disabled={busy}>
              {busy ? (deleting ? "Deleting…" : "Saving…") : deleting ? "Delete Crate" : crate ? "Save Changes" : "Create Crate"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
