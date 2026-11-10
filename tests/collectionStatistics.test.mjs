import assert from "node:assert/strict";
import test from "node:test";
import { collectionStatistics, shelfOccupancy } from "../src/collectionStatistics.ts";

const album = (dateAdded, format = "CD", favorite = false) => ({ dateAdded, format, favorite });

test("counts albums, formats and favorites without assigning dates to legacy albums", () => {
  const stats = collectionStatistics([
    album(null), album("2024-02-29", "Vinyl", true), album("2024-02-30"),
    album("2024-04-01", "Vinyl"), album(undefined), album("invalid")
  ]);
  assert.equal(stats.total, 6);
  assert.equal(stats.favorites, 1);
  assert.equal(stats.undated, 4);
  assert.deepEqual(stats.formats, [{ format: "CD", count: 4 }, { format: "Vinyl", count: 2 }]);
  assert.deepEqual(stats.growth, [
    { month: "2024-02", added: 1, cumulative: 1 },
    { month: "2024-03", added: 0, cumulative: 1 },
    { month: "2024-04", added: 1, cumulative: 2 }
  ]);
  assert.deepEqual(collectionStatistics([]).growth, []);
  assert.deepEqual(collectionStatistics([album(null)]).growth, []);
});

test("bounds the monthly graph while retaining earlier dated totals and deriving updates", () => {
  const albums = [album("2020-01-01"), album("2025-01-01")];
  const stats = collectionStatistics(albums);
  assert.equal(stats.growth.length, 24);
  assert.equal(stats.earlier, 1);
  assert.deepEqual(stats.growth.at(-1), { month: "2025-01", added: 1, cumulative: 2 });
  assert.equal(collectionStatistics(albums.slice(1)).earlier, 0);
  assert.equal(collectionStatistics([...albums, album("2025-01-02")]).growth.at(-1).added, 2);
});

test("calculates shelf slot occupancy including empty, partial and full shelves", () => {
  assert.deepEqual(shelfOccupancy(2, 3, 0), { occupied: 0, total: 6, percentage: 0 });
  assert.deepEqual(shelfOccupancy(2, 3, 2), { occupied: 2, total: 6, percentage: 33 });
  assert.deepEqual(shelfOccupancy(1, 4, 4), { occupied: 4, total: 4, percentage: 100 });
  assert.equal(shelfOccupancy(0, 0, 0).percentage, 0);
});
