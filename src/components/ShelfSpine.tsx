import { useEffect, useRef, useState, type CSSProperties } from "react";
import { observeSpine, spinePalettes } from "../spineArtwork";
import type { SpinePalette } from "../spineColor";
import type { Album } from "../types/Album";

function mediaStyle(format: string) {
  if (/^(Vinyl|Shellac|Flexi Disc)/.test(format)) return "record";
  if (/^(Cassette|8-Track|Reel-to-Reel)/.test(format)) return "tape";
  return "case";
}

export default function ShelfSpine({ album, fallback }: { album?: Album; fallback: string }) {
  const spine = useRef<HTMLSpanElement>(null);
  const filename = album?.artwork;
  const [sample, setSample] = useState<{ filename: string; palette: SpinePalette | null }>();
  const palette = filename
    ? sample?.filename === filename ? sample.palette : spinePalettes.get(filename)
    : undefined;

  useEffect(() => {
    if (!filename || !spine.current) return;
    const cached = spinePalettes.get(filename);
    if (cached !== undefined) {
      setSample({ filename, palette: cached });
      return;
    }
    let cancelled = false;
    const unobserve = observeSpine(spine.current, () => {
      void spinePalettes.request(filename).then(palette => {
        if (!cancelled) setSample({ filename, palette });
      });
    });
    return () => {
      cancelled = true;
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
}
