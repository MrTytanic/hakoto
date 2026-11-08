
import { useState } from "react";
import { Heart, UserRound } from "lucide-react";
import type { Profile } from "../types/Profile";
import type { Album } from "../types/Album";
import AlbumCard from "../components/albumcard/AlbumCard";
import AlbumDetails from "../components/albumdetails/AlbumDetails";
import "./Collection.css";

type FavoritesProps = {
  profile: Profile;
  albums: Album[];
  onUpdate: (album: Album) => void;
  onDelete: (id: string) => void;
};

function Favorites({ profile, albums, onUpdate, onDelete }: FavoritesProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const favorites = albums.filter(album => album.favorite);
  const selectedAlbum = favorites.find(album => album.id === selectedId);

  return (
    <div className="collection-page">
      <div className="collection-top">
        <div className="collection-header">
          <div className="collection-avatar">
            {profile.profilePicture ? (
              <img src={profile.profilePicture} alt="Profile" />
            ) : (
              <UserRound size={26} strokeWidth={1.5} />
            )}
          </div>

          <h1>
            {profile.displayName.trim()
              ? `${profile.displayName.trim()}'s Favorites`
              : "Your Favorites"}
          </h1>
        </div>
      </div>

      {favorites.length === 0 ? (
        <div className="collection-empty">
          <Heart size={42} strokeWidth={1.2} />
          <h2>No favorites yet</h2>
          <p>Favorite albums from your collection to see them here.</p>
        </div>
      ) : (
        <div className="album-grid">
          {favorites.map(album => (
            <AlbumCard
              key={album.id}
              album={album}
              onClick={() => setSelectedId(album.id)}
            />
          ))}
        </div>
      )}

      {selectedAlbum && (
        <AlbumDetails
          key={selectedAlbum.id}
          album={selectedAlbum}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

export default Favorites;