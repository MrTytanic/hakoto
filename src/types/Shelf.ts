export type ShelfSettings = {
  name: string;
  rows: number;
  columns: number;
  orientation: "vertical" | "horizontal";
};

export type Shelf = ShelfSettings & { id: number };

export type ShelfPlacement = {
  shelfId: number;
  row: number;
  column: number;
  albumId: string;
};

export type ShelfLayout = { shelf: Shelf; placements: ShelfPlacement[] };
