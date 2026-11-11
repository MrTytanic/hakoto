import type { Album } from "./types/Album";

function recordedMonth(date: string | null | undefined) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return undefined;
  const parsed = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return undefined;
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

export function collectionStatistics(albums: readonly Album[]) {
  const formats = new Map<string, number>();
  const artists = new Map<string, { name: string; count: number }>();
  const months = new Map<number, number>();
  const ownedIds = new Set<string>();
  let favorites = 0;
  let undated = 0;
  for (const album of albums) {
    if (album.ownership !== "owned" || ownedIds.has(album.id)) continue;
    ownedIds.add(album.id);
    formats.set(album.format, (formats.get(album.format) ?? 0) + 1);
    const name = album.artist.trim();
    if (name) {
      const key = name.normalize("NFC").toLowerCase();
      const artist = artists.get(key);
      if (artist) artist.count++;
      else artists.set(key, { name, count: 1 });
    }
    if (album.favorite) favorites++;
    const month = recordedMonth(album.dateAcquired);
    if (month === undefined) undated++;
    else months.set(month, (months.get(month) ?? 0) + 1);
  }
  const recorded = [...months.keys()].sort((a, b) => a - b);
  const last = recorded[recorded.length - 1];
  const first = last === undefined ? undefined : Math.max(recorded[0], last - 23);
  const earlier = first === undefined ? 0 : [...months].reduce((sum, [month, count]) => sum + (month < first ? count : 0), 0);
  let cumulative = earlier;
  const growth = [];
  if (first !== undefined && last !== undefined) {
    for (let month = first; month <= last; month++) {
      const added = months.get(month) ?? 0;
      cumulative += added;
      growth.push({
        month: `${Math.floor(month / 12).toString().padStart(4, "0")}-${(month % 12 + 1).toString().padStart(2, "0")}`,
        added, cumulative
      });
    }
  }
  return {
    total: ownedIds.size, favorites, undated, earlier, growth,
    artists: [...artists.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    formats: [...formats].sort(([a], [b]) => a.localeCompare(b)).map(([format, count]) => ({ format, count }))
  };
}

export function shelfOccupancy(rows: number, columns: number, occupied: number) {
  const total = rows * columns;
  return { occupied, total, percentage: total ? Math.round(occupied / total * 100) : 0 };
}
