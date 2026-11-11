export type Album = {
  id: string;
  title: string;
  artist: string;
  format: string;
  ownership: "owned" | "wishlist";
  releaseYear: number | null;
  originalReleaseYear?: number | null;
  artwork: string | null;
  favorite: boolean;
  pinned?: boolean;
  dateAdded?: string | null;
  dateAcquired?: string | null;
  notes?: string | null;
  condition?: string | null;
  recordType?: string | null;
  discSize?: string | null;
};
