import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { dropHint, dropKind, placementIndex, slotKey, type ArrangementSource } from "../shelfArrangement";
import type { Album } from "../types/Album";
import type { Shelf, ShelfPlacement, ShelfSlot } from "../types/Shelf";
import ShelfSpine from "./ShelfSpine";

type ShelfGridProps = {
  shelf: Shelf;
  placements: ShelfPlacement[];
  albums: Album[];
  albumsLoading?: boolean;
  arrangement?: {
    source: ArrangementSource | null;
    hovered: ShelfSlot | null;
    saving: boolean;
    dragging?: boolean;
    onRemove?: (source: ArrangementSource) => void;
    onSlot: (slot: ShelfSlot, albumId: string | undefined) => void;
    onDragStart: (event: PointerEvent<HTMLTableElement>, source: ArrangementSource, button: HTMLButtonElement) => void;
  };
};

type ShelfCellProps = {
  row: number;
  column: number;
  albumId: string | undefined;
  album: Album | undefined;
  loading: boolean;
  interactive: boolean;
  removable: boolean;
  focused: boolean;
  hovered: boolean;
  saving: boolean;
  kind: ReturnType<typeof dropKind> | undefined;
};

const ShelfCell = memo(function ShelfCell({
  row, column, albumId, album, loading, interactive, removable, focused, hovered, saving, kind
}: ShelfCellProps) {
  const title = album?.title ?? (albumId === undefined ? "Empty" : loading ? "Loading album…" : "Album unavailable");
  const description = album ? `${album.title} — ${album.artist}` : title;
  const label = `Row ${row + 1}, column ${column + 1}: ${description}`;
  const content = albumId === undefined ? <span className="shelf-empty-slot">Empty</span> :
    <ShelfSpine album={album} fallback={title} />;
  return (
    <td className="shelf-slot" aria-label={interactive ? undefined : label} title={description}
      data-shelf-slot={interactive ? "" : undefined} data-row={row} data-column={column}
      data-drop-kind={kind} data-drop-hovered={hovered ? "" : undefined}>
      {interactive ? (
        <button type="button" className="shelf-slot-button" data-row={row} data-column={column}
          data-slot-empty={albumId === undefined ? "" : undefined} tabIndex={focused ? 0 : -1}
          aria-label={kind ? `${label}. ${dropHint(kind)}` : label} aria-pressed={kind === "origin" || undefined}
          aria-disabled={saving || undefined} aria-haspopup={albumId !== undefined && removable ? "menu" : undefined}>
          <span className="shelf-slot-motion" key={albumId ?? "empty"}>{content}</span>
        </button>
      ) : content}
    </td>
  );
});

function getSlotButton(target: EventTarget) {
  return target instanceof Element ? target.closest<HTMLButtonElement>(".shelf-slot-button") : null;
}

function readSlot(button: HTMLButtonElement): ShelfSlot {
  return { row: Number(button.dataset.row), column: Number(button.dataset.column) };
}

