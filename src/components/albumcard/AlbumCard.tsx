import { Disc3, Ellipsis, Heart, Pin } from "lucide-react";
import { useRef, type PointerEventHandler } from "react";
import type { Album } from "../../types/Album";
import { artworkUrl } from "../../artwork";
import { ArtworkImage } from "../Artwork";
import "./AlbumCard.css";

type AlbumCardAction = "favorite" | "pinned" | "edit" | "delete";

type AlbumCardProps = {
  album: Album;
  onClick: () => void;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onAction?: (action: AlbumCardAction) => Promise<void>;
};

function AlbumCard({ album, onClick, onPointerDown, onAction }: AlbumCardProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const busy = useRef(false);

  function closeMenu() {
    if (menu.current) menu.current.open = false;
    trigger.current?.focus();
  }

  async function runAction(action: AlbumCardAction) {
    closeMenu();
    if (busy.current) return;
    busy.current = true;
    try {
      await onAction?.(action);
    } catch (error) {
      console.error("Album action failed:", error);
    } finally {
      busy.current = false;
    }
  }

  return (
    <div className="album-card-frame">
      <button className="album-card" onClick={onClick} type="button" onPointerDown={onPointerDown}
        onDragStart={onPointerDown ? event => event.preventDefault() : undefined}>
        <div className="album-artwork">
          <ArtworkImage
            src={artworkUrl(album.artwork)}
            alt={`${album.title} cover`}
            fallback={<Disc3 size={40} strokeWidth={1.2} />}
            lazy
          />

          {album.favorite && (
            <Heart className="album-favorite-indicator" size={17} fill="currentColor" aria-label="Favorite" />
          )}
        </div>

        <h3 title={album.title}>{album.title}</h3>
        <p>{album.artist}</p>
        <span>{album.format}</span>
        {album.pinned && <Pin className="album-pin-indicator" size={12} aria-label="Pinned" />}
      </button>
      {onAction && (
        <details ref={menu} className="album-card-actions" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }} onKeyDown={event => {
          if (event.key === "Escape" && menu.current?.open) {
            event.stopPropagation();
            closeMenu();
          }
        }}>
          <summary ref={trigger} aria-label={`Actions for ${album.title}`}><Ellipsis size={18} aria-hidden="true" /></summary>
          <div className="album-card-action-list">
            <button type="button" onClick={() => void runAction("favorite")}>{album.favorite ? "Unfavorite" : "Favorite"}</button>
            <button type="button" onClick={() => void runAction("pinned")}>{album.pinned ? "Unpin" : "Pin"}</button>
            <button type="button" onClick={() => void runAction("edit")}>Edit</button>
            <button type="button" onClick={() => void runAction("delete")}>Delete</button>
          </div>
        </details>
      )}
    </div>
  );
}

export default AlbumCard;
