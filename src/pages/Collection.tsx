
import { useMemo, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, ChevronDown, Disc3, Plus, Search, UserRound, X } from "lucide-react";
import type { Profile } from "../types/Profile";
import type { Album } from "../types/Album";
import { albumFormats } from "../constants/albumFormats";
import { getVisibleAlbums, groupVisibleAlbums, type CollectionSort } from "../collectionView";
import AlbumCard from "../components/albumcard/AlbumCard";
import AlbumDetails from "../components/albumdetails/AlbumDetails";
import { ArtworkPicker } from "../components/Artwork";
import { encodeArtwork, type ArtworkChange } from "../artwork";
import "./Collection.css";

export type AlbumLoadStatus = "loading" | "ready" | "error";

type CollectionProps = {
  profile: Profile;
  albums: Album[];
  alphabeticalDividers: boolean;
  loadStatus: AlbumLoadStatus;
  onRetry: () => void;
  onAdd: (album: Album) => void;
  onUpdate: (album: Album, artwork?: ArtworkChange) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onNotify?: (message: string, type: "success" | "error") => void;
};

export function CollectionLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="collection-empty">
      <AlertCircle size={42} strokeWidth={1.2} aria-hidden="true" />
      <div role="alert">
        <h2>Couldn’t load your collection</h2>
        <p>Try loading your saved albums again.</p>
      </div>
      <button type="button" onClick={onRetry}>Try again</button>
    </div>
  );
}

