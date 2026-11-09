import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { resolveTheme, systemThemeQuery, themePreference } from "../src/settings.ts";

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
