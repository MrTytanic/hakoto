import type { Album } from "./types/Album";

export type CollectionSort = "collection" | "title-asc" | "title-desc" | "year-newest" | "year-oldest";

type CollectionView = {
  query: string;
  format: string;
  sort: CollectionSort;
};

const titleOrder = new Intl.Collator(undefined, { sensitivity: "base" });

function releaseYear(value: string): number | undefined {
  const year = value.trim();
  if (/^\d{4}$/.test(year) && year !== "0000") return Number(year);
}

export function getVisibleAlbums(albums: readonly Album[], { query, format, sort }: CollectionView): Album[] {
  const search = query.trim().toLowerCase();
  const matches = albums.filter(album =>
    (!format || album.format === format) &&
    (!search || album.title.toLowerCase().includes(search) || album.artist.toLowerCase().includes(search))
  );

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

export function groupVisibleAlbums(albums: readonly Album[], sort: CollectionSort) {
  if (sort === "year-newest" || sort === "year-oldest") return null;

  // Albums already reflect the active filters and sort order.
  const buckets = new Map<string, Album[]>();
  for (const album of albums) {
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
  return groups;
}
