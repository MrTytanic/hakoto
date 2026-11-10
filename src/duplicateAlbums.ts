import type { Album } from "./types/Album";

const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function findDuplicateAlbum(albums: readonly Album[], candidate: Pick<Album, "title" | "artist" | "format"> & { id?: string }) {
  const title = normalize(candidate.title);
  const artist = normalize(candidate.artist);
  if (!title || !artist) return undefined;
  return albums.find(album => album.id !== candidate.id &&
    normalize(album.title) === title && normalize(album.artist) === artist &&
    normalize(album.format) === normalize(candidate.format));
}
