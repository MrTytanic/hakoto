import { useMemo, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Album } from "../types/Album";
import Modal from "./Modal";
import "./CollectionCsv.css";

type PreviewRow = {
  record: number;
  title: string;
  artist: string;
  format: string;
  ownership: string;
  duplicate: boolean;
  error: string | null;
};

type CsvPreview = { token: number; rows: PreviewRow[] };

const PREVIEW_PAGE_SIZE = 25;
const albumCount = (count: number) => `${count} ${count === 1 ? "album" : "albums"}`;

function CsvImportDialog({ preview, onImport, onClose, fallbackFocus }: {
  preview: CsvPreview;
  onImport: (token: number, importDuplicates: number[]) => Promise<void>;
  onClose: () => void;
  fallbackFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [approved, setApproved] = useState<ReadonlySet<number>>(() => new Set());
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const issues = useMemo(() => preview.rows.filter(row => row.duplicate || row.error), [preview]);
  const duplicateRecords = useMemo(() => issues.filter(row => row.duplicate).map(row => row.record), [issues]);
  const invalidCount = issues.length - duplicateRecords.length;
  const importCount = preview.rows.length - issues.length + approved.size;
  const rows = issuesOnly ? issues : preview.rows;
  const start = page * PREVIEW_PAGE_SIZE;
  const end = Math.min(start + PREVIEW_PAGE_SIZE, rows.length);

  async function importRows() {
    if (pending.current || importCount === 0) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onImport(preview.token, [...approved]);
    } catch (failure) {
      setError(String(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal className="album-modal csv-preview" aria-labelledby="csv-preview-title" aria-describedby="csv-preview-help"
      aria-busy={busy} fallbackFocus={fallbackFocus} onDismiss={() => { if (!pending.current) onClose(); }}>
      <div className="album-modal-header"><h2 id="csv-preview-title">Review CSV Import</h2></div>
      <p id="csv-preview-help">Duplicates match an ID or a title, artist, and format. Import creates a separate record if the ID is in use.</p>
      <p role="status">{albumCount(importCount)} ready to import. {duplicateRecords.length - approved.size} duplicate records skipped. {invalidCount} invalid records skipped.</p>
      {issues.length > 0 && <div className="csv-preview-tools">
        <label><input type="checkbox" checked={issuesOnly} disabled={busy} onChange={event => {
          setIssuesOnly(event.target.checked);
          setPage(0);
        }} /> Show duplicates and errors only</label>
        {duplicateRecords.length > 0 && <>
          <button className="album-cancel" type="button" disabled={busy || !approved.size} onClick={() => setApproved(new Set())}>Skip all duplicates</button>
          <button className="album-cancel" type="button" disabled={busy || approved.size === duplicateRecords.length}
            onClick={() => setApproved(new Set(duplicateRecords))}>Import all duplicates</button>
        </>}
      </div>}
      <div className="csv-preview-table" role="region" aria-label="CSV records" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">Record</th><th scope="col">Album</th><th scope="col">Format</th><th scope="col">Import status</th></tr></thead>
          <tbody>{rows.slice(start, end).map(row => (
            <tr key={row.record}>
              <th scope="row">{row.record}</th>
              <td><strong>{row.title || "Untitled"}</strong><br />{row.artist || "Artist unspecified"}</td>
              <td>{row.format || "Format undecided"}{row.ownership === "wishlist" && <><br />Wishlist</>}</td>
              <td>{row.error ? <span className="app-modal-error">Invalid. {row.error}</span> : row.duplicate ? (
                <label className="csv-duplicate-choice">Duplicate
                  <select aria-label={`Duplicate choice for record ${row.record}`} disabled={busy}
                    value={approved.has(row.record) ? "import" : "skip"} onChange={event => {
                      const next = new Set(approved);
                      if (event.target.value === "import") next.add(row.record);
                      else next.delete(row.record);
                      setApproved(next);
                    }}>
                    <option value="skip">Skip</option>
                    <option value="import">Import</option>
                  </select>
                </label>
              ) : "Ready"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {rows.length > PREVIEW_PAGE_SIZE && <div className="collection-page-buttons csv-preview-tools">
        <button type="button" className="album-cancel" disabled={busy || page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span role="status">Showing {start + 1}–{end} of {rows.length} records</span>
        <button type="button" className="album-cancel" disabled={busy || end === rows.length} onClick={() => setPage(page + 1)}>Next</button>
      </div>}
      {error && <p className="app-modal-error" role="alert">{error}</p>}
      <div className="album-modal-actions">
        <button className="album-cancel" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="album-submit" type="button" disabled={busy || importCount === 0} onClick={() => void importRows()}>
          {busy ? "Importing…" : `Import ${albumCount(importCount)}`}
        </button>
      </div>
    </Modal>
  );
}

export default function CollectionCsv({ disabled, onImported }: { disabled: boolean; onImported: (albums: Album[]) => void }) {
  const [includeWishlist, setIncludeWishlist] = useState(false);
  const [operation, setOperation] = useState<"export" | "preview">();
  const [preview, setPreview] = useState<CsvPreview>();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);
  const importButton = useRef<HTMLButtonElement>(null);

  async function choose(action: "export" | "preview") {
    if (pending.current) return;
    pending.current = true;
    setOperation(action);
    setError("");
    setStatus("");
    try {
      if (action === "export") {
        const count = await invoke<number | null>("export_collection_csv", { includeWishlist });
        if (count !== null) setStatus(`Exported ${albumCount(count)}.`);
      } else {
        const selected = await invoke<CsvPreview | null>("preview_collection_csv");
        if (selected) setPreview(selected);
      }
    } catch (failure) {
      setError(String(failure));
    } finally {
      pending.current = false;
      setOperation(undefined);
    }
  }

  async function importRows(token: number, importDuplicates: number[]) {
    const imported = await invoke<Album[]>("import_collection_csv", { token, importDuplicates });
    onImported(imported);
    setPreview(undefined);
    setStatus(`Imported ${albumCount(imported.length)}.`);
  }

  return (
    <section className="storage-advanced" aria-labelledby="storage-csv-title">
      <h3 id="storage-csv-title">Import and Export</h3>
      <p>Transfer album records as UTF-8 CSV. CSV excludes artwork files, shelf placements, crates, and profile images.</p>
      <p>Use a Hakoto export or a CSV with <code>title</code>, <code>artist</code>, and <code>format</code> columns.</p>
      <label><input type="checkbox" checked={includeWishlist} disabled={disabled || Boolean(operation)}
        onChange={event => setIncludeWishlist(event.target.checked)} /> Include wishlist entries in exports</label>
      <div className="settings-avatar-controls">
        <button type="button" className="settings-upload" disabled={disabled || Boolean(operation)}
          onClick={() => void choose("export")}>{operation === "export" ? "Exporting…" : "Export CSV"}</button>
        <button ref={importButton} type="button" className="settings-upload" disabled={disabled || Boolean(operation)}
          onClick={() => void choose("preview")}>{operation === "preview" ? "Reading CSV…" : "Import CSV"}</button>
      </div>
      {status && <p role="status">{status}</p>}
      {error && <p className="storage-error" role="alert">{error}</p>}
      {preview && <CsvImportDialog preview={preview} onImport={importRows} fallbackFocus={importButton} onClose={() => {
        setPreview(undefined);
        void invoke("discard_collection_csv_preview", { token: preview.token }).catch(failure => setError(String(failure)));
      }} />}
    </section>
  );
}
