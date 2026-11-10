import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Layers3, Plus } from "lucide-react";
import ProfileHeader from "../components/ProfileHeader";
import ShelfDialog, { type ShelfDialogAction } from "../components/ShelfDialog";
import ShelfGrid from "../components/ShelfGrid";
import type { Shelf, ShelfLayout, ShelfSettings } from "../types/Shelf";
import Collection, { type CollectionProps } from "./Collection";
import "./Shelves.css";

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T };

function ShelfLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="shelf-message">
      <p className="shelf-error" role="alert">{message}</p>
      <button type="button" className="album-cancel" onClick={onRetry}>Try again</button>
    </div>
  );
}

function ShelfPreview({ shelf, albums, loadStatus }: {
  shelf: Shelf;
  albums: CollectionProps["albums"];
  loadStatus: CollectionProps["loadStatus"];
}) {
  const [layout, setLayout] = useState<Load<ShelfLayout>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    invoke<ShelfLayout>("get_shelf", { shelfId: shelf.id }).then(
      value => { if (!cancelled) setLayout({ status: "ready", value }); },
      error => { if (!cancelled) setLayout({ status: "error", message: `Couldn’t load this shelf. ${String(error)}` }); }
    );
    return () => { cancelled = true; };
  }, [shelf.id, attempt]);

  if (layout.status === "loading") return <p className="shelf-message" role="status">Loading shelf…</p>;
  if (layout.status === "error") {
    return <ShelfLoadError message={layout.message} onRetry={() => {
      setLayout({ status: "loading" });
      setAttempt(value => value + 1);
    }} />;
  }
  return <ShelfGrid shelf={shelf} placements={layout.value.placements} albums={albums} albumsLoading={loadStatus === "loading"} />;
}

export default function Shelves(collection: CollectionProps) {
  const [list, setList] = useState<Load<Shelf[]>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<number>();
  const [dialog, setDialog] = useState<ShelfDialogAction>();
  const [placementRevision, setPlacementRevision] = useState(0);
  const newShelfButton = useRef<HTMLButtonElement>(null);
  const shelves = list.status === "ready" ? list.value : [];
  const selected = shelves.find(shelf => shelf.id === selectedId) ?? shelves[0];

  useEffect(() => {
    let cancelled = false;
    invoke<Shelf[]>("get_shelves").then(
      value => { if (!cancelled) setList({ status: "ready", value }); },
      error => { if (!cancelled) setList({ status: "error", message: `Couldn’t load shelves. ${String(error)}` }); }
    );
    return () => { cancelled = true; };
  }, [attempt]);

  async function saveShelf(settings: ShelfSettings, shelfId?: number) {
    const saved = shelfId === undefined
      ? await invoke<Shelf>("create_shelf", { settings })
      : await invoke<Shelf>("update_shelf", { shelfId, settings });
    setList(current => current.status === "ready" ? {
      status: "ready",
      value: shelfId === undefined ? [...current.value, saved] : current.value.map(shelf => shelf.id === shelfId ? saved : shelf)
    } : current);
    setSelectedId(saved.id);
  }

  async function deleteShelf(shelfId: number) {
    await invoke("delete_shelf", { shelfId });
    setList(current => current.status === "ready"
      ? { status: "ready", value: current.value.filter(shelf => shelf.id !== shelfId) }
      : current);
    setSelectedId(undefined);
    if (shelves.length === 1) requestAnimationFrame(() => newShelfButton.current?.focus());
  }

  return (
    <div className="shelves-page">
      <ProfileHeader profile={collection.profile} title="Shelves" description="Browse your shelf layouts and album collection." />

      <section className="shelf-workspace" aria-labelledby="shelf-workspace-title">
        <div className="shelf-workspace-heading">
          <h2 id="shelf-workspace-title">Shelf Workspace</h2>
          <button type="button" ref={newShelfButton} className="collection-add" disabled={list.status !== "ready"} onClick={() => setDialog({ kind: "create" })}>
            <Plus size={16} aria-hidden="true" /> New Shelf
          </button>
        </div>

        {list.status === "loading" ? <p className="shelf-message" role="status">Loading shelves…</p> :
          list.status === "error" ? <ShelfLoadError message={list.message} onRetry={() => {
            setList({ status: "loading" });
            setAttempt(value => value + 1);
          }} /> : selected ? (
            <>
              <div className="shelf-tools">
                <div className="album-form-field">
                  <label htmlFor="shelf-picker">Select shelf</label>
                  <select id="shelf-picker" value={selected.id} onChange={event => setSelectedId(Number(event.target.value))}>
                    {shelves.map(shelf => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}
                  </select>
                </div>
                <button type="button" className="album-cancel" onClick={() => setDialog({ kind: "edit", shelf: selected })}>Edit Shelf</button>
                <button type="button" className="album-cancel" onClick={() => setDialog({ kind: "delete", shelf: selected })}>Delete Shelf</button>
              </div>
              <p className="shelf-dimensions">
                {selected.rows} × {selected.columns} · {selected.orientation === "vertical" ? "Vertical spines" : "Horizontal stack"}
              </p>
              <ShelfPreview key={`${selected.id}:${placementRevision}`} shelf={selected} albums={collection.albums} loadStatus={collection.loadStatus} />
            </>
          ) : (
            <div className="shelf-message">
              <Layers3 size={30} strokeWidth={1.5} aria-hidden="true" />
              <h3>No shelves yet</h3>
              <p>Create a shelf to start a layout for your collection.</p>
            </div>
          )}
      </section>

      <section className="shelf-collection" aria-labelledby="shelf-album-collection-title">
        <Collection {...collection} embedded onDelete={async id => {
          await collection.onDelete(id);
          setPlacementRevision(value => value + 1);
        }} />
      </section>

      {dialog && <ShelfDialog action={dialog} onClose={() => setDialog(undefined)} onSave={saveShelf} onDelete={deleteShelf} />}
    </div>
  );
}
