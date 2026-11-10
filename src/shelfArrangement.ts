import type { Shelf, ShelfPlacement, ShelfPlacementChange, ShelfSlot } from "./types/Shelf";

export type ArrangementSource = { albumId: string; slot?: ShelfSlot };

export function slotKey(slot: ShelfSlot) {
  return `${slot.row}:${slot.column}`;
}

export function placementIndex(placements: ShelfPlacement[]) {
  return new Map(placements.map(slot => [slotKey(slot), slot.albumId]));
}

export function dropKind(source: ArrangementSource, target: ShelfSlot, occupant: string | undefined) {
  if (source.slot && slotKey(source.slot) === slotKey(target)) return "origin";
  if (occupant !== undefined) return source.slot ? "swap" : "occupied";
  return source.slot ? "move" : "place";
}

export function slotDescription(slot: ShelfSlot) {
  return `row ${slot.row + 1}, column ${slot.column + 1}`;
}

export function dropHint(kind: ReturnType<typeof dropKind> | undefined) {
  switch (kind) {
    case "place": return "Place in empty slot";
    case "move": return "Move to empty slot";
    case "swap": return "Swap these albums";
    case "occupied": return "Choose an empty slot for this album.";
    case "origin": return "Choose a different slot.";
    default: return "Drop on a shelf slot.";
  }
}

type DropResult = { error: string } | { placements: ShelfPlacement[]; kind: "place" | "move" | "swap"; target: ShelfSlot };

export async function saveShelfDrop(
  shelf: Pick<Shelf, "rows" | "columns">,
  slots: ReadonlyMap<string, string>,
  source: ArrangementSource,
  target: ShelfSlot | null,
  save: (changes: ShelfPlacementChange[]) => Promise<ShelfPlacement[]>
): Promise<DropResult> {
  if (!target || !Number.isInteger(target.row) || !Number.isInteger(target.column) ||
    target.row < 0 || target.row >= shelf.rows || target.column < 0 || target.column >= shelf.columns) {
    return { error: dropHint(undefined) };
  }
  const occupant = slots.get(slotKey(target));
  const kind = dropKind(source, target, occupant);
  if (kind === "origin" || kind === "occupied") return { error: dropHint(kind) };
  if (source.slot && slots.get(slotKey(source.slot)) !== source.albumId) {
    return { error: "That album is no longer in its original slot." };
  }

  const changes: ShelfPlacementChange[] = [{ ...target, kind: "set", albumId: source.albumId }];
  if (source.slot) {
    changes.push(occupant === undefined
      ? { ...source.slot, kind: "clear" }
      : { ...source.slot, kind: "set", albumId: occupant });
  }
  // Keep the displayed placements unchanged until the backend confirms the batch.
  return { placements: await save(changes), kind, target };
}
