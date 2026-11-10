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
export const collectionPageSizes = ["10", "25", "50", "100"] as const;
export const collectionPageSizePreference = createPreference("hakoto.collectionPageSize", collectionPageSizes, "25");
export type CollectionViewPreference = ReturnType<typeof collectionViewPreference.read>;
export const textScalePreference = createPreference("hakoto.textScale", ["90", "100", "115", "130"], "100");
export const animationsPreference = createPreference("hakoto.animations", ["on", "off"], "on");
export const animationDurations = ["100", "150", "200", "250", "300", "350", "400", "450", "500"] as const;
export const animationDurationPreference = createPreference("hakoto.animationDuration", animationDurations, "300");
export type AnimationDurationPreference = ReturnType<typeof animationDurationPreference.read>;
export type TextScalePreference = ReturnType<typeof textScalePreference.read>;
export type ThemePreference = ReturnType<typeof themePreference.read>;
export const systemThemeQuery = "(prefers-color-scheme: dark)";

export function resolveTheme(theme: ThemePreference, systemIsDark: boolean): "dark" | "light" {
  return theme === "system" ? (systemIsDark ? "dark" : "light") : theme;
}
