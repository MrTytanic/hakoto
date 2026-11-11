import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Disc3, Grip, Layers3, Plus, Trash2 } from "lucide-react";
import { artworkUrl } from "../artwork";
import { ArtworkImage } from "../components/Artwork";
import ProfileHeader from "../components/ProfileHeader";
import ShelfDialog, { type ShelfDialogAction } from "../components/ShelfDialog";
import ShelfGrid from "../components/ShelfGrid";
import { dropHint, dropKind, placementIndex, saveShelfDrop, undoShelfChanges, slotDescription, slotKey, type ArrangementSource } from "../shelfArrangement";
import type { Shelf, ShelfLayout, ShelfPlacement, ShelfPlacementChange, ShelfSettings, ShelfSlot } from "../types/Shelf";
import { useShelfDrag } from "../useShelfDrag";
import { shelfOccupancy } from "../collectionStatistics";
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
  const layoutKey = shelfId === undefined ? undefined : `${shelfId}:${placementRevision}:${collection.shelfRevision ?? 0}`;
  const layout = storedLayout && storedLayout.key === layoutKey ? storedLayout.result : undefined;
  const placements = layout?.status === "ready" ? layout.value : undefined;
  const slots = useMemo(() => placementIndex(placements ?? []), [placements]);
  const albumsById = useMemo(() => new Map(collection.albums.map(album => [album.id, album])), [collection.albums]);
  const canArrange = placements !== undefined && collection.loadStatus === "ready";
  const occupancy = selected && shelfOccupancy(selected.rows, selected.columns, placements?.length ?? selected.occupied);

  const announceCancel = useCallback(() => setMessage({ text: "Arrangement canceled." }), []);
  const pointer = useShelfDrag(workspace, {
    onStart: () => { setPicked(null); setMessage({ text: "" }); },
    onDrop: (source, target) => {
      if (target === "trash") void removePlacement(source);
      else if (target) void place(source, target);
      else announceCancel();
    },
    onCancel: announceCancel
  });
  const activeSource = pointer.drag?.source ?? picked;
  const dragAlbum = pointer.drag && albumsById.get(pointer.drag.source.albumId);
  const hovered = pointer.drag?.target;
  const hoverKind = pointer.drag && hovered && hovered !== "trash"
    ? dropKind(pointer.drag.source, hovered, slots.get(slotKey(hovered)))
    : undefined;

  useEffect(() => {
    let cancelled = false;
    invoke<Shelf[]>("get_shelves").then(
      value => { if (!cancelled) setList({ status: "ready", value }); },
      error => { if (!cancelled) setList({ status: "error", message: `Couldn’t load shelves. ${String(error)}` }); }
    );
    return () => { cancelled = true; };
  }, [attempt, collection.shelfRevision]);

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

  async function saveArrangement(save: (write: (changes: ShelfPlacementChange[]) => Promise<ShelfPlacement[]>) =>
    Promise<{ error: string } | { placements: ShelfPlacement[]; text: string }>) {
    if (!canArrange || !selected || layoutKey === undefined || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await save(changes =>
        invoke<ShelfPlacement[]>("update_shelf_placements", { shelfId: selected.id, changes })
      );
      if ("error" in result) {
        setMessage({ text: result.error, error: true });
        return;
      }
      setStoredLayout(current => current?.key === layoutKey
        ? { key: layoutKey, result: { status: "ready", value: result.placements } }
        : current);
      setList(current => current.status === "ready" ? {
        status: "ready",
        value: current.value.map(shelf => shelf.id === selected.id ? { ...shelf, occupied: result.placements.length } : shelf)
      } : current);
      const inverse = undoShelfChanges(placements ?? [], result.placements);
      const savedShelfId = selected.id;
      collection.onUndo?.(result.text + " Undo is available for 30 seconds.", async () => {
        await invoke<ShelfPlacement[]>("update_shelf_placements", {
          shelfId: savedShelfId, changes: inverse, expected: result.placements
        });
      });
      setPicked(null);
      setMessage({ text: result.text });
    } catch (failure) {
      setMessage({ text: `Couldn’t save the arrangement. The shelf is unchanged. ${String(failure)}`, error: true });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function place(source: ArrangementSource, target: ShelfSlot) {
    const album = albumsById.get(source.albumId);
    if (!selected || !album) return;
    return saveArrangement(async write => {
      const result = await saveShelfDrop(selected, slots, source, target, write);
      if ("error" in result) return result;
      return {
        placements: result.placements,
        text: result.kind === "swap" ? "Albums swapped." : `${album.title} ${result.kind === "move" ? "moved" : "placed"} in ${slotDescription(result.target)}.`
      };
    });
  }

  function removePlacement({ slot, albumId }: ArrangementSource) {
    if (!slot || slots.get(slotKey(slot)) !== albumId) return;
    return saveArrangement(async write => ({
      placements: await write([{ ...slot, kind: "clear" }]),
      text: "Album removed from this shelf."
    }));
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
    const deleted = await invoke<number>("delete_shelf", { shelfId });
    if (deleted !== 1) throw new Error("Shelf deletion was not completed. The shelf may have changed.");
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
                    {shelves.map(shelf => {
                      const usage = shelfOccupancy(shelf.rows, shelf.columns, shelf.occupied);
                      return <option key={shelf.id} value={shelf.id}>{shelf.name} · {usage.occupied}/{usage.total} ({usage.percentage}%)</option>;
                    })}
                  </select>
                </div>
                <button type="button" className="album-cancel" disabled={saving} onClick={() => openDialog({ kind: "edit", shelf: selected })}>Edit Shelf</button>
                <button type="button" className="album-cancel" disabled={saving} onClick={() => openDialog({ kind: "delete", shelf: selected })}>Delete Shelf</button>
              </div>
              <p className="shelf-dimensions">
                {selected.rows} × {selected.columns} · {selected.orientation === "vertical" ? "Vertical spines" : "Horizontal stack"}
              </p>
              {occupancy && (
                <div className="shelf-occupancy">
                  <span id="shelf-occupancy-label">{occupancy.occupied}/{occupancy.total} slots occupied · {occupancy.percentage}%</span>
                  <progress value={occupancy.occupied} max={occupancy.total} aria-labelledby="shelf-occupancy-label" />
                  {occupancy.occupied === 0 && <p>Place an album to start filling this shelf.</p>}
                </div>
              )}
              {canArrange && (
                <p id="shelf-arrange-help" className="shelf-arrange-help">
                  Drag an album or a filled slot. For click or keyboard placement, use Place or select a filled slot, then choose a destination. Arrow keys move between slots, Enter selects, and Escape cancels. To remove a shelved album, drag it to the trash or open its slot menu with right-click or Shift+F10.
                </p>
              )}
              <p className={`shelf-arrange-status${message.error && !saving ? " shelf-error" : ""}`} role="status">
                {saving ? "Saving arrangement…" : message.text}
              </p>
              {!layout || layout.status === "loading" ? <p className="shelf-message" role="status">Loading shelf…</p> :
                layout.status === "error" ? <ShelfLoadError message={layout.message} onRetry={() => setPlacementRevision(value => value + 1)} /> : (
                  <ShelfGrid key={layoutKey} shelf={selected} placements={layout.value} albums={collection.albums} albumsLoading={collection.loadStatus === "loading"}
                    arrangement={canArrange ? {
                      source: activeSource, hovered: hovered === "trash" ? null : hovered ?? null, saving,
                      dragging: Boolean(pointer.drag), onRemove: source => { void removePlacement(source); },
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
            setAttempt(value => value + 1);
          }}
        />
      </section>

      {dialog && <ShelfDialog action={dialog} onClose={() => setDialog(undefined)} onSave={saveShelf} onDelete={deleteShelf} />}
      {pointer.drag?.source.slot && createPortal(
        <div ref={pointer.trashRef} className="shelf-trash-target" data-active={hovered === "trash" || undefined} aria-hidden="true">
          <Trash2 size={19} /> Remove from this shelf
        </div>, document.body
      )}
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
          <span className="shelf-drag-hint">{hovered === "trash" ? "Release to remove from this shelf" : hoverKind ? dropHint(hoverKind) : "Release here to cancel"}</span>
        </div>, document.body
      )}
    </div>
  );
}
