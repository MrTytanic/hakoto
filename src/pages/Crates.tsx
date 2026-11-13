import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Archive, ArrowDown, ArrowLeft, ArrowUp, Disc3, Plus } from "lucide-react";
import { artworkUrl } from "../artwork";
import { ArtworkImage } from "../components/Artwork";
import CrateDialog, { type CrateDialogAction } from "../components/CrateDialog";
import ProfileHeader from "../components/ProfileHeader";
import type { UndoNotice } from "../components/toast/Toast";
import type { Album } from "../types/Album";
import type { Crate, CrateSettings } from "../types/Crate";
import type { Profile } from "../types/Profile";
import "./Crates.css";

const albumCount = (count: number) => `${count} ${count === 1 ? "album" : "albums"}`;

export default function Crates({ profile, albums, revision, onUndo }: {
  profile: Profile;
  albums: Album[];
  revision: number;
  onUndo: UndoNotice;
}) {
  const [crates, setCrates] = useState<Crate[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<number>();
  const [dialog, setDialog] = useState<CrateDialogAction>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const newCrateButton = useRef<HTMLButtonElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const crateList = useRef<HTMLUListElement>(null);

  const selected = crates.find(crate => crate.id === selectedId);
  const albumsById = useMemo(() => new Map(albums.map(album => [album.id, album])), [albums]);
  const members = (selected?.albumIds ?? []).flatMap(id => albumsById.get(id) ?? []);

  useEffect(() => {
    let current = true;
    setLoadStatus("loading");
    setError("");
    invoke<Crate[]>("get_crates").then(result => {
      if (!current) return;
      setCrates(result);
      setLoadStatus("ready");
    }, failure => {
      if (!current) return;
      setError(`Couldn’t load crates. ${String(failure)}`);
      setLoadStatus("error");
    });
    return () => { current = false; };
  }, [attempt, revision]);

  function saveResult(updated: Crate) {
    setCrates(current => current.some(crate => crate.id === updated.id)
      ? current.map(crate => crate.id === updated.id ? updated : crate)
      : [...current, updated]);
  }

  function openCrate(id: number) {
    setSelectedId(id);
    setError("");
    requestAnimationFrame(() => detailHeading.current?.focus());
  }

  function backToCrates() {
    setSelectedId(undefined);
    setError("");
    requestAnimationFrame(() => crateList.current?.querySelector<HTMLButtonElement>(`[data-crate-id="${selectedId}"]`)?.focus());
  }

  async function save(settings: CrateSettings, albumIds: string[], crate?: Crate) {
    const updated = await invoke<Crate>("save_crate", {
      settings: { ...settings, albumIds, expectedAlbumIds: crate?.albumIds }, crateId: crate?.id
    });
    saveResult(updated);
    if (!crate) openCrate(updated.id);
  }

  async function removeCrate(crateId: number) {
    await invoke("delete_crate", { crateId });
    setCrates(current => current.filter(crate => crate.id !== crateId));
    setSelectedId(undefined);
    requestAnimationFrame(() => newCrateButton.current?.focus());
  }

  async function changeMembership(change: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await change();
    } catch (failure) {
      setError(`Couldn’t update this crate. ${String(failure)}`);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function moveAlbum(crateId: number, albumId: string, direction: "up" | "down") {
    return changeMembership(async () => {
      saveResult(await invoke<Crate>("move_crate_album", { crateId, albumId, direction }));
    });
  }

  function removeAlbum(crate: Crate, album: Album) {
    return changeMembership(async () => {
      const { updated, position } = await invoke<{ updated: Crate; position: number }>("remove_crate_album", {
        crateId: crate.id, albumId: album.id
      });
      saveResult(updated);
      onUndo(`“${album.title}” removed from ${crate.name}.`, () => invoke<void>("undo_remove_crate_album", {
        crateId: crate.id, albumId: album.id, position, expectedAlbumIds: updated.albumIds
      }));
    });
  }

  return (
    <div className="collection-page crates-page">
      <div className="collection-top">
        <ProfileHeader profile={profile} title="Crates" />
        {!selected && crates.length > 0 && <button ref={newCrateButton} className="collection-add" type="button" disabled={loadStatus !== "ready" || busy}
          onClick={() => setDialog({ kind: "create" })}><Plus size={16} aria-hidden="true" />Create Crate</button>
        }
      </div>

      {error && <p className="crate-error" role="alert">{error}</p>}
      {loadStatus === "loading" ? <p role="status">Loading crates…</p> : loadStatus === "error" ? (
        <button className="album-cancel" type="button" onClick={() => setAttempt(current => current + 1)}>Try again</button>
      ) : !selected ? (
        crates.length === 0 ? (
          <div className="collection-empty">
            <Archive size={42} strokeWidth={1.2} aria-hidden="true" />
            <h2>No crates yet</h2>
            <p>Group albums from your collection in an order you choose.</p>
            <button ref={newCrateButton} type="button" onClick={() => setDialog({ kind: "create" })}>
              <Plus size={16} aria-hidden="true" />Create Crate
            </button>
          </div>
        ) : (
          <ul ref={crateList} className="crate-list" aria-label="Saved crates">
            {crates.map(crate => <li key={crate.id}>
              <button className="crate-summary" type="button" data-crate-id={crate.id} onClick={() => openCrate(crate.id)}>
                <Archive size={22} aria-hidden="true" />
                <span className="crate-summary-details">
                  <strong>{crate.name}</strong>
                  {crate.description && <span className="crate-description">{crate.description}</span>}
                </span>
                <span className="crate-count">{albumCount(crate.albumIds.length)}</span>
              </button>
            </li>)}
          </ul>
        )
      ) : (
        <section aria-labelledby="selected-crate-name">
          <div className="crate-toolbar">
            <button className="album-cancel crate-back" type="button" disabled={busy} onClick={backToCrates}><ArrowLeft size={16} aria-hidden="true" />All Crates</button>
            <button className="album-cancel" type="button" disabled={busy} onClick={() => setDialog({ kind: "edit", crate: selected })}>Edit Crate</button>
            <button className="album-cancel" type="button" disabled={busy} onClick={() => setDialog({ kind: "delete", crate: selected })}>Delete Crate</button>
          </div>
          <h2 className="section-title" id="selected-crate-name" ref={detailHeading} tabIndex={-1}>{selected.name}</h2>
          <p className="crate-count">{albumCount(selected.albumIds.length)}</p>
          {selected.description && <p className="crate-description">{selected.description}</p>}
          {members.length === 0 ? (
            <div className="collection-empty">
              <Archive size={42} strokeWidth={1.2} aria-hidden="true" />
              <h2>This crate is empty</h2>
              <p>Pick albums from your collection to fill this crate.</p>
              <button type="button" disabled={busy} onClick={() => setDialog({ kind: "edit", crate: selected })}>Add Albums</button>
            </div>
          ) : (
            <ol className="crate-albums">
              {members.map((album, index) => (
                <li key={album.id}>
                  <div className="crate-artwork"><ArtworkImage src={artworkUrl(album.artwork)} alt=""
                    fallback={<Disc3 size={22} aria-hidden="true" />} lazy /></div>
                  <div className="crate-album-info"><strong>{album.title}</strong><span>{album.artist} · {album.format}</span></div>
                  <div className="crate-album-actions">
                    <button type="button" className="album-cancel" aria-label={`Move ${album.title} up`} disabled={busy || index === 0}
                      onClick={() => void moveAlbum(selected.id, album.id, "up")}><ArrowUp size={16} aria-hidden="true" /></button>
                    <button type="button" className="album-cancel" aria-label={`Move ${album.title} down`} disabled={busy || index === members.length - 1}
                      onClick={() => void moveAlbum(selected.id, album.id, "down")}><ArrowDown size={16} aria-hidden="true" /></button>
                    <button type="button" className="album-cancel" aria-label={`Remove ${album.title} from crate`} disabled={busy}
                      onClick={() => void removeAlbum(selected, album)}>Remove</button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {dialog && <CrateDialog action={dialog} albums={albums} onSave={save} onDelete={removeCrate} onClose={() => setDialog(undefined)} />}
    </div>
  );
}
