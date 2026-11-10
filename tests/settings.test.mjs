import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { alphabeticalDividersPreference, animationDurationPreference, animationDurations, animationsPreference, collectionPageSizePreference, collectionPageSizes, collectionViewPreference, textScalePreference, resolveTheme, systemThemeQuery, themePreference } from "../src/settings.ts";

const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const bootstrap = index.match(/<script>([\s\S]*?)<\/script>/);

function useStorage(t, storage) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  });
}

test("collection page size defaults to 25 and persists supported choices", t => {
  const entries = new Map();
  useStorage(t, { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) });
  assert.equal(collectionPageSizePreference.read(), "25");
  for (const size of collectionPageSizes) {
    collectionPageSizePreference.write(size);
    assert.equal(collectionPageSizePreference.read(), size);
  }
  entries.set("hakoto.collectionPageSize", "200");
  assert.equal(collectionPageSizePreference.read(), "25");
});

test("animation timing persists allowed steps, defaults to 300ms and initializes before rendering", t => {
  const entries = new Map();
  useStorage(t, { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) });
  assert.equal(animationDurationPreference.read(), "300");
  for (const duration of animationDurations) {
    animationDurationPreference.write(duration);
    assert.equal(animationDurationPreference.read(), duration);
    const properties = new Map();
    runInNewContext(bootstrap[1], {
      document: { documentElement: { dataset: {}, style: { setProperty: (key, value) => properties.set(key, value) } } },
      localStorage: { getItem: key => entries.get(key) ?? null }
    });
    assert.equal(properties.get("--animation-duration"), duration + "ms");
  }
  for (const invalid of ["0", "125", "550", "invalid"]) {
    entries.set("hakoto.animationDuration", invalid);
    assert.equal(animationDurationPreference.read(), "300");
  }
});

test("accessibility preferences persist supported values and reject invalid saved values", t => {
  const entries = new Map();
  useStorage(t, { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) });
  assert.equal(textScalePreference.read(), "100");
  assert.equal(animationsPreference.read(), "on");
  for (const scale of ["90", "100", "115", "130"]) {
    textScalePreference.write(scale);
    assert.equal(textScalePreference.read(), scale);
  }
  animationsPreference.write("off");
  assert.equal(animationsPreference.read(), "off");
  entries.set("hakoto.textScale", "200");
  entries.set("hakoto.animations", "invalid");
  assert.equal(textScalePreference.read(), "100");
  assert.equal(animationsPreference.read(), "on");
});

test("accessibility preferences apply before rendering and handle unavailable storage", () => {
  for (const scale of ["90", "100", "115", "130", "invalid"]) {
    for (const animations of ["on", "off"]) {
      const dataset = {};
      runInNewContext(bootstrap[1], {
        document: { documentElement: { dataset } },
        localStorage: { getItem: key => ({
          "hakoto.textScale": scale,
          "hakoto.animations": animations
        })[key] ?? null }
      });
      assert.equal(dataset.textScale, scale === "invalid" ? "100" : scale);
      assert.equal(dataset.animations, animations);
    }
  }
  assert.doesNotThrow(() => runInNewContext(bootstrap[1], {
    localStorage: { getItem() { throw Error("Unavailable"); } }
  }));
});

test("collection view defaults to grid and persists valid choices", t => {
  const entries = new Map();
  useStorage(t, { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) });
  assert.equal(collectionViewPreference.read(), "grid");
  for (const view of ["list", "grid"]) {
    collectionViewPreference.write(view);
    assert.equal(entries.get("hakoto.collectionView"), view);
    assert.equal(collectionViewPreference.read(), view);
  }
  entries.set("hakoto.collectionView", "invalid");
  assert.equal(collectionViewPreference.read(), "grid");
});

test("defaults to dark and reads each saved theme preference", t => {
  const entries = new Map();
  useStorage(t, { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) });

  assert.equal(themePreference.read(), "dark");
  for (const theme of ["light", "system", "dark"]) {
    themePreference.write(theme);
    assert.equal(entries.get("hakoto.theme"), theme);
    assert.equal(themePreference.read(), theme);
  }
  entries.set("hakoto.theme", "invalid");
  assert.equal(themePreference.read(), "dark");
});

test("unavailable storage falls back to dark without preventing changes for the session", t => {
  const unavailable = () => { throw new Error("Storage is blocked"); };
  useStorage(t, { getItem: unavailable, setItem: unavailable });

  assert.equal(themePreference.read(), "dark");
  assert.doesNotThrow(() => themePreference.write("light"));
});

test("only System follows the device appearance", () => {
  for (const systemIsDark of [true, false]) {
    assert.equal(resolveTheme("dark", systemIsDark), "dark");
    assert.equal(resolveTheme("light", systemIsDark), "light");
    assert.equal(resolveTheme("system", systemIsDark), systemIsDark ? "dark" : "light");
  }
});

test("alphabetical dividers default off and save either toggle state independently of theme", t => {
  const entries = new Map([["hakoto.theme", "light"]]);
  useStorage(t, { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) });

  assert.equal(alphabeticalDividersPreference.read(), "off");
  for (const value of ["on", "off"]) {
    alphabeticalDividersPreference.write(value);
    assert.equal(entries.get("hakoto.alphabeticalDividers"), value);
    assert.equal(alphabeticalDividersPreference.read(), value);
  }
  assert.equal(themePreference.read(), "light");
  entries.set("hakoto.alphabeticalDividers", "invalid");
  assert.equal(alphabeticalDividersPreference.read(), "off");
});

test("startup sets the saved palette before styles and uses the same System resolution", () => {
  assert.ok(bootstrap);
  assert.ok(bootstrap.index < index.indexOf('rel="stylesheet"'));
  assert.match(index, /<html[^>]+data-theme="dark"/);

  for (const stored of [null, "invalid", "dark", "light", "system"]) {
    for (const systemIsDark of [true, false]) {
      const dataset = { theme: "dark" };
      runInNewContext(bootstrap[1], {
        document: { documentElement: { dataset } },
        localStorage: { getItem(key) { assert.equal(key, "hakoto.theme"); return stored; } },
        matchMedia(query) { assert.equal(query, systemThemeQuery); return { matches: systemIsDark }; }
      });
      const validTheme = stored === "light" || stored === "system" ? stored : "dark";
      assert.equal(dataset.theme, resolveTheme(validTheme, systemIsDark));
    }
  }
});
