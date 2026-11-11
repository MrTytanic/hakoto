
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, Disc3, Grid2X2, List, Plus, SlidersHorizontal, X } from "lucide-react";
import { ProfileAvatar } from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import type { Album } from "../types/Album";
import { albumFormats } from "../constants/albumFormats";
import { getVisibleAlbums, groupVisibleAlbums, paginateAlbums, type CollectionSort } from "../collectionView";
import { collectionPageSizePreference, collectionViewPreference } from "../settings";
import AlbumMetadataFields, { AlbumReleaseFields, albumMetadata, albumReleaseDraft, albumReleaseMetadata, type AlbumMetadata } from "../components/AlbumMetadataFields";
import AlbumSearch from "../components/AlbumSearch";
import AlbumPagination from "../components/AlbumPagination";
import AlbumCard from "../components/albumcard/AlbumCard";
import AlbumDetails from "../components/albumdetails/AlbumDetails";
import { ArtworkPicker } from "../components/Artwork";
import { encodeArtwork, type ArtworkChange } from "../artwork";
import type { UndoNotice } from "../components/toast/Toast";
import { findDuplicateAlbum } from "../duplicateAlbums";
import "./Collection.css";

export type AlbumLoadStatus = "loading" | "ready" | "error";

export type CollectionProps = {
  onUndo?: UndoNotice;
  shelfRevision?: number;
  profile: Profile;
  albums: Album[];
  alphabeticalDividers: boolean;
  embedded?: boolean;
  albumAction?: (album: Album) => ReactNode;
  onAlbumPointerDown?: (event: PointerEvent<HTMLButtonElement>, album: Album) => void;
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
  embedded = false,
  albumAction,
  onAlbumPointerDown,
  loadStatus,
  onRetry,
  onAdd,
  onUpdate,
  onDelete,
  onNotify
}: CollectionProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState(collectionViewPreference.read);
  useEffect(() => { collectionViewPreference.write(view); }, [view]);
  const [pageSize, setPageSize] = useState(collectionPageSizePreference.read);
  useEffect(() => { collectionPageSizePreference.write(pageSize); }, [pageSize]);
  const [formats, setFormats] = useState<string[]>([]);
  const filterId = useId();
  const filterButton = useRef<HTMLButtonElement>(null);
  const filterPanel = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<CollectionSort>("collection");
  const searchRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const visibleAlbums = useMemo(
    () => getVisibleAlbums(albums, { query, formats, sort }),
    [albums, query, formats, sort]
  );
  const prioritizePinned = !query.trim();
  const allGroups = useMemo(
    () => alphabeticalDividers ? groupVisibleAlbums(visibleAlbums, sort, prioritizePinned) : null,
    [alphabeticalDividers, visibleAlbums, sort, prioritizePinned]
  );
  const orderedAlbums = useMemo(
    () => allGroups ? allGroups.flatMap(group => group.albums) : visibleAlbums,
    [allGroups, visibleAlbums]
  );
  const pageScope = useMemo(
    () => ({ query, formats, sort, pageSize, alphabeticalDividers }),
    [query, formats, sort, pageSize, alphabeticalDividers]
  );
  const [page, setPage] = useState({ scope: pageScope, index: 0 });
  const pagination = useMemo(
    () => paginateAlbums(orderedAlbums, page.scope === pageScope ? page.index : 0, Number(pageSize)),
    [orderedAlbums, page, pageScope, pageSize]
  );
  // Adjust before rendering a changed result set so no stale or empty page flashes.
  if (page.scope !== pageScope || page.index !== pagination.pageIndex) {
    setPage({ scope: pageScope, index: pagination.pageIndex });
  }
  const albumGroups = useMemo(
    () => allGroups ? groupVisibleAlbums(pagination.albums, sort, prioritizePinned) : null,
    [allGroups, pagination.albums, sort, prioritizePinned]
  );
  const dividersPaused = alphabeticalDividers && allGroups === null;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [albumActionMode, setAlbumActionMode] = useState<"edit" | "delete">();
  const [metadata, setMetadata] = useState<AlbumMetadata>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [format, setFormat] = useState("CD");
  const [release, setRelease] = useState(albumReleaseDraft);
  const [artwork, setArtwork] = useState<File | null>(null);

  // Prevents duplicate submissions before React updates isSaving.
  const savingRef = useRef(false);

  const selectedAlbum = albums.find(album => album.id === selectedId);
  const duplicate = findDuplicateAlbum(albums, { title, artist, format });
  const controlsDisabled = loadStatus !== "ready" || albums.length === 0;
  const hasFilters = Boolean(query || formats.length || sort !== "collection");
  const GroupHeading = embedded ? "h3" : "h2";

  useEffect(() => {
    const panel = filterPanel.current;
    const button = filterButton.current;
    if (!panel || !button) return;
    const scroller = button.closest("main");

    function position() {
      if (!panel?.matches(":popover-open") || !button) return;
      const anchor = button.getBoundingClientRect();
      const viewport = scroller?.getBoundingClientRect();
      if (anchor.bottom <= Math.max(0, viewport?.top ?? 0) ||
          anchor.top >= Math.min(window.innerHeight, viewport?.bottom ?? Infinity)) {
        panel.hidePopover();
        return;
      }
      const below = window.innerHeight - anchor.bottom - 14;
      const above = anchor.top - 14;
      const opensDown = below >= 280 || below >= above;
      panel.style.left = Math.max(8, Math.min(anchor.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8)) + "px";
      panel.style.top = opensDown ? anchor.bottom + 6 + "px" : "auto";
      panel.style.bottom = opensDown ? "auto" : window.innerHeight - anchor.top + 6 + "px";
      panel.style.maxHeight = Math.max(0, opensDown ? below : above) + "px";
    }

    panel.addEventListener("toggle", position);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      panel.removeEventListener("toggle", position);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, []);

  function clearSearch() {
    setQuery("");
    searchRef.current?.focus();
  }

  function resetFilters() {
    filterPanel.current?.hidePopover();
    clearSearch();
    setFormats([]);
    setSort("collection");
  }

  function notify(message: string, type: "success" | "error" = "error") {
    onNotify?.(message, type);
  }

  function resetForm() {
    setTitle("");
    setArtist("");
    setFormat("CD");
    setRelease(albumReleaseDraft());
    setMetadata({});
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
      ...albumReleaseMetadata(release),
      artwork: null,
      favorite: false,
      ...albumMetadata(metadata, format)
    };

    savingRef.current = true;
    setIsSaving(true);

    try {
      const bytes = artwork ? await encodeArtwork(artwork) : null;
      const saved = await invoke<Album>("save_album", { album, artwork: bytes });
      onAdd(saved);
    } catch (error) {
      console.error("Failed to save album:", error);
      notify(typeof error === "string" ? error : error instanceof Error ? error.message : "Failed to save album. Please try again.");
      return;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }

    resetForm();
    setIsModalOpen(false);

    notify(`"${album.title}" added to your collection.`, "success");
  }

  function openAlbum(id: string, action?: "edit" | "delete") {
    setAlbumActionMode(action);
    setSelectedId(id);
  }

  function renderAlbumCard(album: Album) {
    return <AlbumCard key={album.id} album={album} view={view} onClick={() => openAlbum(album.id)}
      onPointerDown={onAlbumPointerDown ? event => onAlbumPointerDown(event, album) : undefined}
      onAction={async action => {
        if (action === "edit" || action === "delete") openAlbum(album.id, action);
        else await onUpdate({ ...album, [action]: !album[action] });
      }} />;
  }

  function renderAlbumGrid(items: readonly Album[]) {
    return (
      <div className={view === "list" ? "album-list" : "album-grid"}>
        {items.map(album => albumAction ? (
          <div key={album.id} className="shelf-album-card">
            {renderAlbumCard(album)}
            {albumAction(album)}
          </div>
        ) : renderAlbumCard(album))}
      </div>
    );
  }

  return (
    <div className="collection-page">
      <div className="collection-top">
        {embedded ? <h2 id="shelf-album-collection-title">Album Collection</h2> : (
          <div className="collection-header">
            <ProfileAvatar picture={profile.profilePicture} />

            <h1>
              {profile.displayName.trim()
                ? `${profile.displayName.trim()}'s Collection`
                : "Your Collection"}
            </h1>
          </div>
        )}

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
          <AlbumSearch id="collection-search" query={query} onChange={setQuery} inputRef={searchRef} disabled={controlsDisabled} />

          <div className="collection-sort-tools">
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
            <button type="button" className="collection-filter-toggle" ref={filterButton} popoverTarget={filterId}
              disabled={controlsDisabled} aria-label={formats.length ? `Format filters, ${formats.length} selected` : "Format filters"}>
              <SlidersHorizontal size={17} aria-hidden="true" />
              {formats.length > 0 && <span aria-hidden="true">{formats.length}</span>}
            </button>
            <div id={filterId} ref={filterPanel} popover="auto" className="collection-filter-panel" inert={controlsDisabled}>
              <fieldset>
                <legend>Formats</legend>
                {albumFormats.map(item => (
                  <label key={item}>
                    <input type="checkbox" checked={formats.includes(item)} onChange={event => {
                      const checked = event.target.checked;
                      setFormats(current => checked ? [...current, item] : current.filter(format => format !== item));
                    }} />
                    {item}
                  </label>
                ))}
              </fieldset>
              <div className="collection-filter-actions">
                <button type="button" className="album-cancel" aria-disabled={!formats.length}
                  onClick={() => { if (formats.length) setFormats([]); }}>Clear formats</button>
                <button type="button" className="album-cancel" disabled={!hasFilters} onClick={resetFilters}>Reset filters</button>
              </div>
            </div>
          </div>
        </div>

        <div className="collection-secondary-tools">
          <p className="collection-result-count" role="status" tabIndex={-1} ref={statusRef}>
            {loadStatus === "loading" ? "Loading your albums…" : null}
          </p>
          <div className="collection-view-toggle" role="group" aria-label="Collection view">
            <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
              <Grid2X2 size={17} aria-hidden="true" />
            </button>
            <button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}>
              <List size={17} aria-hidden="true" />
            </button>
          </div>
        </div>

        {dividersPaused && (
          <p id="collection-dividers-paused" className="collection-divider-note">
            Alphabetical dividers are hidden while sorting by release year.
          </p>
        )}
      </section>

      {loadStatus === "loading" ? (
        <div className={view === "list" ? "album-list" : "album-grid"} aria-hidden="true">
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
                <GroupHeading id={id} aria-label={heading === "#" ? "Numbers, symbols, and other titles" : undefined}>
                  {heading}
                </GroupHeading>
                {renderAlbumGrid(group)}
              </section>
            );
          })}
        </div>
      ) : renderAlbumGrid(pagination.albums)}

      {loadStatus === "ready" && visibleAlbums.length > 0 && (
        <AlbumPagination label="Collection pages" pagination={pagination} total={visibleAlbums.length} unfilteredTotal={albums.length}
          pageSize={pageSize} onSize={setPageSize} onPage={index => setPage({ scope: pageScope, index })} />
      )}

      {selectedAlbum && (
        <AlbumDetails
          key={selectedAlbum.id}
          album={selectedAlbum}
          albums={albums}
          initialAction={albumActionMode}
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
                    maxLength={500}
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="album-form-field">
                  <label htmlFor="album-artist">Artist</label>
                  <input
                    id="album-artist"
                    maxLength={300}
                    value={artist}
                    onChange={e => setArtist(e.target.value)}
                    required
                  />
                </div>

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

                {duplicate && <p className="duplicate-warning" role="status">An album with this title, artist, and format already exists. You can still save another copy or edition.</p>}
                <AlbumMetadataFields format={format} value={metadata} onChange={setMetadata} disabled={isSaving} />
                <p className="album-date-note">Date added is recorded automatically.</p>
                <AlbumReleaseFields value={release} onChange={setRelease} disabled={isSaving} />

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
