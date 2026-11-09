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