export default function ShelfGrid({ shelf, placements, albums, albumsLoading = false, arrangement }: ShelfGridProps) {
  const albumsById = useMemo(() => new Map(albums.map(album => [album.id, album])), [albums]);
  const slots = useMemo(() => placementIndex(placements), [placements]);
  const table = useRef<HTMLTableElement>(null);
  const [focus, setFocus] = useState<ShelfSlot>({ row: 0, column: 0 });
  const [menu, setMenu] = useState<{ source: ArrangementSource; trigger: HTMLButtonElement; x: number; y: number }>();
  const menuAction = useRef<HTMLButtonElement>(null);
  const focusedKey = slotKey({ row: Math.min(focus.row, shelf.rows - 1), column: Math.min(focus.column, shelf.columns - 1) });
  const hoveredKey = arrangement?.hovered ? slotKey(arrangement.hovered) : null;

  useEffect(() => { if (menu) menuAction.current?.focus(); }, [menu]);

  function openMenu(trigger: HTMLButtonElement, source: { albumId: string; slot: ShelfSlot }, x: number, y: number) {
    if (!arrangement?.onRemove || arrangement.saving || arrangement.dragging) return;
    setFocus(source.slot);
    setMenu({ source, trigger, x: Math.max(8, Math.min(x, window.innerWidth - 216)), y: Math.max(8, Math.min(y, window.innerHeight - 56)) });
  }

  function closeMenu() {
    setMenu(undefined);
    menu?.trigger.focus();
  }

  function navigate(event: KeyboardEvent, { row, column }: ShelfSlot) {
    switch (event.key) {
      case "ArrowUp": row--; break;
      case "ArrowDown": row++; break;
      case "ArrowLeft": column--; break;
      case "ArrowRight": column++; break;
      default: return;
    }
    event.preventDefault();
    table.current?.querySelector<HTMLButtonElement>(`button[data-row="${row}"][data-column="${column}"]`)?.focus();
  }

  return (
    <div className="shelf-scroll" role="region" aria-label={`${shelf.name} layout`} tabIndex={arrangement ? undefined : 0}>
      <table ref={table} className="shelf-grid" aria-label="Shelf slots" aria-describedby={arrangement ? "shelf-arrange-help" : undefined} data-orientation={shelf.orientation} onFocus={event => {
        const button = getSlotButton(event.target);
        if (!button) return;
        const slot = readSlot(button);
        setFocus(current => current.row === slot.row && current.column === slot.column ? current : slot);
      }} onClick={event => {
        const button = getSlotButton(event.target);
        if (!button) return;
        const slot = readSlot(button);
        arrangement?.onSlot(slot, slots.get(slotKey(slot)));
      }} onPointerDown={event => {
        const button = getSlotButton(event.target);
        if (!button) return;
        const slot = readSlot(button);
        const albumId = slots.get(slotKey(slot));
        if (albumId !== undefined && albumsById.has(albumId)) {
          arrangement?.onDragStart(event, { slot, albumId }, button);
        }
      }} onContextMenu={event => {
        const button = getSlotButton(event.target);
        if (!button || !arrangement?.onRemove) return;
        const slot = readSlot(button);
        const albumId = slots.get(slotKey(slot));
        if (albumId === undefined) return;
        event.preventDefault();
        openMenu(button, { albumId, slot }, event.clientX, event.clientY);
      }} onKeyDown={event => {
        const button = getSlotButton(event.target);
        if (!button) return;
        const slot = readSlot(button);
        const albumId = slots.get(slotKey(slot));
        if (albumId !== undefined && arrangement?.onRemove &&
          (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
          event.preventDefault();
          const bounds = button.getBoundingClientRect();
          openMenu(button, { albumId, slot }, bounds.left, bounds.bottom);
        } else navigate(event, slot);
      }}>
        <tbody>
          {Array.from({ length: shelf.rows }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: shelf.columns }, (_, column) => {
                const slot = { row, column };
                const key = slotKey(slot);
                const albumId = slots.get(key);
                const album = albumId === undefined ? undefined : albumsById.get(albumId);
                const kind = arrangement?.source ? dropKind(arrangement.source, slot, albumId) : undefined;
                return <ShelfCell key={column} row={row} column={column} albumId={albumId} album={album}
                  loading={albumsLoading} interactive={Boolean(arrangement)} removable={Boolean(arrangement?.onRemove)}
                  focused={focusedKey === key} hovered={hoveredKey === key} saving={Boolean(arrangement?.saving)}
                  kind={kind} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {menu && createPortal(
        <div className="shelf-slot-menu" role="menu" aria-label="Shelf slot actions" style={{ left: menu.x, top: menu.y }}>
          <button type="button" role="menuitem" ref={menuAction} onBlur={() => setMenu(undefined)}
            onKeyDown={event => {
              if (event.key === "Escape") {
                event.stopPropagation();
                closeMenu();
              }
            }}
            onClick={() => {
              closeMenu();
              arrangement?.onRemove?.(menu.source);
            }}
          >Remove from this shelf</button>
        </div>, document.body
      )}
    </div>
  );
}
