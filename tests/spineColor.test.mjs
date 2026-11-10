import assert from "node:assert/strict";
import { test } from "node:test";
import { contrastingText, createSpinePaletteCache, relativeLuminance, sampleSpineColor } from "../src/spineColor.ts";

function pixels(...regions) {
  return new Uint8ClampedArray(regions.flatMap(([count, rgba]) => Array.from({ length: count }, () => rgba).flat()));
}

test("selects a meaningful artwork accent over frequent black and white pixels", () => {
  const artwork = pixels([48, [255, 255, 255, 255]], [44, [0, 0, 0, 255]], [8, [180, 36, 44, 255]]);
  assert.deepEqual(sampleSpineColor(artwork), { color: [180, 36, 44], text: "#fff" });
});

test("selects a coherent hue deterministically instead of averaging contrasting colors", () => {
  const artwork = pixels([12, [40, 160, 180, 255]], [5, [205, 60, 40, 255]]);
  assert.deepEqual(sampleSpineColor(artwork), { color: [40, 160, 180], text: "#000" });
  assert.deepEqual(sampleSpineColor(artwork), sampleSpineColor(artwork));
});

test("ignores transparent pixels and uses softened neutrals for monochrome artwork", () => {
  assert.equal(sampleSpineColor(pixels([5, [255, 0, 0, 0]])), null);
  assert.deepEqual(sampleSpineColor(pixels([80, [255, 0, 0, 20]], [2, [0, 0, 0, 255]])), {
    color: [36, 36, 36], text: "#fff"
  });
  assert.deepEqual(sampleSpineColor(pixels([5, [255, 255, 255, 255]])), { color: [224, 224, 224], text: "#000" });
});

test("chooses a foreground with at least 4.5:1 contrast, including midtones", () => {
  assert.equal(contrastingText([0, 0, 0]), "#fff");
  assert.equal(contrastingText([255, 255, 255]), "#000");
  for (const color of [[117, 117, 117], [118, 118, 118], [220, 40, 45], [90, 105, 180], [115, 165, 52]]) {
    const luminance = relativeLuminance(color);
    const ratio = contrastingText(color) === "#000" ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05);
    assert.ok(ratio >= 4.5, `Contrast ${ratio} for ${color}`);
  }
});

test("deduplicates pending and completed samples and uses a new key for replacement artwork", async () => {
  const requests = [];
  const palette = { color: [120, 40, 90], text: "#fff" };
  const replacement = { color: [25, 180, 140], text: "#000" };
  const cache = createSpinePaletteCache(async filename => {
    requests.push(filename);
    if (filename === "missing.webp") throw Error("Artwork unavailable");
    return filename === "original.webp" ? palette : replacement;
  });
  const first = cache.request("original.webp");
  assert.equal(cache.request("original.webp"), first);
  assert.equal(await first, palette);
  assert.equal(cache.get("original.webp"), palette);
  assert.equal(await cache.request("original.webp"), palette);
  assert.equal(await cache.request("replacement.webp"), replacement);
  assert.equal(await cache.request("missing.webp"), null);
  assert.equal(await cache.request("missing.webp"), null);
  assert.deepEqual(requests, ["original.webp", "replacement.webp", "missing.webp"]);
});
