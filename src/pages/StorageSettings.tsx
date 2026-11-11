import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import CollectionCsv from "../components/CollectionCsv";
import type { Album } from "../types/Album";

type StorageInfo = {
  databasePath: string;
  artworkPath: string;
  databaseBytes: number;
  artworkBytes: number;
  profileBytes: number;
  totalBytes: number;
  isDefault: boolean;
  previousLocation: string | null;
};

const units = ["B", "KB", "MB", "GB", "TB"];
const sizeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function formatSize(bytes: number) {
  let unit = 0;
  while (bytes >= 1024 && unit < units.length - 1) {
    bytes /= 1024;
    unit++;
  }
  return `${sizeFormat.format(bytes)} ${units[unit]}`;
}

export default function StorageSettings({ profilePicture, onAlbumsImported }: {
  profilePicture: string | null;
  onAlbumsImported: (albums: Album[]) => void;
}) {
  const [info, setInfo] = useState<StorageInfo>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    invoke<StorageInfo>("get_storage_info").then(
      value => { if (!cancelled) setInfo(value); },
      failure => { if (!cancelled) setError(String(failure)); }
    );
    return () => { cancelled = true; };
  }, [attempt, profilePicture]);

  async function openLocation(artwork: boolean) {
    setError("");
    try {
      await invoke("open_storage_location", { artwork });
    } catch (failure) {
      setError(`Could not open the location: ${String(failure)}`);
    }
  }

  async function moveStorage(restoreDefault: boolean) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (await invoke<boolean>("relocate_storage", { restoreDefault })) {
        setStatus("Storage moved. The previous collection remains at its original location as a recovery copy.");
        try {
          setInfo(await invoke<StorageInfo>("get_storage_info"));
        } catch (failure) {
          setInfo(undefined);
          setError(`Storage moved, but usage could not be refreshed: ${String(failure)}.`);
        }
      }
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }

  const usage = info && [
    { name: "Database", bytes: info.databaseBytes, className: "storage-database" },
    { name: "Album artwork", bytes: info.artworkBytes, className: "storage-artwork" },
    { name: "Profile images", bytes: info.profileBytes, className: "storage-profile" }
  ];

  return (
    <div className="settings-card storage-settings">
      {info && usage ? (
        <>
          <h3>{formatSize(info.totalBytes)} used by the active collection</h3>
          {info.totalBytes > 0 && (
            <div className="storage-breakdown" aria-hidden="true">
              {usage.map(item => (
                <span key={item.name} className={item.className} style={{ flexGrow: item.bytes / info.totalBytes }} />
              ))}
            </div>
          )}
          <dl className="storage-usage">
            {usage.map(item => (
              <div key={item.name}>
                <dt><span className={item.className} aria-hidden="true" />{item.name}</dt>
                <dd>{formatSize(item.bytes)}</dd>
              </div>
            ))}
          </dl>

          <div className="storage-path">
            <h3>Database path</h3>
            <code>{info.databasePath}</code>
            <button type="button" className="settings-upload" disabled={busy} onClick={() => openLocation(false)}>Show database in file explorer</button>
          </div>
          <div className="storage-path">
            <h3>Artwork directory</h3>
            <code>{info.artworkPath}</code>
            <button type="button" className="settings-upload" disabled={busy} onClick={() => openLocation(true)}>Open artwork directory</button>
          </div>

          <CollectionCsv disabled={busy} onImported={albums => {
            onAlbumsImported(albums);
            setAttempt(value => value + 1);
          }} />

          <section className="storage-advanced" aria-labelledby="storage-advanced-title">
            <h3 id="storage-advanced-title">Advanced storage actions</h3>
            <p>
              Hakoto verifies a new copy of the database and images in a fresh folder before switching locations.
              The previous files stay in place as a recovery copy and use disk space.
            </p>
            {info.previousLocation && <p>Previous location <code>{info.previousLocation}</code></p>}
            <div className="settings-avatar-controls">
              <button type="button" className="settings-upload" disabled={busy} onClick={() => moveStorage(false)}>Choose storage folder</button>
              <button type="button" className="settings-upload" disabled={busy || info.isDefault} onClick={() => moveStorage(true)}>Restore default location</button>
            </div>
          </section>
        </>
      ) : !error && <p role="status">Loading storage usage…</p>}
      {busy && <p role="status">Preparing the new storage location…</p>}
      {status && <p role="status">{status}</p>}
      {error && <p className="storage-error" role="alert">{error}</p>}
      {!info && error && (
        <button type="button" className="settings-upload" onClick={() => {
          setError("");
          setAttempt(value => value + 1);
        }}>Retry storage usage</button>
      )}
    </div>
  );
}
