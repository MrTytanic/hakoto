import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { cachedSpinePalette, observeSpine, requestSpinePalette } from "../spineArtwork";
import type { SpinePalette } from "../spineColor";
import type { Album } from "../types/Album";

function mediaStyle(format: string) {
  if (/^(Vinyl|Shellac|Flexi Disc)/.test(format)) return "record";
  if (/^(Cassette|8-Track|Reel-to-Reel)/.test(format)) return "tape";
  return "case";
}

export default memo(function ShelfSpine({ album, fallback }: { album?: Album; fallback: string }) {
  const spine = useRef<HTMLSpanElement>(null);
  const filename = album?.artwork;
  const [sample, setSample] = useState<{ filename: string; palette: SpinePalette | null }>();
  const palette = filename
    ? sample?.filename === filename ? sample.palette : cachedSpinePalette(filename)
    : undefined;

  useEffect(() => {
    if (!filename || !spine.current) return;
    const cached = cachedSpinePalette(filename);
    if (cached !== undefined) {
      if (palette === undefined) setSample({ filename, palette: cached });
      return;
    }
    let cancelSample: (() => void) | undefined;
    const unobserve = observeSpine(spine.current, () => {
      cancelSample = requestSpinePalette(filename, palette => setSample({ filename, palette }));
    });
    return () => {
      cancelSample?.();
      unobserve?.();
    };
  }, [filename]);

  const style = palette ? {
    "--spine-background": `rgb(${palette.color.join(", ")})`,
    "--spine-foreground": palette.text
  } as CSSProperties : undefined;

  return (
    <span
      ref={spine}
      className="shelf-spine"
      data-media={album && mediaStyle(album.format)}
      style={style}
      title={album ? `${album.title} — ${album.artist} · ${album.format}` : undefined}
    >
      <span className="shelf-spine-title">{album?.title ?? fallback}</span>
      {album && <span className="shelf-spine-detail">{album.format}</span>}
    </span>
  );
});
