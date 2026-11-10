import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let vite;
let Shelves;
let ShelfGrid;
let ShelfDialog;

before(async () => {
  vite = await createServer({
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, ws: false, watch: null }
  });
  ({ default: Shelves } = await vite.ssrLoadModule("/src/pages/Shelves.tsx"));
  ({ default: ShelfGrid } = await vite.ssrLoadModule("/src/components/ShelfGrid.tsx"));
  ({ default: ShelfDialog } = await vite.ssrLoadModule("/src/components/ShelfDialog.tsx"));
});

after(async () => {
  await vite?.close();
});

const album = {
  id: "album", title: "Test Album", artist: "Test Artist", format: "CD",
  releaseYear: "2000", artwork: null, favorite: false
};
const shelf = { id: 1, name: "Listening room", rows: 2, columns: 3, orientation: "vertical" };

function render(Component, props) {
  return renderToStaticMarkup(createElement(Component, props));
}

test("shows the loading shelf workspace above the shared Collection controls and cards", () => {
  const html = render(Shelves, {
    profile: { displayName: "", profilePicture: null },
    albums: [album],
    alphabeticalDividers: false,
    loadStatus: "ready",
    onRetry() {},
    onAdd() {},
    async onUpdate() {},
    async onDelete() {}
  });
  assert.match(html, /Shelf Workspace.*role="status">Loading shelves….*Album Collection.*Search albums.*Sort by.*Format filters.*Test Album/s);
  assert.match(html, /<button[^>]*class="collection-add" disabled=""[^>]*>.*New Shelf/);
});

test("renders every row and column with accessible names for saved and empty positions", () => {
  const html = render(ShelfGrid, {
    shelf,
    albums: [album],
    placements: [
      { shelfId: 1, row: 0, column: 1, albumId: "album" },
      { shelfId: 1, row: 1, column: 2, albumId: "missing" }
    ]
  });
  assert.match(html, /role="region" aria-label="Listening room layout" tabindex="0"/);
  assert.match(html, /data-orientation="vertical"/);
  assert.equal((html.match(/<tr>/g) ?? []).length, 2);
  assert.equal((html.match(/<td\b/g) ?? []).length, 6);
  assert.equal((html.match(/class="shelf-empty-slot"/g) ?? []).length, 4);
  assert.match(html, /aria-label="Row 1, column 2: Test Album — Test Artist"/);
  assert.match(html, /aria-label="Row 2, column 3: Album unavailable"/);
});

test("uses the horizontal stack layout and distinguishes an album that is still loading", () => {
  const html = render(ShelfGrid, {
    shelf: { ...shelf, orientation: "horizontal" },
    albums: [],
    albumsLoading: true,
    placements: [{ shelfId: 1, row: 0, column: 0, albumId: "album" }]
  });
  assert.match(html, /data-orientation="horizontal"/);
  assert.match(html, /<span class="shelf-spine"><span class="shelf-spine-title">Loading album…<\/span>/);
  assert.doesNotMatch(html, /Album unavailable/);
});

test("renders media spines with full tooltips and a neutral fallback before artwork is sampled", () => {
  const albums = [
    { ...album, id: "record", title: "A long vinyl title that may need to be truncated", format: "Vinyl (12-inch LP)", artwork: "00000000000000000000000000000001.webp" },
    { ...album, id: "tape", format: "Cassette" },
    album
  ];
  const html = render(ShelfGrid, {
    shelf: { ...shelf, orientation: "horizontal" },
    albums,
    placements: albums.map(({ id }, column) => ({ shelfId: 1, row: 0, column, albumId: id }))
  });
  assert.match(html, /data-media="record" title="A long vinyl title that may need to be truncated — Test Artist · Vinyl \(12-inch LP\)"/);
  assert.match(html, /class="shelf-spine-title">A long vinyl title that may need to be truncated<\/span>/);
  assert.match(html, /data-media="tape"[^>]*>.*?class="shelf-spine-detail">Cassette<\/span>/);
  assert.match(html, /data-media="case"/);
  assert.doesNotMatch(html, /<img\b|--spine-background/);
});

test("exposes one keyboard tab stop and distinguishes valid and occupied placement targets", () => {
  const html = render(ShelfGrid, {
    shelf,
    albums: [album],
    placements: [{ shelfId: 1, row: 0, column: 0, albumId: "album" }],
    arrangement: {
      source: { albumId: "other" }, hovered: { row: 0, column: 0 }, saving: false,
      onSlot() {}, onDragStart() {}
    }
  });
  assert.equal((html.match(/<button[^>]*tabindex="0"/g) ?? []).length, 1);
  assert.match(html, /data-drop-kind="occupied" data-drop-hovered=""/);
  assert.match(html, /aria-label="Row 1, column 1: Test Album — Test Artist\. Choose an empty slot for this album\."/);
  assert.match(html, /data-drop-kind="place"/);
  assert.match(html, /aria-label="Row 1, column 2: Empty\. Place in empty slot"/);
});

test("uses a native dialog with dimension limits and fills edit fields from the saved shelf", () => {
  const callbacks = { onClose() {}, async onSave() {}, async onDelete() {} };
  const create = render(ShelfDialog, { ...callbacks, action: { kind: "create" } });
  assert.match(create, /<dialog[^>]*aria-labelledby="shelf-dialog-title"/);
  assert.match(create, /<input id="shelf-name"[^>]*maxLength="80" required=""/i);
  for (const id of ["rows", "columns"]) {
    assert.match(create, new RegExp(`<input id="shelf-${id}"[^>]*min="1" max="50" step="1" required=""`));
  }
  const edit = render(ShelfDialog, { ...callbacks, action: { kind: "edit", shelf: { ...shelf, orientation: "horizontal" } } });
  assert.match(edit, /<h2 id="shelf-dialog-title">Edit Shelf<\/h2>/);
  assert.match(edit, /value="Listening room"/);
  assert.match(edit, /<option value="horizontal" selected="">/);
  const remove = render(ShelfDialog, { ...callbacks, action: { kind: "delete", shelf } });
  assert.match(remove, /aria-describedby="shelf-delete-description"/);
  assert.match(remove, /Delete “Listening room” and its placements\? Your albums will remain in the collection\./);
  assert.doesNotMatch(remove, /id="shelf-name"/);
});
