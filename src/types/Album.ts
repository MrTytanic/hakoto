export type Album = {
  id: string;
  title: string;
  artist: string;
  format: string;
  releaseYear: string;
  artwork: string | null;
  favorite: boolean;
  pinned?: boolean;
  dateAdded?: string | null;
  condition?: string | null;
  recordType?: string | null;
  discSize?: string | null;
};