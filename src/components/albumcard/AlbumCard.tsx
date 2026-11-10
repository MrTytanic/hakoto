import { Disc3, Heart } from "lucide-react";
import type { PointerEventHandler } from "react";
import type { Album } from "../../types/Album";
import { artworkUrl } from "../../artwork";
import { ArtworkImage } from "../Artwork";
import "./AlbumCard.css";

type AlbumCardProps = {
  album: Album;
  onClick: () => void;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
};

function AlbumCard({ album, onClick, onPointerDown }: AlbumCardProps) {
  return (
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
          <Heart className="album-favorite-indicator" size={17} fill="currentColor" />
        )}
      </div>

      <h3 title={album.title}>{album.title}</h3>
      <p>{album.artist}</p>
      <span>{album.format}</span>
    </button>
  );
}

export default AlbumCard;
