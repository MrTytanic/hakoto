
import { useMemo, useState } from "react";
import { Heart } from "lucide-react";
import { ProfileAvatar } from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import type { ArtworkChange } from "../artwork";
import type { Album } from "../types/Album";
import { getVisibleAlbums, paginateAlbums } from "../collectionView";
import { collectionPageSizePreference } from "../settings";
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
  const [initialAction, setInitialAction] = useState<"edit" | "delete">();
  const favorites = useMemo(() => getVisibleAlbums(albums.filter(album => album.favorite), {
    query: "", formats: [], sort: "collection"
  }), [albums]);
  const [pageSize] = useState(collectionPageSizePreference.read);
  const [page, setPage] = useState(0);
  const pagination = useMemo(() => paginateAlbums(favorites, page, Number(pageSize)), [favorites, page, pageSize]);
  if (page !== pagination.pageIndex) setPage(pagination.pageIndex);
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
        <>
          <nav className="collection-pagination" aria-label="Favorite pages">
            <span role="status">Showing {pagination.start + 1}–{pagination.end} of {favorites.length} favorites</span>
            <div className="collection-page-buttons">
              <button type="button" className="album-cancel" disabled={pagination.pageIndex === 0}
                onClick={() => setPage(pagination.pageIndex - 1)}>Previous</button>
              <span>Page {pagination.pageIndex + 1} of {pagination.pageCount}</span>
              <button type="button" className="album-cancel" disabled={pagination.pageIndex + 1 === pagination.pageCount}
                onClick={() => setPage(pagination.pageIndex + 1)}>Next</button>
            </div>
          </nav>
          <div className="album-grid">
            {pagination.albums.map(album => (
              <AlbumCard
                key={album.id}
                album={album}
                onClick={() => { setInitialAction(undefined); setSelectedId(album.id); }}
                onAction={async action => {
                  if (action === "edit" || action === "delete") {
                    setInitialAction(action);
                    setSelectedId(album.id);
                  } else await onUpdate({ ...album, [action]: !album[action] });
                }}
              />
            ))}
          </div>
        </>
      )}

      {selectedAlbum && (
        <AlbumDetails
          key={selectedAlbum.id}
          album={selectedAlbum}
          albums={albums}
          initialAction={initialAction}
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
