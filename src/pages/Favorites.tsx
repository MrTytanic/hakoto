
import { useState } from "react";
import { Heart } from "lucide-react";
import { ProfileAvatar } from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import type { ArtworkChange } from "../artwork";
import type { Album } from "../types/Album";
import AlbumCard from "../components/albumcard/AlbumCard";
import AlbumDetails from "../components/albumdetails/AlbumDetails";
import "./Collection.css";

type FavoritesProps = {
  profile: Profile;
  albums: Album[];
  onUpdate: (album: Album, artwork?: ArtworkChange) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onNotify: (message: string, type: "error") => void;
};

function Favorites({ profile, albums, onUpdate, onDelete, onNotify }: FavoritesProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const favorites = albums.filter(album => album.favorite);
  const selectedAlbum = favorites.find(album => album.id === selectedId);

  return (
    <div className="collection-page">
      <div className="collection-top">
        <div className="collection-header">
          <ProfileAvatar picture={profile.profilePicture} />

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
          onError={message => onNotify(message, "error")}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

export default Favorites;
