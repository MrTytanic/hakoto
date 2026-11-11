import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowDown, ArrowUp, Disc3, Plus } from "lucide-react";
import { artworkUrl } from "../artwork";
import { ArtworkImage } from "../components/Artwork";
import CrateDialog, { type CrateDialogAction } from "../components/CrateDialog";
import ProfileHeader from "../components/ProfileHeader";
import type { Album } from "../types/Album";
import type { Crate, CrateSettings } from "../types/Crate";
import type { Profile } from "../types/Profile";
import "./Crates.css";

export default function Crates({ profile, albums, revision }: { profile: Profile; albums: Album[]; revision: number }) {
  const [crates, setCrates] = useState<Crate[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<number>();
  const [dialog, setDialog] = useState<CrateDialogAction>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const newCrateButton = useRef<HTMLButtonElement>(null);

  const selected = crates.find(crate => crate.id === selectedId) ?? crates[0];
  const albumsById = useMemo(() => new Map(albums.map(album => [album.id, album])), [albums]);
  const sortedAlbums = useMemo(() => [...albums].sort((left, right) =>
    left.title.localeCompare(right.title) || left.artist.localeCompare(right.artist)), [albums]);
  const members = (selected?.albumIds ?? []).flatMap(id => albumsById.get(id) ?? []);
  const memberIds = new Set(selected?.albumIds);
  const available = sortedAlbums.filter(album => !memberIds.has(album.id));

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
      setError(String(failure));
      setLoadStatus("error");
    });
    return () => { current = false; };
  }, [attempt, revision]);

  function saveResult(updated: Crate) {
    setCrates(current => current.some(crate => crate.id === updated.id)
      ? current.map(crate => crate.id === updated.id ? updated : crate)
      : [...current, updated]);
  }

  async function save(settings: CrateSettings, crateId?: number) {
    const updated = await invoke<Crate>("save_crate", { settings, crateId });
    saveResult(updated);
    setSelectedId(updated.id);
  }

  async function removeCrate(crateId: number) {
    await invoke("delete_crate", { crateId });
    setCrates(current => current.filter(crate => crate.id !== crateId));
    setSelectedId(undefined);
    requestAnimationFrame(() => newCrateButton.current?.focus());
  }

  async function changeMembership(command: string, crateId: number, albumId: string, direction?: "up" | "down") {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      saveResult(await invoke<Crate>(command, { crateId, albumId, direction }));
      return true;
    } catch (failure) {
      setError(String(failure));
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function addAlbum(event: FormEvent<HTMLFormElement>, crateId: number) {
    event.preventDefault();
    const form = event.currentTarget;
    const albumId = new FormData(form).get("albumId");
    if (typeof albumId === "string" && albumId && await changeMembership("add_crate_album", crateId, albumId)) form.reset();
  }

  return (
    <div className="collection-page crates-page">
      <div className="collection-top">
        <ProfileHeader profile={profile} title="Crates" />
        <button ref={newCrateButton} className="collection-add" type="button" disabled={loadStatus !== "ready" || busy}
          onClick={() => setDialog({ kind: "create" })}><Plus size={17} aria-hidden="true" />New Crate</button>
      </div>

      {error && <p className="crate-error" role="alert">{error}</p>}
      {loadStatus === "loading" ? <p role="status">Loading crates…</p> : loadStatus === "error" ? (
        <button className="album-cancel" type="button" onClick={() => setAttempt(current => current + 1)}>Try again</button>
      ) : !selected ? (
        <div className="collection-empty"><h2>No crates yet</h2><p>Create a crate to organize albums in a custom order.</p></div>
      ) : (
        <section aria-labelledby="selected-crate-name">
          <div className="crate-toolbar">
            <div className="album-form-field">
              <label htmlFor="crate-picker">Crate</label>
              <select id="crate-picker" value={selected.id} disabled={busy} onChange={event => {
                setSelectedId(Number(event.target.value));
                setError("");
              }}>
                {crates.map(crate => <option key={crate.id} value={crate.id}>{crate.name}</option>)}
              </select>
            </div>
            <button className="album-cancel" type="button" disabled={busy} onClick={() => setDialog({ kind: "edit", crate: selected })}>Edit Crate</button>
            <button className="album-cancel" type="button" disabled={busy} onClick={() => setDialog({ kind: "delete", crate: selected })}>Delete Crate</button>
          </div>
          <h2 id="selected-crate-name">{selected.name}</h2>
          {selected.description && <p className="crate-description">{selected.description}</p>}
          <form key={selected.id} className="crate-toolbar" onSubmit={event => void addAlbum(event, selected.id)}>
            <div className="album-form-field">
              <label htmlFor="crate-album-picker">Album</label>
              <select id="crate-album-picker" name="albumId" defaultValue="" disabled={busy || !available.length} required>
                <option value="" disabled>{available.length ? "Choose an album" : "No albums available"}</option>
                {available.map(album => <option key={album.id} value={album.id}>
                  {[`${album.title} — ${album.artist}`, album.format, album.releaseYear, album.condition, album.dateAcquired].filter(Boolean).join(" · ")}
                </option>)}
              </select>
            </div>
            <button className="album-submit" type="submit" disabled={busy || !available.length}>Add Album</button>
          </form>
          {members.length === 0 ? <p>This crate is empty.</p> : (
            <ol className="crate-albums">
              {members.map((album, index) => (
                <li key={album.id}>
                  <div className="crate-artwork"><ArtworkImage src={artworkUrl(album.artwork)} alt=""
                    fallback={<Disc3 size={22} aria-hidden="true" />} lazy /></div>
                  <div className="crate-album-info"><strong>{album.title}</strong><span>{album.artist} · {album.format}</span></div>
                  <div className="crate-album-actions">
                    <button type="button" className="album-cancel" aria-label={`Move ${album.title} up`} disabled={busy || index === 0}
                      onClick={() => void changeMembership("move_crate_album", selected.id, album.id, "up")}><ArrowUp size={16} aria-hidden="true" /></button>
                    <button type="button" className="album-cancel" aria-label={`Move ${album.title} down`} disabled={busy || index === members.length - 1}
                      onClick={() => void changeMembership("move_crate_album", selected.id, album.id, "down")}><ArrowDown size={16} aria-hidden="true" /></button>
                    <button type="button" className="album-cancel" aria-label={`Remove ${album.title} from crate`} disabled={busy}
                      onClick={() => void changeMembership("remove_crate_album", selected.id, album.id)}>Remove</button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {dialog && <CrateDialog action={dialog} onSave={save} onDelete={removeCrate} onClose={() => setDialog(undefined)} />}
    </div>
  );
}
