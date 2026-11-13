import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readBackupSettings } from "../settings";
import Modal from "./Modal";

type RestoreSummary = {
  token: string;
  createdAt: string;
  ownedAlbums: number;
  wishlistAlbums: number;
  shelves: number;
  crates: number;
};

export default function CollectionBackup({ disabled }: { disabled: boolean }) {
  const [operation, setOperation] = useState<"export" | "verify" | "restore" | "reload">();
  const [preview, setPreview] = useState<RestoreSummary>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const pending = useRef(false);
  const restoreButton = useRef<HTMLButtonElement>(null);

  async function choose(action: "export" | "verify") {
    if (pending.current) return;
    pending.current = true;
    setOperation(action);
    setError("");
    setStatus("");
    try {
      if (action === "export") {
        if (await invoke<boolean>("export_backup", { settings: readBackupSettings() })) {
          setStatus("Backup saved.");
        }
      } else {
        const backup = await invoke<RestoreSummary | null>("preview_backup_restore");
        if (backup) setPreview(backup);
      }
    } catch (failure) {
      setError(String(failure));
    } finally {
      pending.current = false;
      setOperation(undefined);
    }
  }

  function cancelRestore() {
    if (pending.current || !preview) return;
    const { token } = preview;
    setPreview(undefined);
    void invoke("discard_backup_restore", { token }).catch(failure => setError(String(failure)));
  }

  async function restore(token: string) {
    if (pending.current) return;
    pending.current = true;
    setOperation("restore");
    setError("");
    try {
      await invoke("confirm_backup_restore", { token });
      setOperation("reload");
      window.location.reload();
    } catch (failure) {
      setPreview(undefined);
      setError(String(failure));
      setOperation(undefined);
      pending.current = false;
    }
  }

  return (
    <section className="storage-advanced" aria-labelledby="storage-backup-title">
      <h3 id="storage-backup-title">Backup and Restore</h3>
      <p>A Hakoto ZIP backup includes your collection, artwork, profile, shelves, crates, wishlist, and preferences.</p>
      <div className="settings-avatar-controls">
        <button type="button" className="settings-upload" disabled={disabled || Boolean(operation)} onClick={() => void choose("export")}>Create Backup</button>
        <button type="button" className="settings-upload" ref={restoreButton} disabled={disabled || Boolean(operation)} onClick={() => void choose("verify")}>Restore Backup</button>
      </div>
      {operation === "export" && <p role="status">Creating a database snapshot and writing the ZIP…</p>}
      {operation === "verify" && <p role="status">Verifying the ZIP and staging the collection…</p>}
      {status && <p role="status">{status}</p>}
      {error && <p className="storage-error" role="alert">{error}</p>}
      {preview && <Modal className="album-modal" role="alertdialog" aria-labelledby="restore-backup-title" aria-describedby="restore-backup-help"
        aria-busy={Boolean(operation)} fallbackFocus={restoreButton} onDismiss={cancelRestore}>
        <div className="album-modal-header"><h2 id="restore-backup-title">Restore this backup?</h2></div>
        <p id="restore-backup-help">Hakoto will switch to the backup’s collection and preferences, then reload. Your current collection files will stay at their original location.</p>
        <dl className="storage-usage">
          <div><dt>Backup created</dt><dd>{new Date(preview.createdAt).toLocaleString()}</dd></div>
          <div><dt>Owned albums</dt><dd>{preview.ownedAlbums}</dd></div>
          <div><dt>Wishlist albums</dt><dd>{preview.wishlistAlbums}</dd></div>
          <div><dt>Shelves</dt><dd>{preview.shelves}</dd></div>
          <div><dt>Crates</dt><dd>{preview.crates}</dd></div>
        </dl>
        {operation && <p role="status">{operation === "reload" ? "Reloading the restored collection…" : "Activating the verified collection…"}</p>}
        <div className="album-modal-actions">
          <button type="button" className="album-cancel" data-initial-focus disabled={Boolean(operation)} onClick={cancelRestore}>Cancel</button>
          <button type="button" className="album-submit" disabled={Boolean(operation)} onClick={() => void restore(preview.token)}>Restore and Reload</button>
        </div>
      </Modal>}
    </section>
  );
}
