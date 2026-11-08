import { Disc3, Heart } from "lucide-react";
import type { Album } from "../../types/Album";
import "./AlbumCard.css";

type AlbumCardProps = {
  album: Album;
  onClick: () => void;
};

function AlbumCard({ album, onClick }: AlbumCardProps) {
  return (
    <button className="album-card" onClick={onClick} type="button">
      <div className="album-artwork">
        {album.artwork ? (
          <img src={album.artwork} alt={`${album.title} cover`} />
        ) : (
          <Disc3 size={40} strokeWidth={1.2} />
        )}

        {album.favorite && (
          <Heart className="album-favorite-indicator" size={17} fill="currentColor" />
        )}
      </div>

      <h3>{album.title}</h3>
      <p>{album.artist}</p>
      <span>{album.format}</span>
    </button>
  );
}

export default AlbumCard;