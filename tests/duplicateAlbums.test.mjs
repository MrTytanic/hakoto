import assert from "node:assert/strict";
import test from "node:test";
import { findDuplicateAlbum } from "../src/duplicateAlbums.ts";

test("matches normalized title, artist and format while allowing separate copies", () => {
  const album = { id: "one", title: "  The   Album ", artist: "CAFÉ", format: "CD" };
  const candidate = { title: "Ｔｈｅ Album", artist: "cafe\u0301", format: "cd" };
  assert.equal(findDuplicateAlbum([album], candidate), album);
  assert.equal(findDuplicateAlbum([album], { ...candidate, id: "one" }), undefined);
  assert.equal(findDuplicateAlbum([album], { ...candidate, format: "Cassette" }), undefined);
  assert.equal(findDuplicateAlbum([album], { ...candidate, artist: "Another Artist" }), undefined);
  assert.equal(findDuplicateAlbum([album], { ...candidate, title: "" }), undefined);
  assert.equal(findDuplicateAlbum([], candidate), undefined);
  const copy = { ...album, id: "two" };
  assert.equal(findDuplicateAlbum([album, copy], { ...candidate, id: "one" }), copy);
});
