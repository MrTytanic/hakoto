import assert from "node:assert/strict";
import test from "node:test";
import { collectionStatistics, shelfOccupancy } from "../src/collectionStatistics.ts";

const album = (id, overrides = {}) => ({
  id, title: "Same album", artist: "Artist", format: "CD", ownership: "owned", favorite: false, ...overrides
});

test("ranks case-insensitive artist names and counts distinct owned physical and digital copies", () => {
  const favorite = album("one", { artist: "Björk", format: "Vinyl", favorite: true });
  const stats = collectionStatistics([
    favorite, { ...favorite }, album("two", { artist: " BJO\u0308RK ", format: "Digital (FLAC)" }),
    album("three", { artist: "Zebra" }), album("four", { artist: "Alpha" }),
    album("wish", { artist: "Björk", ownership: "wishlist", favorite: true })
  ]);
  assert.equal(stats.total, 4);
  assert.equal(stats.favorites, 1);
  assert.equal(stats.undated, 4);
  assert.deepEqual(stats.formats, [
    { format: "CD", count: 2 }, { format: "Digital (FLAC)", count: 1 }, { format: "Vinyl", count: 1 }
  ]);
  assert.deepEqual(stats.artists, [
    { name: "Björk", count: 2 }, { name: "Alpha", count: 1 }, { name: "Zebra", count: 1 }
  ]);
  assert.deepEqual(collectionStatistics([album("legacy", { artist: " " })]).artists, []);
});

test("uses only known acquisition dates and counts an acquired wishlist copy once", () => {
  const albums = [
    album("legacy", { dateAdded: "2024-01-01" }),
    album("bad", { dateAcquired: "2024-02-30", dateAdded: "2024-03-01" }),
    album("bad-year", { dateAcquired: "0000-01-01" }),
    album("dated", { dateAcquired: "2024-02-29", dateAdded: "2025-01-01" })
  ];
  const wishlist = album("wish", { ownership: "wishlist", dateAdded: "2026-10-03" });
  assert.deepEqual(collectionStatistics([...albums, wishlist]).growth, [
    { month: "2024-02", added: 1, cumulative: 1 }
  ]);
  const acquired = { ...wishlist, ownership: "owned", dateAcquired: "2024-04-01" };
  const updated = collectionStatistics([...albums, wishlist, acquired, { ...acquired }]);
  assert.equal(updated.total, 5);
  assert.equal(updated.undated, 3);
  assert.deepEqual(updated.growth, [
    { month: "2024-02", added: 1, cumulative: 1 },
    { month: "2024-03", added: 0, cumulative: 1 },
    { month: "2024-04", added: 1, cumulative: 2 }
  ]);
  assert.deepEqual(collectionStatistics([]).growth, []);
  assert.deepEqual(collectionStatistics([albums[0]]).growth, []);
});

test("bounds the monthly graph while retaining earlier dated totals and deriving updates", () => {
  const albums = [album("older", { dateAcquired: "2020-01-01" }), album("newer", { dateAcquired: "2025-01-01" })];
  const stats = collectionStatistics(albums);
  assert.equal(stats.growth.length, 24);
  assert.equal(stats.earlier, 1);
  assert.deepEqual(stats.growth.at(-1), { month: "2025-01", added: 1, cumulative: 2 });
  assert.equal(collectionStatistics(albums.slice(1)).earlier, 0);
  assert.equal(collectionStatistics([...albums, album("latest", { dateAcquired: "2025-01-02" })]).growth.at(-1).added, 2);
});

test("calculates shelf slot occupancy including empty, partial and full shelves", () => {
  assert.deepEqual(shelfOccupancy(2, 3, 0), { occupied: 0, total: 6, percentage: 0 });
  assert.deepEqual(shelfOccupancy(2, 3, 2), { occupied: 2, total: 6, percentage: 33 });
  assert.deepEqual(shelfOccupancy(1, 4, 4), { occupied: 4, total: 4, percentage: 100 });
  assert.equal(shelfOccupancy(0, 0, 0).percentage, 0);
});
