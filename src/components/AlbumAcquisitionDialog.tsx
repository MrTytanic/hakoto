import { useRef, useState, type FormEvent } from "react";
import { albumFormats } from "../constants/albumFormats";
import type { Album } from "../types/Album";
import Modal from "./Modal";

function localDate() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

export default function AlbumAcquisitionDialog({ album, onAcquire, onClose }: {
  album: Album;
  onAcquire: (id: string, format: string, dateAcquired: string) => Promise<void>;
  onClose: (acquired?: boolean) => void;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [today] = useState(localDate);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const fields = new FormData(event.currentTarget);
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onAcquire(album.id, String(fields.get("format")), String(fields.get("dateAcquired")));
      onClose(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal className="album-modal" aria-labelledby="acquire-title"
      aria-describedby="acquire-description" aria-busy={busy} onDismiss={() => { if (!pending.current) onClose(); }}>
      <div className="album-modal-header"><h2 id="acquire-title">Add to Collection</h2></div>
      <p id="acquire-description">Move “{album.title}” from your wishlist to your collection.</p>
      <form onSubmit={submit}>
        <div className="album-form-field">
          <label htmlFor="acquire-format">Format</label>
          <select id="acquire-format" name="format" defaultValue={albumFormats.includes(album.format) ? album.format : ""} required disabled={busy}>
            <option value="" disabled>Choose a format</option>
            {albumFormats.map(format => <option key={format} value={format}>{format}</option>)}
          </select>
        </div>
        <div className="album-form-field">
          <label htmlFor="acquire-date">Date acquired</label>
          <input id="acquire-date" name="dateAcquired" type="date" min="0001-01-01" max="9999-12-31"
            defaultValue={today} required disabled={busy} />
        </div>
        {error && <p className="app-modal-error" role="alert">{error}</p>}
        <div className="album-modal-actions">
          <button type="button" className="album-cancel" onClick={() => onClose()} disabled={busy}>Cancel</button>
          <button type="submit" className="album-submit" disabled={busy}>{busy ? "Adding…" : "Add to Collection"}</button>
        </div>
      </form>
    </Modal>
  );
}
