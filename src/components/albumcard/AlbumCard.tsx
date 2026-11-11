import { Disc3, Ellipsis, Pin } from "lucide-react";
import { useEffect, useRef, type PointerEventHandler } from "react";
import type { Album } from "../../types/Album";
import { artworkUrl } from "../../artwork";
import { ArtworkImage } from "../Artwork";
import type { CollectionViewPreference } from "../../settings";
import "./AlbumCard.css";

type AlbumCardAction = "favorite" | "pinned" | "edit" | "delete" | "acquire";

type AlbumCardProps = {
  album: Album;
  onClick: () => void;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onAction?: (action: AlbumCardAction) => Promise<void>;
  view?: CollectionViewPreference;
};

function AlbumCard({ album, onClick, onPointerDown, onAction, view = "grid" }: AlbumCardProps) {
  const wishlist = album.ownership === "wishlist";
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const busy = useRef(false);

  function closeMenu(restoreFocus = true) {
    if (menu.current) menu.current.open = false;
    if (restoreFocus) trigger.current?.focus();
    else if (menu.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  useEffect(() => {
    const outside = (event: Event) => {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target)) closeMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("scroll", outside, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("scroll", outside, true);
    };
  }, []);

  async function runAction(action: AlbumCardAction, keyboard: boolean) {
    closeMenu(keyboard);
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
    <div className="album-card-frame" data-view={view}>
      <button className="album-card" onClick={() => { closeMenu(false); onClick(); }} type="button" onPointerDown={onPointerDown}
        onDragStart={onPointerDown ? event => event.preventDefault() : undefined}>
        <div className="album-artwork">
          <ArtworkImage
            src={artworkUrl(album.artwork)}
            alt={`${album.title} cover`}
            fallback={<Disc3 size={40} strokeWidth={1.2} />}
            lazy
          />

          {!wishlist && album.pinned && (
            <Pin className="album-pin-indicator" size={17} fill="currentColor" aria-label="Pinned" />
          )}
        </div>

        <h3 title={album.title}>{album.title}</h3>
        <p>{album.artist}</p>
        <span>{album.format || "Format undecided"}</span>
      </button>
      {onAction && (
        <details ref={menu} name="album-actions" className="album-card-actions" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }}>
          <summary ref={trigger} aria-label={`Actions for ${album.title}`}><Ellipsis size={18} aria-hidden="true" /></summary>
          <div className="album-card-action-list">
            {wishlist ? (
              <button type="button" onClick={event => void runAction("acquire", event.detail === 0)}>Add to Collection</button>
            ) : (
              <>
                <button type="button" onClick={event => void runAction("favorite", event.detail === 0)}>{album.favorite ? "Unfavorite" : "Favorite"}</button>
                <button type="button" onClick={event => void runAction("pinned", event.detail === 0)}>{album.pinned ? "Unpin" : "Pin"}</button>
              </>
            )}
            <button type="button" onClick={event => void runAction("edit", event.detail === 0)}>Edit</button>
            <button type="button" onClick={event => void runAction("delete", event.detail === 0)}>Delete</button>
          </div>
        </details>
      )}
    </div>
  );
}

export default AlbumCard;
