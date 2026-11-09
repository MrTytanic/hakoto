import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let vite;
let Collection;

before(async () => {
  vite = await createServer({
    server: { middlewareMode: true, ws: false, watch: null }
  });
  ({ default: Collection } = await vite.ssrLoadModule("/src/pages/Collection.tsx"));
});

after(async () => {
  await vite?.close();
});

function render(loadStatus, albums = []) {
  return renderToStaticMarkup(createElement(Collection, {
    profile: { displayName: "", profilePicture: null },
    albums,
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

test("shows loaded albums, with search and sort before the collapsed format disclosure", () => {
  const html = render("ready", [{
    id: "album", title: "Test Album", artist: "Test Artist", format: "CD",
    releaseYear: "2000", artwork: null, favorite: false
  }]);
  assert.match(html, /<label for="collection-search">Search albums<\/label>.*<label for="collection-sort">Sort by<\/label>.*<details class="collection-filters"><summary>Filters/s);
  assert.match(html, /<label for="collection-format">Format<\/label>/);
  assert.match(html, /role="status"[^>]*>1 album/);
  assert.match(html, /<h3 title="Test Album">Test Album<\/h3>/);
  assert.doesNotMatch(html, /album-skeleton|Try again|Your collection is empty/);
});
