import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Disc3, Grip, Layers3, Plus } from "lucide-react";
import { artworkUrl } from "../artwork";
import { ArtworkImage } from "../components/Artwork";
import ProfileHeader from "../components/ProfileHeader";
import ShelfDialog, { type ShelfDialogAction } from "../components/ShelfDialog";
import ShelfGrid from "../components/ShelfGrid";
import { dropHint, dropKind, placementIndex, saveShelfDrop, slotDescription, slotKey, type ArrangementSource } from "../shelfArrangement";
import type { Shelf, ShelfLayout, ShelfPlacement, ShelfSettings, ShelfSlot } from "../types/Shelf";
import { useShelfDrag } from "../useShelfDrag";
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

export default function Shelves(collection: CollectionProps) {
  const [list, setList] = useState<Load<Shelf[]>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<number>();
  const [dialog, setDialog] = useState<ShelfDialogAction>();
  const [placementRevision, setPlacementRevision] = useState(0);
  const [storedLayout, setStoredLayout] = useState<{ key: string; result: Load<ShelfPlacement[]> }>();
  const [picked, setPicked] = useState<ArrangementSource | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const workspace = useRef<HTMLDivElement>(null);
  const newShelfButton = useRef<HTMLButtonElement>(null);
  const shelves = list.status === "ready" ? list.value : [];
  const selected = shelves.find(shelf => shelf.id === selectedId) ?? shelves[0];
  const shelfId = selected?.id;
  const layoutKey = shelfId === undefined ? undefined : `${shelfId}:${placementRevision}`;
  const layout = storedLayout && storedLayout.key === layoutKey ? storedLayout.result : undefined;
  const placements = layout?.status === "ready" ? layout.value : undefined;
  const slots = useMemo(() => placementIndex(placements ?? []), [placements]);
  const albumsById = useMemo(() => new Map(collection.albums.map(album => [album.id, album])), [collection.albums]);
  const canArrange = placements !== undefined && collection.loadStatus === "ready";

  const announceCancel = useCallback(() => setMessage({ text: "Arrangement canceled." }), []);
  const pointer = useShelfDrag(workspace, {
    onStart: () => { setPicked(null); setMessage({ text: "" }); },
    onDrop: (source, target) => { void place(source, target); },
    onCancel: announceCancel
  });
  const activeSource = pointer.drag?.source ?? picked;
  const dragAlbum = pointer.drag && albumsById.get(pointer.drag.source.albumId);
  const hoverKind = pointer.drag?.target
    ? dropKind(pointer.drag.source, pointer.drag.target, slots.get(slotKey(pointer.drag.target)))
    : undefined;

  useEffect(() => {
    let cancelled = false;
    invoke<Shelf[]>("get_shelves").then(
      value => { if (!cancelled) setList({ status: "ready", value }); },
      error => { if (!cancelled) setList({ status: "error", message: `Couldn’t load shelves. ${String(error)}` }); }
    );
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => {
    if (shelfId === undefined || layoutKey === undefined) return;
    let cancelled = false;
    invoke<ShelfLayout>("get_shelf", { shelfId }).then(
      value => { if (!cancelled) setStoredLayout({ key: layoutKey, result: { status: "ready", value: value.placements } }); },
      error => {
        if (!cancelled) setStoredLayout({ key: layoutKey, result: { status: "error", message: `Couldn’t load this shelf. ${String(error)}` } });
      }
    );
    return () => { cancelled = true; };
  }, [shelfId, layoutKey]);

  function resetArrangement() {
    pointer.cancel();
    setPicked(null);
    setMessage({ text: "" });
  }

  function pick(source: ArrangementSource) {
    if (!canArrange || savingRef.current) return;
    const album = albumsById.get(source.albumId);
    if (!album) return;
    const empty = workspace.current?.querySelector<HTMLButtonElement>(".shelf-slot-button[data-slot-empty]");
    if (!source.slot && !empty) {
      setPicked(null);
      setMessage({ text: "This shelf has no empty slots for a collection album.", error: true });
      return;
    }
    setPicked(source);
    setMessage({ text: `${album.title} selected. Choose a destination slot.` });
    if (!source.slot) empty?.focus();
  }

  async function place(source: ArrangementSource, target: ShelfSlot | null) {
    if (!canArrange || !selected || layoutKey === undefined || savingRef.current) return;
    const album = albumsById.get(source.albumId);
    if (!album) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await saveShelfDrop(selected, slots, source, target, changes =>
        invoke<ShelfPlacement[]>("update_shelf_placements", { shelfId: selected.id, changes })
      );
      if ("error" in result) {
        setMessage({ text: result.error, error: true });
        return;
      }
      setStoredLayout(current => current?.key === layoutKey
        ? { key: layoutKey, result: { status: "ready", value: result.placements } }
        : current);
      setPicked(null);
      setMessage({ text: result.kind === "swap" ? "Albums swapped." : `${album.title} ${result.kind === "move" ? "moved" : "placed"} in ${slotDescription(result.target)}.` });
    } catch (failure) {
      setMessage({ text: `Couldn’t save the arrangement. The shelf is unchanged. ${String(failure)}`, error: true });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function openDialog(action: ShelfDialogAction) {
    resetArrangement();
    setDialog(action);
  }

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
    <div
      ref={workspace}
      className={`shelves-page${pointer.drag ? " is-dragging" : ""}`}
      {...pointer.pointerHandlers}
      onKeyDown={event => {
        if (event.key === "Escape" && picked && !savingRef.current) {
          setPicked(null);
          announceCancel();
        }
      }}
    >
      <ProfileHeader profile={collection.profile} title="Shelves" description="Browse your shelf layouts and album collection." />

      <section className="shelf-workspace" aria-labelledby="shelf-workspace-title">
        <div className="shelf-workspace-heading">
          <h2 id="shelf-workspace-title">Shelf Workspace</h2>
          <button type="button" ref={newShelfButton} className="collection-add" disabled={list.status !== "ready" || saving} onClick={() => openDialog({ kind: "create" })}>
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
                  <select id="shelf-picker" value={selected.id} disabled={saving} onChange={event => {
                    resetArrangement();
                    setSelectedId(Number(event.target.value));
                  }}>
                    {shelves.map(shelf => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}
                  </select>
                </div>
                <button type="button" className="album-cancel" disabled={saving} onClick={() => openDialog({ kind: "edit", shelf: selected })}>Edit Shelf</button>
                <button type="button" className="album-cancel" disabled={saving} onClick={() => openDialog({ kind: "delete", shelf: selected })}>Delete Shelf</button>
              </div>
              <p className="shelf-dimensions">
                {selected.rows} × {selected.columns} · {selected.orientation === "vertical" ? "Vertical spines" : "Horizontal stack"}
              </p>
              {canArrange && (
                <p id="shelf-arrange-help" className="shelf-arrange-help">
                  Drag an album or a filled slot. For click or keyboard placement, use Place or select a filled slot, then choose a destination. Arrow keys move between slots, Enter selects, and Escape cancels.
                </p>
              )}
              <p className={`shelf-arrange-status${message.error && !saving ? " shelf-error" : ""}`} role="status">
                {saving ? "Saving arrangement…" : message.text}
              </p>
              {!layout || layout.status === "loading" ? <p className="shelf-message" role="status">Loading shelf…</p> :
                layout.status === "error" ? <ShelfLoadError message={layout.message} onRetry={() => setPlacementRevision(value => value + 1)} /> : (
                  <ShelfGrid key={layoutKey} shelf={selected} placements={layout.value} albums={collection.albums} albumsLoading={collection.loadStatus === "loading"}
                    arrangement={canArrange ? {
                      source: activeSource, hovered: pointer.drag?.target ?? null, saving,
                      onSlot: (slot, albumId) => {
                        if (savingRef.current) return;
                        if (picked) void place(picked, slot);
                        else if (albumId !== undefined) pick({ albumId, slot });
                        else setMessage({ text: "Choose an album from the collection or a filled slot first." });
                      },
                      onDragStart: (event, source) => { if (!savingRef.current) pointer.start(event, source); }
                    } : undefined}
                  />
                )}
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
        <Collection {...collection} embedded
          onAlbumPointerDown={(event, album) => {
            if (canArrange && !savingRef.current && event.pointerType !== "touch") pointer.start(event, { albumId: album.id });
          }}
          albumAction={album => (
            <button type="button" className="album-cancel shelf-place-button" aria-label={`Place ${album.title}`}
              aria-pressed={picked?.albumId === album.id && !picked.slot}
              disabled={!canArrange} aria-disabled={saving || undefined}
              onClick={() => pick({ albumId: album.id })}
              onPointerDown={event => { if (canArrange && !savingRef.current) pointer.start(event, { albumId: album.id }); }}
            ><Grip size={14} aria-hidden="true" /> Place</button>
          )}
          onDelete={async id => {
            await collection.onDelete(id);
            resetArrangement();
            setPlacementRevision(value => value + 1);
          }}
        />
      </section>

      {dialog && <ShelfDialog action={dialog} onClose={() => setDialog(undefined)} onSave={saveShelf} onDelete={deleteShelf} />}
      {dragAlbum && createPortal(
        <div ref={pointer.previewRef} className="shelf-drag-preview" aria-hidden="true" data-drop-kind={hoverKind}>
          <div className="shelf-drag-cover">
            <ArtworkImage src={artworkUrl(dragAlbum.artwork)} alt="" fallback={<Disc3 size={24} />} />
          </div>
          <div className="shelf-drag-info">
            <strong>{dragAlbum.title}</strong>
            <span>{dragAlbum.artist}</span>
            <span>{dragAlbum.format}</span>
          </div>
          <span className="shelf-drag-hint">{dropHint(hoverKind)}</span>
        </div>, document.body
      )}
    </div>
  );
}