function Collection({
  profile,
  albums,
  alphabeticalDividers,
  loadStatus,
  onRetry,
  onAdd,
  onUpdate,
  onDelete,
  onNotify
}: CollectionProps) {
  const [query, setQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState("");
  const [sort, setSort] = useState<CollectionSort>("collection");
  const searchRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const visibleAlbums = useMemo(
    () => getVisibleAlbums(albums, { query, format: formatFilter, sort }),
    [albums, query, formatFilter, sort]
  );
  const albumGroups = useMemo(
    () => alphabeticalDividers ? groupVisibleAlbums(visibleAlbums, sort) : null,
    [alphabeticalDividers, visibleAlbums, sort]
  );
  const dividersPaused = alphabeticalDividers && albumGroups === null;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [format, setFormat] = useState("CD");
  const [releaseYear, setReleaseYear] = useState("");
  const [artwork, setArtwork] = useState<File | null>(null);

  // Prevents duplicate submissions before React updates isSaving.
  const savingRef = useRef(false);

  const selectedAlbum = albums.find(album => album.id === selectedId);
  const controlsDisabled = loadStatus !== "ready" || albums.length === 0;
  const hasFilters = Boolean(query || formatFilter || sort !== "collection");
  const resultCount = visibleAlbums.length === albums.length
    ? `${albums.length} ${albums.length === 1 ? "album" : "albums"}`
    : `${visibleAlbums.length} of ${albums.length} albums`;

  function clearSearch() {
    setQuery("");
    searchRef.current?.focus();
  }

  function resetFilters() {
    clearSearch();
    setFormatFilter("");
    setSort("collection");
  }

  function notify(message: string, type: "success" | "error" = "error") {
    onNotify?.(message, type);
  }

  function resetForm() {
    setTitle("");
    setArtist("");
    setFormat("CD");
    setReleaseYear("");
    setArtwork(null);
  }

  function closeAddModal() {
    if (savingRef.current) return;

    setIsModalOpen(false);
    resetForm();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (savingRef.current || !title.trim() || !artist.trim()) return;

    const album: Album = {
      id: crypto.randomUUID(),
      title: title.trim(),
      artist: artist.trim(),
      format,
      releaseYear,
      artwork: null,
      favorite: false
    };

    savingRef.current = true;
    setIsSaving(true);

    try {
      const bytes = artwork ? await encodeArtwork(artwork) : null;
      const saved = await invoke<Album>("save_album", { album, artwork: bytes });
      onAdd(saved);
    } catch (error) {
      console.error("Failed to save album:", error);
      notify(error instanceof Error ? error.message : "Failed to save album. Please try again.");
      return;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }

    resetForm();
    setIsModalOpen(false);

    notify(`"${album.title}" added to your collection.`, "success");
  }

  function renderAlbumGrid(items: readonly Album[]) {
    return (
      <div className="album-grid">
        {items.map(album => (
          <AlbumCard key={album.id} album={album} onClick={() => setSelectedId(album.id)} />
        ))}
      </div>
    );
  }

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
              ? `${profile.displayName.trim()}'s Collection`
              : "Your Collection"}
          </h1>
        </div>

        <button
          type="button"
          className="collection-add"
          disabled={loadStatus !== "ready"}
          onClick={() => setIsModalOpen(true)}
        >
          <Plus size={17} />
          Add Album
        </button>
      </div>

      <section className="collection-tools" aria-label="Collection search and filters">
        <div className="collection-primary-tools">
          <div className="album-form-field collection-search">
            <label htmlFor="collection-search">Search albums</label>
            <div className="collection-search-input">
              <Search className="collection-search-icon" size={16} aria-hidden="true" />
              <input
                id="collection-search"
                type="search"
                ref={searchRef}
                value={query}
                disabled={controlsDisabled}
                onChange={e => setQuery(e.target.value)}
                placeholder="Title or artist"
              />
              {query && !controlsDisabled && (
                <button type="button" aria-label="Clear search" onClick={clearSearch}>
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <div className="album-form-field">
            <label htmlFor="collection-sort">Sort by</label>
            <select
              id="collection-sort"
              value={sort}
              disabled={controlsDisabled}
              aria-describedby={dividersPaused ? "collection-dividers-paused" : undefined}
              onChange={e => setSort(e.target.value as CollectionSort)}
            >
              <option value="collection">Date added</option>
              <option value="title-asc">Title A–Z</option>
              <option value="title-desc">Title Z–A</option>
              <option value="year-newest">Release year (newest)</option>
              <option value="year-oldest">Release year (oldest)</option>
            </select>
          </div>
        </div>

        <div className="collection-secondary-tools">
          <p className="collection-result-count" role="status" tabIndex={-1} ref={statusRef}>
            {loadStatus === "loading" ? "Loading your albums…" : loadStatus === "ready" ? resultCount : null}
          </p>

          <details className="collection-filters" inert={controlsDisabled}>
            <summary>
              Filters{formatFilter && <span> · {formatFilter}</span>}
              <ChevronDown size={14} aria-hidden="true" />
            </summary>
            <div className="collection-filter-panel">
              <div className="album-form-field">
                <label htmlFor="collection-format">Format</label>
                <select id="collection-format" value={formatFilter} onChange={e => setFormatFilter(e.target.value)}>
                  <option value="">All formats</option>
                  {albumFormats.map(item => <option key={item}>{item}</option>)}
                </select>
              </div>
              <button type="button" className="album-cancel" disabled={!hasFilters} onClick={resetFilters}>
                Reset filters
              </button>
            </div>
          </details>
        </div>

        {dividersPaused && (
          <p id="collection-dividers-paused" className="collection-divider-note">
            Alphabetical dividers are hidden while sorting by release year.
          </p>
        )}
      </section>

      {loadStatus === "loading" ? (
        <div className="album-grid" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="album-card album-skeleton">
              <div className="album-artwork" />
              <div className="album-skeleton-line" />
              <div className="album-skeleton-line" />
              <div className="album-skeleton-line" />
            </div>
          ))}
        </div>
      ) : loadStatus === "error" ? (
        <CollectionLoadError onRetry={() => {
          statusRef.current?.focus();
          onRetry();
        }} />
      ) : albums.length === 0 ? (
        <div className="collection-empty">
          <Disc3 size={42} strokeWidth={1.2} />
          <h2>Your collection is empty</h2>
          <p>Start building your music collection by adding your first album.</p>

          <button type="button" onClick={() => setIsModalOpen(true)}>
            <Plus size={16} />
            Add Your First Album
          </button>
        </div>
      ) : visibleAlbums.length === 0 ? (
        <div className="collection-empty">
          <Disc3 size={42} strokeWidth={1.2} aria-hidden="true" />
          <h2>No matching albums</h2>
          <p>Try a different title, artist, or format.</p>
          <button type="button" onClick={resetFilters}>Show all albums</button>
        </div>
      ) : albumGroups ? (
        <div className="collection-album-groups">
          {albumGroups.map(({ heading, albums: group }) => {
            const id = `collection-divider-${heading === "#" ? "other" : heading}`;
            return (
              <section key={heading} aria-labelledby={id}>
                <h2 id={id} aria-label={heading === "#" ? "Numbers, symbols, and other titles" : undefined}>
                  {heading}
                </h2>
                {renderAlbumGrid(group)}
              </section>
            );
          })}
        </div>
      ) : renderAlbumGrid(visibleAlbums)}

      {selectedAlbum && (
        <AlbumDetails
          key={selectedAlbum.id}
          album={selectedAlbum}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onError={notify}
          onClose={() => setSelectedId(null)}
        />
      )}

      {isModalOpen && (
        <div
          className="album-modal-overlay"
          onMouseDown={e => {
            if (e.target === e.currentTarget) closeAddModal();
          }}
        >
          <div
            className="album-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-album-title"
            aria-busy={isSaving}
          >
            <div className="album-modal-header">
              <h2 id="add-album-title">Add Album</h2>

              <button
                type="button"
                aria-label="Close"
                onClick={closeAddModal}
                disabled={isSaving}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <fieldset
                disabled={isSaving}
                style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
              >
                <div className="album-form-field">
                  <label htmlFor="album-title">Album Title</label>
                  <input
                    id="album-title"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="album-form-field">
                  <label htmlFor="album-artist">Artist</label>
                  <input
                    id="album-artist"
                    value={artist}
                    onChange={e => setArtist(e.target.value)}
                    required
                  />
                </div>

                <div className="album-form-row">
                  <div className="album-form-field">
                    <label htmlFor="album-format">Format</label>
                    <select
                      id="album-format"
                      value={format}
                      onChange={e => setFormat(e.target.value)}
                    >
                      {albumFormats.map(item => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="album-form-field">
                    <label htmlFor="album-year">Release Year</label>
                    <input
                      id="album-year"
                      type="number"
                      min="1850"
                      max="2100"
                      value={releaseYear}
                      onChange={e => setReleaseYear(e.target.value)}
                    />
                  </div>
                </div>

                <ArtworkPicker
                  artwork={artwork}
                  disabled={isSaving}
                  onChange={setArtwork}
                  onError={notify}
                />

                <div className="album-modal-actions">
                  <button
                    type="button"
                    className="album-cancel"
                    onClick={closeAddModal}
                    disabled={isSaving}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="album-submit"
                    disabled={isSaving}
                  >
                    {isSaving ? "Saving..." : "Add to Collection"}
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Collection;
