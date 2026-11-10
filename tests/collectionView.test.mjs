import assert from "node:assert/strict";
import test from "node:test";
import { getVisibleAlbums, groupVisibleAlbums } from "../src/collectionView.ts";

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

const defaults = { query: "", formats: [], sort: "collection" };

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
  assert.deepEqual(visibleIds({ query: "echoes", formats: ["CD"], sort: "year-newest" }), ["m", "z"]);
  assert.deepEqual(visibleIds({ formats: ["Vinyl (7-inch / Single)"] }), ["h"]);
  assert.deepEqual(visibleIds({ query: "North", formats: ["Cassette", "CD"], sort: "title-asc" }), ["a", "s"]);
});

test("returns empty results for incompatible filters or an empty collection", () => {
  assert.deepEqual(visibleIds({ query: "echoes", formats: ["Cassette"], sort: "title-asc" }), []);
  assert.deepEqual(getVisibleAlbums([], defaults), []);
});

const dividerAlbums = Object.freeze([
  album("zebra", "Zebra", "North", "CD", "1990"),
  album("apple", "Apple", "North", "CD", "2003"),
  album("afterglow", "afterglow", "North", "CD", "1995"),
  album("number", "7 Steps", "North", "CD", "1992"),
  album("accent", "  Élan", "South", "Cassette", "2000"),
  album("symbol", "#Live", "North", "Vinyl (12-inch LP)", "2004"),
  album("emoji", "🎵 Mixtape", "North", "CD", "2005"),
  album("non-latin", "夜", "North", "CD", "2006"),
  album("blank", " ", "North", "CD", "2007")
]);

function dividedIds(options = {}) {
  const view = { ...defaults, ...options };
  return groupVisibleAlbums(getVisibleAlbums(dividerAlbums, view), view.sort)
    ?.map(({ heading, albums }) => [heading, albums.map(album => album.id)]);
}

test("groups only populated headings, folds accents, and puts other titles under #", () => {
  assert.deepEqual(dividedIds(), [
    ["A", ["apple", "afterglow"]],
    ["E", ["accent"]],
    ["Z", ["zebra"]],
    ["#", ["number", "symbol", "emoji", "non-latin", "blank"]]
  ]);
});

test("preserves alphabetical direction within each heading and reverses letter order", () => {
  const selection = { query: "north", formats: ["CD"] };
  assert.deepEqual(dividedIds({ ...selection, sort: "title-asc" }).slice(0, 2), [
    ["A", ["afterglow", "apple"]], ["Z", ["zebra"]]
  ]);
  assert.deepEqual(dividedIds({ ...selection, sort: "title-desc" }).slice(0, 2), [
    ["Z", ["zebra"]], ["A", ["apple", "afterglow"]]
  ]);
  for (const sort of ["title-asc", "title-desc"]) {
    assert.equal(dividedIds({ ...selection, sort }).at(-1)[0], "#");
  }
});

test("groups only the search and format matches, including no matches", () => {
  assert.deepEqual(dividedIds({ query: "North", formats: ["Vinyl (12-inch LP)"] }), [["#", ["symbol"]]]);
  assert.deepEqual(dividedIds({ query: "North", formats: ["Cassette"] }), []);
  assert.deepEqual(groupVisibleAlbums([], "title-asc"), []);
});

test("pauses dividers in both year sorts so the chronological order stays intact", () => {
  for (const sort of ["year-newest", "year-oldest"]) {
    const visible = getVisibleAlbums(dividerAlbums, { ...defaults, sort });
    assert.equal(groupVisibleAlbums(visible, sort), null);
    assert.equal(visible[0].id, sort === "year-newest" ? "blank" : "zebra");
  }
});

test("pinned albums bypass search and format filters and precede sorted results and dividers", () => {
  const pinned = { ...albums[5], pinned: true };
  const input = [...albums.slice(0, 5), pinned];
  const results = getVisibleAlbums(input, { query: "Echoes", formats: ["CD"], sort: "title-asc" });
  assert.deepEqual(results.map(album => album.id), ["h", "m", "z"]);
  assert.deepEqual(groupVisibleAlbums(results, "title-asc").map(group => group.heading), ["Pinned", "M", "Z"]);
  assert.deepEqual(getVisibleAlbums(input, { ...defaults, query: "no match", sort: "year-newest" }), [pinned]);
});
