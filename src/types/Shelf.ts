export type ShelfSettings = {
  name: string;
  rows: number;
  columns: number;
  orientation: "vertical" | "horizontal";
};

export type Shelf = ShelfSettings & { id: number };

export type ShelfSlot = {
  row: number;
  column: number;
};

export type ShelfPlacement = ShelfSlot & {
  shelfId: number;
  albumId: string;
};

export type ShelfPlacementChange = ShelfSlot & (
  { kind: "set"; albumId: string } | { kind: "clear" }
);

export type ShelfLayout = { shelf: Shelf; placements: ShelfPlacement[] };
