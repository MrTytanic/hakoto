import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { dropHint, dropKind, placementIndex, slotKey, type ArrangementSource } from "../shelfArrangement";
import type { Album } from "../types/Album";
import type { Shelf, ShelfPlacement, ShelfSlot } from "../types/Shelf";

type ShelfGridProps = {
  shelf: Shelf;
  placements: ShelfPlacement[];
  albums: Album[];
  albumsLoading?: boolean;
  arrangement?: {
    source: ArrangementSource | null;
    hovered: ShelfSlot | null;
    saving: boolean;
    onSlot: (slot: ShelfSlot, albumId: string | undefined) => void;
    onDragStart: (event: PointerEvent<HTMLButtonElement>, source: ArrangementSource) => void;
  };
};

export default function ShelfGrid({ shelf, placements, albums, albumsLoading = false, arrangement }: ShelfGridProps) {
  const albumsById = useMemo(() => new Map(albums.map(album => [album.id, album])), [albums]);
  const slots = useMemo(() => placementIndex(placements), [placements]);
  const table = useRef<HTMLTableElement>(null);
  const [focus, setFocus] = useState<ShelfSlot>({ row: 0, column: 0 });
  const focusedKey = slotKey({ row: Math.min(focus.row, shelf.rows - 1), column: Math.min(focus.column, shelf.columns - 1) });
  const hoveredKey = arrangement?.hovered ? slotKey(arrangement.hovered) : null;

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
      <table ref={table} className="shelf-grid" aria-label="Shelf slots" aria-describedby={arrangement ? "shelf-arrange-help" : undefined} data-orientation={shelf.orientation}>
        <tbody>
          {Array.from({ length: shelf.rows }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: shelf.columns }, (_, column) => {
                const slot = { row, column };
                const key = slotKey(slot);
                const albumId = slots.get(key);
                const album = albumId === undefined ? undefined : albumsById.get(albumId);
                const title = album?.title ?? (albumId === undefined ? "Empty" : albumsLoading ? "Loading album…" : "Album unavailable");
                const description = album ? `${album.title} — ${album.artist}` : title;
                const label = `Row ${row + 1}, column ${column + 1}: ${description}`;
                const kind = arrangement?.source ? dropKind(arrangement.source, slot, albumId) : undefined;
                const content = <span className={albumId === undefined ? "shelf-empty-slot" : "shelf-spine"}>{title}</span>;
                return (
                  <td key={column} className="shelf-slot" aria-label={arrangement ? undefined : label} title={description}
                    data-shelf-slot={arrangement ? "" : undefined} data-row={row} data-column={column}
                    data-drop-kind={kind} data-drop-hovered={hoveredKey === key ? "" : undefined}>
                    {arrangement ? (
                      <button
                        type="button"
                        className="shelf-slot-button"
                        data-row={row}
                        data-column={column}
                        data-slot-empty={albumId === undefined ? "" : undefined}
                        tabIndex={focusedKey === key ? 0 : -1}
                        aria-label={kind ? `${label}. ${dropHint(kind)}` : label}
                        aria-pressed={kind === "origin" || undefined}
                        aria-disabled={arrangement.saving || undefined}
                        onFocus={() => setFocus(slot)}
                        onKeyDown={event => navigate(event, slot)}
                        onClick={() => arrangement.onSlot(slot, albumId)}
                        onPointerDown={album ? event => arrangement.onDragStart(event, { slot, albumId: album.id }) : undefined}
                      >{content}</button>
                    ) : content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
