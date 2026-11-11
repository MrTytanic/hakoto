import type { Album } from "./types/Album";

export type CollectionSort = "collection" | "title-asc" | "title-desc" | "year-newest" | "year-oldest";

type CollectionView = {
  query: string;
  formats: readonly string[];
  sort: CollectionSort;
};

const titleOrder = new Intl.Collator(undefined, { sensitivity: "base" });

export function paginateAlbums(albums: readonly Album[], requestedPage: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(albums.length / pageSize));
  const pageIndex = Math.max(0, Math.min(requestedPage, pageCount - 1));
  const start = pageIndex * pageSize;
  const end = Math.min(start + pageSize, albums.length);
  return { pageIndex, pageCount, start, end, albums: albums.slice(start, end) };
}

function releaseYear(value: string): number | undefined {
  const year = value.trim();
  if (/^\d{4}$/.test(year) && year !== "0000") return Number(year);
}

export function getVisibleAlbums(albums: readonly Album[], { query, formats, sort }: CollectionView): Album[] {
  const search = query.trim().toLowerCase();
  const prioritizePinned = !search;
  const pinned = prioritizePinned ? albums.filter(album => album.pinned) : [];
  const matches = albums.filter(album => (!prioritizePinned || !album.pinned) &&
    (!formats.length || formats.includes(album.format)) &&
    (!search || album.title.toLowerCase().includes(search) || album.artist.toLowerCase().includes(search))
  );

  const sorted = sortMatches(matches, sort);
  return [...pinned, ...sorted];
}

function sortMatches(matches: Album[], sort: CollectionSort) {
  switch (sort) {
    case "title-asc":
      return matches.sort((a, b) => titleOrder.compare(a.title, b.title));
    case "title-desc":
      return matches.sort((a, b) => titleOrder.compare(b.title, a.title));
    case "year-newest":
    case "year-oldest": {
      const missingYear = sort === "year-newest" ? -Infinity : Infinity;
      return matches.sort((a, b) => {
        const aYear = releaseYear(a.releaseYear) ?? missingYear;
        const bYear = releaseYear(b.releaseYear) ?? missingYear;
        if (aYear === bYear) return 0;
        return sort === "year-newest" ? bYear - aYear : aYear - bYear;
      });
    }
    case "collection":
      return matches;
  }
}

export function groupVisibleAlbums(albums: readonly Album[], sort: CollectionSort, prioritizePinned = true) {
  if (sort === "year-newest" || sort === "year-oldest") return null;

  // Albums already reflect the active filters and sort order.
  const buckets = new Map<string, Album[]>();
  const pinned = prioritizePinned ? albums.filter(album => album.pinned) : [];
  for (const album of albums) {
    if (prioritizePinned && album.pinned) continue;
    const initial = album.title.trimStart().normalize("NFD").match(/^[a-z]/i)?.[0];
    const heading = initial?.toUpperCase() ?? "#";
    const group = buckets.get(heading);
    if (group) group.push(album);
    else buckets.set(heading, [album]);
  }

  const other = buckets.get("#");
  buckets.delete("#");
  const groups = Array.from(buckets, ([heading, albums]) => ({ heading, albums }));
  groups.sort((a, b) => a.heading.charCodeAt(0) - b.heading.charCodeAt(0));
  if (sort === "title-desc") groups.reverse();
  if (other) groups.push({ heading: "#", albums: other });
  if (pinned.length) groups.unshift({ heading: "Pinned", albums: pinned });
  return groups;
}
