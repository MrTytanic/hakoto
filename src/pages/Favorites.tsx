
import { useMemo, useRef, useState } from "react";
import { Heart } from "lucide-react";
import { ProfileAvatar } from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import type { ArtworkChange } from "../artwork";
import type { Album } from "../types/Album";
import { getVisibleAlbums, paginateAlbums } from "../collectionView";
import { collectionPageSizePreference } from "../settings";
import AlbumSearch from "../components/AlbumSearch";
import AlbumPagination from "../components/AlbumPagination";
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
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const favoriteAlbums = useMemo(() => albums.filter(album => album.favorite), [albums]);
  const favorites = useMemo(() => getVisibleAlbums(favoriteAlbums, { query, formats: [], sort: "collection" }), [favoriteAlbums, query]);
  const [pageSize, setPageSize] = useState(collectionPageSizePreference.read);
  const [page, setPage] = useState(0);
  const pagination = useMemo(() => paginateAlbums(favorites, page, Number(pageSize)), [favorites, page, pageSize]);
  if (page !== pagination.pageIndex) setPage(pagination.pageIndex);
  const selectedAlbum = favoriteAlbums.find(album => album.id === selectedId);

  function changeQuery(value: string) {
    setQuery(value);
    setPage(0);
  }

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

      <section className="collection-tools" aria-label="Favorites search">
        <AlbumSearch id="favorites-search" label="Search favorites" query={query}
          onChange={changeQuery} inputRef={searchRef} disabled={favoriteAlbums.length === 0} />
      </section>

      {favoriteAlbums.length === 0 ? (
        <div className="collection-empty">
          <Heart size={42} strokeWidth={1.2} />
          <h2>No favorites yet</h2>
          <p>Favorite albums from your collection to see them here.</p>
        </div>
      ) : favorites.length === 0 ? (
        <div className="collection-empty">
          <h2>No matching favorites</h2>
          <p>Try a different title or artist.</p>
          <button type="button" onClick={() => { changeQuery(""); searchRef.current?.focus(); }}>Show all favorites</button>
        </div>
      ) : (
        <>
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
                  } else if (action === "favorite" || action === "pinned") await onUpdate({ ...album, [action]: !album[action] });
                }}
              />
            ))}
          </div>
          <AlbumPagination label="Favorite pages" pagination={pagination} total={favorites.length} unfilteredTotal={favoriteAlbums.length}
            favorites pageSize={pageSize} onPage={setPage} onSize={size => {
              setPageSize(size);
              collectionPageSizePreference.write(size);
              setPage(0);
            }} />
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
