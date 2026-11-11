import { useEffect, useState, type ReactNode } from "react";
import { ImagePlus } from "lucide-react";
import { artworkUrl, checkArtworkFile } from "../artwork";

export function ArtworkImage({ src, alt, fallback, lazy = false }: {
  src: string | null;
  alt: string;
  fallback: ReactNode;
  lazy?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return src && failedSrc !== src ? (
    <img
      src={src}
      alt={alt}
      loading={lazy ? "lazy" : "eager"}
      decoding="async"
      onError={() => setFailedSrc(src)}
    />
  ) : fallback;
}

export function ArtworkPicker({ artwork, filename = null, disabled, onChange, onError }: {
  artwork: File | null | undefined;
  filename?: string | null;
  disabled: boolean;
  onChange: (artwork: File | null) => void;
  onError: (message: string) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!artwork) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(artwork);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [artwork]);

  const src = artwork === undefined ? artworkUrl(filename) : artwork ? preview : null;

  return (
    <div className="album-form-field">
      <span className="artwork-field-label">Album Artwork</span>
      <label className="album-artwork-upload">
        <input
          type="file"
          aria-label="Upload cover art"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled}
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
              checkArtworkFile(file);
              onChange(file);
            } catch (error) {
              onError((error as Error).message);
            }
          }}
        />
        <ArtworkImage src={src} alt="Artwork preview" fallback={
          <>
            <ImagePlus size={25} />
            <span>Upload Cover Art</span>
            <small>PNG, JPG, or WebP (max 5 MB)</small>
          </>
        } />
      </label>
      {(artwork || (artwork === undefined && filename)) && (
        <button
          type="button"
          className="album-cancel artwork-remove"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Remove Artwork
        </button>
      )}
    </div>
  );
}
