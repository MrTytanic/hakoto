import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let vite;
let Collection;
let artworkUrl;
let Favorites;

before(async () => {
  vite = await createServer({
    server: { middlewareMode: true, ws: false, watch: null }
  });
  ({ default: Collection } = await vite.ssrLoadModule("/src/pages/Collection.tsx"));
  ({ artworkUrl } = await vite.ssrLoadModule("/src/artwork.ts"));
  ({ default: Favorites } = await vite.ssrLoadModule("/src/pages/Favorites.tsx"));
});

after(async () => {
  await vite?.close();
});

test("invalid artwork references fall back before reaching the desktop file protocol", () => {
  for (const filename of [null, "", "../private.webp", "blob:temporary", "https://example.com/image.webp", "00000000000000000000000000000001.webp/extra"]) {
    assert.equal(artworkUrl(filename), null);
  }
});

test("Favorites bounds mounted cards using the saved collection page size", () => {
  const html = renderToStaticMarkup(createElement(Favorites, {
    profile: { displayName: "", profilePicture: null },
    albums: Array.from({ length: 30 }, (_, id) => ({
      id: String(id), title: `Album ${id}`, artist: "Artist", format: "CD",
      releaseYear: "", artwork: null, favorite: true
    })),
    async onUpdate() {}, async onDelete() {}, onNotify() {}
  }));
  assert.equal((html.match(/class="album-card"/g) ?? []).length, 25);
  assert.match(html, /Showing 1–25 of 30 favorites/);
  assert.match(html, /Page 1 of 2/);
});

function render(loadStatus, albums = [], alphabeticalDividers = false) {
  return renderToStaticMarkup(createElement(Collection, {
    profile: { displayName: "", profilePicture: null },
    albums,
    alphabeticalDividers,
    loadStatus,
    onRetry() {},
    onAdd() {},
    async onUpdate() {},
    async onDelete() {}
  }));
}

test("keeps the collection shell visible and announces loading with decorative skeletons", () => {
  const html = render("loading");
  assert.match(html, /<h1>Your Collection<\/h1>/);
  assert.match(html, /role="status"[^>]*>Loading your albums…/);
  assert.match(html, /<div class="album-grid" aria-hidden="true"><div class="album-card album-skeleton">/);
  assert.match(html, /<input[^>]*id="collection-search"[^>]*disabled=""/);
  assert.match(html, /<button[^>]*class="collection-add"[^>]*disabled=""/);
  assert.doesNotMatch(html, /Your collection is empty|No matching albums|Couldn’t load your collection/);
});

test("shows a retry action and no empty message when loading fails", () => {
  const html = render("error");
  assert.match(html, /role="alert"><h2>Couldn’t load your collection<\/h2>/);
  assert.match(html, /<button type="button">Try again<\/button>/);
  assert.doesNotMatch(html, /album-skeleton|Your collection is empty|No matching albums/);
});

test("shows the first-album action after a successful empty load", () => {
  const html = render("ready");
  assert.match(html, /<h2>Your collection is empty<\/h2>/);
  assert.match(html, /Add Your First Album/);
  assert.match(html, /<button type="button" class="collection-add">/);
  assert.doesNotMatch(html, /album-skeleton|Try again/);
});

test("shows loaded albums, with search and sort beside the format popover", () => {
  const html = render("ready", [{
    id: "album", title: "Test Album", artist: "Test Artist", format: "CD",
    releaseYear: "2000", artwork: null, favorite: false
  }]);
  assert.match(html, /<label for="collection-search">Search albums<\/label>.*<label for="collection-sort">Sort by<\/label>.*aria-label="Format filters".*popover="auto".*type="checkbox"/s);
  assert.match(html, /<legend>Formats<\/legend>/);
  assert.match(html, /role="status"[^>]*>Showing 1–1 of 1/);
  assert.match(html, /<h3 title="Test Album">Test Album<\/h3>/);
  assert.doesNotMatch(html, /album-skeleton|Try again|Your collection is empty/);
});

test("renders only the default page and provides labeled pagination controls", () => {
  const albums = Array.from({ length: 30 }, (_, id) => ({
    id: String(id), title: `Album ${id}`, artist: "Artist", format: "CD",
    releaseYear: "", artwork: null, favorite: false
  }));
  const html = render("ready", albums);
  assert.equal((html.match(/class="album-card"/g) ?? []).length, 25);
  assert.match(html, /aria-label="Collection pages"/);
  assert.match(html, /Showing 1–25 of 30/);
  assert.match(html, /Page 1 of 2/);
  assert.match(html, /<option value="25" selected="">25<\/option>/);
  assert.doesNotMatch(html, /title="Album 25"/);
});

test("restores list view with album details, pin indicator and the existing actions", t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: key => key === "hakoto.collectionView" ? "list" : null }
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  });
  const html = render("ready", [{
    id: "album", title: "Test Album", artist: "Test Artist", format: "CD",
    releaseYear: "", artwork: null, favorite: true, pinned: true
  }]);
  assert.match(html, /class="album-list"/);
  assert.match(html, /aria-label="List view" aria-pressed="true"/);
  assert.match(html, /data-view="list"/);
  assert.match(html, /aria-label="Pinned"/);
  assert.doesNotMatch(html, /album-favorite-indicator|aria-label="Favorite"/);
  assert.match(html, /Test Album.*Test Artist.*CD/s);
  assert.match(html, /Unfavorite.*Unpin.*Edit.*Delete/s);
});

test("renders accessible headings and the existing card grid when dividers are enabled", () => {
  const albums = ["Zebra", "7 Steps"].map((title, id) => ({
    id: String(id), title, artist: "Test Artist", format: "CD",
    releaseYear: "2000", artwork: null, favorite: false
  }));
  const html = render("ready", albums, true);
  assert.match(html, /<section aria-labelledby="collection-divider-Z"><h2 id="collection-divider-Z">Z<\/h2><div class="album-grid">/);
  assert.match(html, /<h2 id="collection-divider-other" aria-label="Numbers, symbols, and other titles">#<\/h2>/);
  assert.doesNotMatch(render("ready", albums), /collection-divider-Z|collection-divider-other/);
  assert.doesNotMatch(render("ready", [], true), /collection-album-groups/);
});
