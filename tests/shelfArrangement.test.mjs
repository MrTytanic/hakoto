import assert from "node:assert/strict";
import { test } from "node:test";
import { placementIndex, saveShelfDrop, undoShelfChanges } from "../src/shelfArrangement.ts";

const shelf = { rows: 2, columns: 3 };
const first = { row: 0, column: 0 };
const second = { row: 0, column: 1 };
const empty = { row: 1, column: 2 };
const saved = [
  { shelfId: 1, ...first, albumId: "a" },
  { shelfId: 1, ...second, albumId: "b" }
];

test("undo changes restore moved, swapped and removed slots without touching unchanged slots", () => {
  const moved = [{ ...saved[0], ...empty }, saved[1]];
  assert.deepEqual(undoShelfChanges(saved, moved), [
    { ...first, kind: "set", albumId: "a" }, { ...empty, kind: "clear" }
  ]);
  const swapped = [{ ...saved[0], albumId: "b" }, { ...saved[1], albumId: "a" }];
  assert.deepEqual(undoShelfChanges(saved, swapped), [
    { ...first, kind: "set", albumId: "a" }, { ...second, kind: "set", albumId: "b" }
  ]);
  assert.deepEqual(undoShelfChanges(saved, [saved[1]]), [{ ...first, kind: "set", albumId: "a" }]);
});

test("places a collection album into an empty slot without clearing another slot", async () => {
  const committed = [...saved, { shelfId: 1, ...empty, albumId: "c" }];
  const result = await saveShelfDrop(shelf, placementIndex(saved), { albumId: "c" }, empty, async changes => {
    assert.deepEqual(changes, [{ ...empty, kind: "set", albumId: "c" }]);
    return committed;
  });
  assert.deepEqual(result, { kind: "place", target: empty, placements: committed });
});

test("moves and swaps using one atomic batch per drop", async () => {
  for (const [target, kind, sourceChange] of [
    [empty, "move", { ...first, kind: "clear" }],
    [second, "swap", { ...first, kind: "set", albumId: "b" }]
  ]) {
    let writes = 0;
    const committed = [{ shelfId: 1, ...target, albumId: "a" }];
    const result = await saveShelfDrop(shelf, placementIndex(saved), { albumId: "a", slot: first }, target, async changes => {
      writes++;
      assert.deepEqual(changes, [{ ...target, kind: "set", albumId: "a" }, sourceChange]);
      return committed;
    });
    assert.equal(writes, 1);
    assert.deepEqual(result, { kind, target, placements: committed });
  }
});

test("canceled and invalid drops never write placements", async () => {
  const collectionAlbum = { albumId: "c" };
  const placedAlbum = { albumId: "a", slot: first };
  for (const [source, target, expected] of [
    [placedAlbum, null, /shelf slot/],
    [placedAlbum, { row: 3, column: 0 }, /shelf slot/],
    [collectionAlbum, second, /empty slot/],
    [placedAlbum, first, /different slot/],
    [{ albumId: "b", slot: first }, empty, /original slot/]
  ]) {
    const result = await saveShelfDrop(shelf, placementIndex(saved), source, target, async () => assert.fail("Unexpected write"));
    assert.match(result.error, expected);
  }
});

test("keeps the original arrangement during a pending save and after a rejected swap", async () => {
  const slots = placementIndex(saved);
  const before = [...slots];
  let rejectSave;
  const pending = saveShelfDrop(shelf, slots, { albumId: "a", slot: first }, second, () => new Promise((_, reject) => {
    rejectSave = reject;
  }));
  assert.deepEqual([...slots], before);
  rejectSave(new Error("SQLite write failed"));
  await assert.rejects(pending, /SQLite write failed/);
  assert.deepEqual([...slots], before);
});
