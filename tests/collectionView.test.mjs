import assert from "node:assert/strict";
import test from "node:test";
import { getVisibleAlbums } from "../src/collectionView.ts";

function album(id, title, artist, format, releaseYear) {
  return Object.freeze({ id, title, artist, format, releaseYear, artwork: null, favorite: false });
}

const albums = Object.freeze([
  album("z", "Zebra", "The Echoes", "CD", "1990"),
  album("a", "afterglow", "North", "CD", ""),
  album("e", "Echoes at Night", "North", "Vinyl (12-inch LP)", "2002"),
  album("m", "Morning", "The Echoes", "CD", "2018"),
  album("s", "Silence", "North", "Cassette", "unknown"),
  album("h", "Horizon", "South", "Vinyl (7-inch / Single)", " 2002 ")
]);

const defaults = { query: "", format: "", sort: "collection" };

function visibleIds(options) {
  return getVisibleAlbums(albums, { ...defaults, ...options }).map(album => album.id);
}

test("searches titles and artists live by a case-insensitive substring", () => {
  assert.deepEqual(visibleIds({ query: "  eChOeS  " }), ["z", "e", "m"]);
  assert.deepEqual(visibleIds({ query: "TERGLOW" }), ["a"]);
  assert.deepEqual(visibleIds({ query: "  " }), ["z", "a", "e", "m", "s", "h"]);
});

test("sorts by title in both directions without changing the collection order", () => {
  assert.deepEqual(visibleIds({ sort: "title-asc" }), ["a", "e", "h", "m", "s", "z"]);
  assert.deepEqual(visibleIds({ sort: "title-desc" }), ["z", "s", "m", "h", "e", "a"]);
  assert.deepEqual(visibleIds(), ["z", "a", "e", "m", "s", "h"]);
});

test("sorts by release year in both directions and keeps unknown years last", () => {
  assert.deepEqual(visibleIds({ sort: "year-newest" }), ["m", "e", "h", "z", "a", "s"]);
  assert.deepEqual(visibleIds({ sort: "year-oldest" }), ["z", "e", "h", "m", "a", "s"]);
});

test("combines search, exact format, and sort", () => {
  assert.deepEqual(visibleIds({ query: "echoes", format: "CD", sort: "year-newest" }), ["m", "z"]);
  assert.deepEqual(visibleIds({ format: "Vinyl (7-inch / Single)" }), ["h"]);
});

test("returns empty results for incompatible filters or an empty collection", () => {
  assert.deepEqual(visibleIds({ query: "echoes", format: "Cassette", sort: "title-asc" }), []);
  assert.deepEqual(getVisibleAlbums([], defaults), []);
});
