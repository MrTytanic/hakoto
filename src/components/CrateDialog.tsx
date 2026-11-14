import { useCallback, useRef, useState, type FormEvent } from "react";
import type { Album } from "../types/Album";
import type { Crate, CrateSettings } from "../types/Crate";
import CrateAlbumPicker from "./CrateAlbumPicker";
import Modal from "./Modal";

export type CrateDialogAction = { kind: "create" } | { kind: "edit" | "delete"; crate: Crate };

export default function CrateDialog({ action, albums, onSave, onDelete, onClose }: {
  action: CrateDialogAction;
  albums: readonly Album[];
  onSave: (settings: CrateSettings, albumIds: string[], crate?: Crate) => Promise<void>;
  onDelete: (crateId: number) => Promise<void>;
  onClose: () => void;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const crate = action.kind === "create" ? undefined : action.crate;
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(crate?.albumIds));
  const toggleAlbum = useCallback((id: string) => setSelected(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }), []);
  const deleting = action.kind === "delete";
  const title = deleting ? "Delete Crate" : crate ? "Edit Crate" : "Create Crate";

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
        await onSave({ name, description }, [...selected], crate);
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
    <Modal className={`album-modal${deleting ? "" : " crate-dialog-picker"}`} aria-labelledby="crate-dialog-title"
      role={deleting ? "alertdialog" : undefined} aria-describedby={deleting ? "crate-delete-description" : undefined}
      aria-busy={busy} onDismiss={() => { if (!pending.current) onClose(); }}>
      <div className="album-modal-header"><h2 id="crate-dialog-title">{title}</h2></div>
      <form onSubmit={submit}>
        <div className="crate-dialog-body">
          {deleting ? <p id="crate-delete-description">Delete “{crate?.name}”? Its albums will stay in your collection.</p> : (
            <fieldset className="crate-dialog-fields" disabled={busy}>
              <div className="album-form-field">
                <label htmlFor="crate-name">Name</label>
              <input id="crate-name" name="name" defaultValue={crate?.name} required data-initial-focus />
              </div>
              <div className="album-form-field">
                <label htmlFor="crate-description">Description (optional)</label>
                <textarea id="crate-description" name="description" rows={3} defaultValue={crate?.description ?? ""} />
              </div>
              <CrateAlbumPicker albums={albums} selected={selected} allowSelectedOnly={Boolean(crate)} onToggle={toggleAlbum} />
            </fieldset>
          )}
        </div>
        {error && <p className="crate-error" role="alert">{error}</p>}
        <div className="crate-dialog-footer">
          {!deleting && <p className="crate-selected-count" role="status">{selected.size} selected</p>}
          <div className="album-modal-actions">
            <button type="button" className="album-cancel" onClick={onClose} disabled={busy} data-initial-focus={deleting || undefined}>Cancel</button>
            <button type="submit" className={`album-submit${deleting ? " crate-delete" : ""}`} disabled={busy}>
              {busy ? (deleting ? "Deleting…" : "Saving…") : deleting ? "Delete Crate" : crate ? "Save Changes" : "Create Crate"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
