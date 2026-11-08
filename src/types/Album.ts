export type Album = {
  id: string;
  title: string;
  artist: string;
  format: string;
  releaseYear: string;
  artwork: string | null;
  favorite: boolean;
};