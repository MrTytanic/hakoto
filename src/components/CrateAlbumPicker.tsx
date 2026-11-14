import { useCallback, useMemo, useRef, useState } from "react";
import type { Album } from "../types/Album";
import { albumReleaseYear, getVisibleAlbums, type CollectionSort } from "../collectionView";
import { collectionViewPreference } from "../settings";
import AlbumSearch from "./AlbumSearch";
import AlbumCard from "./albumcard/AlbumCard";
import { AlbumFormatOptions, CollectionSortSelect, CollectionViewToggle } from "./CollectionControls";

const PAGE_SIZE = 10;

export default function CrateAlbumPicker({ albums, selected, onToggle, allowSelectedOnly = false }: {
  albums: readonly Album[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  allowSelectedOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CollectionSort>("collection");
  const [view, setView] = useState(collectionViewPreference.read);
  const [artist, setArtist] = useState("");
  const [year, setYear] = useState("");
  const [formats, setFormats] = useState<string[]>([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const selectedControl = useRef<HTMLInputElement>(null);
  const selectedFilter = selectedOnly ? selected : undefined;

  const options = useMemo(() => ({
    artists: [...new Set(albums.map(album => album.artist).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    formats: [...new Set(albums.map(album => album.format))].sort((a, b) => a.localeCompare(b)),
    years: [...new Set(albums.flatMap(album => [album.releaseYear, album.originalReleaseYear])
      .filter((value): value is number => value != null))].sort((a, b) => b - a),
    hasUnknownYear: albums.some(album => albumReleaseYear(album) == null)
  }), [albums]);

  const matches = useMemo(() => {
    const releaseYear = Number(year);
    const scoped = !selectedFilter && !artist && !year ? albums : albums.filter(album => (!selectedFilter || selectedFilter.has(album.id)) &&
      (!artist || album.artist === artist) && (!year || (
      year === "unknown" ? albumReleaseYear(album) == null
        : album.releaseYear === releaseYear || album.originalReleaseYear === releaseYear
    )));
    return getVisibleAlbums(scoped, { query, formats, sort, prioritizePinned: false });
  }, [albums, artist, year, query, formats, sort, selectedFilter]);

  const toggleAlbum = useCallback((id: string) => {
    if (selectedOnly) selectedControl.current?.focus();
    onToggle(id);
  }, [selectedOnly, onToggle]);

  function resetFilters() {
    setArtist("");
    setYear("");
    setFormats([]);
    setLimit(PAGE_SIZE);
  }

  function loadMore() {
    setLimit(limit + PAGE_SIZE);
    requestAnimationFrame(() => results.current?.querySelectorAll("button")[limit]?.focus());
  }

  return (
    <section className="crate-picker collection-tools" aria-labelledby="crate-picker-title" onKeyDown={event => {
      if (event.key === "Enter" && event.target === search.current) event.preventDefault();
    }}>
      <h3 id="crate-picker-title">Select albums</h3>
      <div className="collection-primary-tools crate-picker-toolbar">
        <AlbumSearch id="crate-album-search" query={query} inputRef={search} onChange={value => {
          setQuery(value);
          setLimit(PAGE_SIZE);
        }} />
        <CollectionSortSelect id="crate-album-sort" sort={sort} onChange={value => {
          setSort(value);
          setLimit(PAGE_SIZE);
        }} />
        <CollectionViewToggle label="Album picker view" view={view} onChange={setView} />
      </div>
      {albums.length > 0 && <details className="crate-picker-filters">
        <summary>Filters{(artist || year || formats.length > 0) ? " (active)" : ""}</summary>
        <div className="album-form-row">
          <div className="album-form-field">
            <label htmlFor="crate-filter-artist">Artist</label>
            <select id="crate-filter-artist" value={artist} onChange={event => {
              setArtist(event.target.value);
              setLimit(PAGE_SIZE);
            }}>
              <option value="">All artists</option>
              {options.artists.map(value => <option key={value}>{value}</option>)}
            </select>
          </div>
          <div className="album-form-field">
            <label htmlFor="crate-filter-year">Release year</label>
            <select id="crate-filter-year" value={year} onChange={event => {
              setYear(event.target.value);
              setLimit(PAGE_SIZE);
            }}>
              <option value="">All years</option>
              {options.years.map(value => <option key={value}>{value}</option>)}
              {options.hasUnknownYear && <option value="unknown">Unknown</option>}
            </select>
          </div>
        </div>
        <AlbumFormatOptions options={options.formats} formats={formats} onToggle={(format, checked) => {
          setFormats(current => checked ? [...current, format] : current.filter(item => item !== format));
          setLimit(PAGE_SIZE);
        }} />
        <button className="album-cancel" type="button" onClick={resetFilters} disabled={!artist && !year && !formats.length}>Clear filters</button>
      </details>}
      {allowSelectedOnly && <label className="crate-selected-filter">
        <input type="checkbox" ref={selectedControl} checked={selectedOnly} onChange={event => {
          setSelectedOnly(event.target.checked);
          setLimit(PAGE_SIZE);
        }} />Show selected albums only
      </label>}
      <p className="crate-picker-count" role="status">
        {!albums.length ? "No albums in your collection yet." : !matches.length ? "No matching albums." : `Showing ${Math.min(limit, matches.length)} of ${matches.length} albums`}
      </p>
      <div ref={results} className={view === "list" ? "album-list" : "album-grid"}>
        {matches.slice(0, limit).map(album => <AlbumCard key={album.id} album={album} view={view}
          selected={selected.has(album.id)} onClick={toggleAlbum} />)}
      </div>
      {limit < matches.length && <button type="button" className="album-cancel crate-picker-more" onClick={loadMore}>Load More</button>}
    </section>
  );
}
