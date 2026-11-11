import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { Crate, CrateSettings } from "../types/Crate";

export type CrateDialogAction = { kind: "create" } | { kind: "edit" | "delete"; crate: Crate };

export default function CrateDialog({ action, onSave, onDelete, onClose }: {
  action: CrateDialogAction;
  onSave: (settings: CrateSettings, crateId?: number) => Promise<void>;
  onDelete: (crateId: number) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const crate = action.kind === "create" ? undefined : action.crate;
  const deleting = action.kind === "delete";
  const title = deleting ? "Delete Crate" : crate ? "Edit Crate" : "New Crate";

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
        await onSave({ name, description }, crate?.id);
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
    <dialog ref={dialog} className="album-modal crate-dialog" aria-labelledby="crate-dialog-title"
      aria-describedby={deleting ? "crate-delete-description" : undefined} aria-busy={busy}
      onCancel={event => {
        event.preventDefault();
        if (!pending.current) onClose();
      }}>
      <div className="album-modal-header"><h2 id="crate-dialog-title">{title}</h2></div>
      <form onSubmit={submit}>
        {deleting ? <p id="crate-delete-description">Delete “{crate?.name}”? Its albums will stay in your collection.</p> : (
          <>
            <div className="album-form-field">
              <label htmlFor="crate-name">Name</label>
              <input id="crate-name" name="name" defaultValue={crate?.name} required disabled={busy} />
            </div>
            <div className="album-form-field">
              <label htmlFor="crate-description">Description (optional)</label>
              <textarea id="crate-description" name="description" rows={3} defaultValue={crate?.description ?? ""} disabled={busy} />
            </div>
          </>
        )}
        {error && <p className="crate-error" role="alert">{error}</p>}
        <div className="album-modal-actions">
          <button type="button" className="album-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={`album-submit${deleting ? " crate-delete" : ""}`} disabled={busy}>
            {busy ? (deleting ? "Deleting…" : "Saving…") : deleting ? "Delete Crate" : crate ? "Save Changes" : "Create Crate"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
