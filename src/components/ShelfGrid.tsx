import { useMemo } from "react";
import type { Album } from "../types/Album";
import type { Shelf, ShelfPlacement } from "../types/Shelf";

type ShelfGridProps = {
  shelf: Shelf;
  placements: ShelfPlacement[];
  albums: Album[];
  albumsLoading?: boolean;
};

export default function ShelfGrid({ shelf, placements, albums, albumsLoading = false }: ShelfGridProps) {
  const albumsById = useMemo(() => new Map(albums.map(album => [album.id, album])), [albums]);
  const slots = useMemo(() => new Map(placements.map(slot => [`${slot.row}:${slot.column}`, slot.albumId])), [placements]);

  return (
    <div className="shelf-scroll" role="region" aria-label={`${shelf.name} layout`} tabIndex={0}>
      <table className="shelf-grid" aria-label="Shelf slots" data-orientation={shelf.orientation}>
        <tbody>
          {Array.from({ length: shelf.rows }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: shelf.columns }, (_, column) => {
                const albumId = slots.get(`${row}:${column}`);
                const album = albumId === undefined ? undefined : albumsById.get(albumId);
                const title = album?.title ?? (albumId === undefined ? "Empty" : albumsLoading ? "Loading album…" : "Album unavailable");
                const description = album ? `${album.title} — ${album.artist}` : title;
                return (
                  <td key={column} className="shelf-slot" aria-label={`Row ${row + 1}, column ${column + 1}: ${description}`} title={description}>
                    <span className={albumId === undefined ? "shelf-empty-slot" : "shelf-spine"}>{title}</span>
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
