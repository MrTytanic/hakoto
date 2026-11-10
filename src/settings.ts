function createPreference<const Value extends string>(key: string, values: readonly Value[], fallback: NoInfer<Value>) {
  return {
    read(): Value {
      try {
        const stored = localStorage.getItem(key);
        return values.find(value => value === stored) ?? fallback;
      } catch {
        return fallback;
      }
    },
    write(value: Value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // The preference can still be applied for this session.
      }
    }
  };
}

export const themePreference = createPreference("hakoto.theme", ["dark", "light", "system"], "dark");
export const alphabeticalDividersPreference = createPreference("hakoto.alphabeticalDividers", ["off", "on"], "off");
export const collectionViewPreference = createPreference("hakoto.collectionView", ["grid", "list"], "grid");
export type CollectionViewPreference = ReturnType<typeof collectionViewPreference.read>;
export type ThemePreference = ReturnType<typeof themePreference.read>;
export const systemThemeQuery = "(prefers-color-scheme: dark)";

export function resolveTheme(theme: ThemePreference, systemIsDark: boolean): "dark" | "light" {
  return theme === "system" ? (systemIsDark ? "dark" : "light") : theme;
}
