const RESTORED_PREFERENCES = "hakoto.restoredPreferences";

function readRestoredPreferences(): { restoreId: string; values: Record<string, string> } | null {
  try {
    return JSON.parse(localStorage.getItem(RESTORED_PREFERENCES) ?? "null");
  } catch {
    return null;
  }
}

function createPreference<const Value extends string>(key: string, values: readonly Value[], fallback: NoInfer<Value>) {
  return {
    key,
    read(): Value {
      try {
        const stored = readRestoredPreferences()?.values?.[key] ?? localStorage.getItem(key);
        return values.find(value => value === stored) ?? fallback;
      } catch {
        return fallback;
      }
    },
    write(value: Value) {
      try {
        const restored = readRestoredPreferences();
        if (restored?.values) {
          restored.values[key] = value;
          localStorage.setItem(RESTORED_PREFERENCES, JSON.stringify(restored));
        } else {
          localStorage.setItem(key, value);
        }
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

const backupPreferences = {
  theme: themePreference,
  alphabeticalDividers: alphabeticalDividersPreference,
  collectionView: collectionViewPreference,
  collectionPageSize: collectionPageSizePreference,
  textScale: textScalePreference,
  animations: animationsPreference,
  animationDuration: animationDurationPreference
};

export type BackupSettings = { [Key in keyof typeof backupPreferences]: ReturnType<(typeof backupPreferences)[Key]["read"]> };

export function readBackupSettings(): BackupSettings {
  return Object.fromEntries(Object.entries(backupPreferences).map(([name, preference]) => [name, preference.read()])) as BackupSettings;
}

export function applyBackupSettings(restoreId: string, settings: BackupSettings) {
  if (readRestoredPreferences()?.restoreId === restoreId) return;
  const names = Object.keys(backupPreferences) as (keyof BackupSettings)[];
  const values = Object.fromEntries(names.map(name => [backupPreferences[name].key, settings[name]]));
  // One write keeps the previous preferences intact if browser storage rejects the update.
  localStorage.setItem(RESTORED_PREFERENCES, JSON.stringify({ restoreId, values }));
}
export type AnimationDurationPreference = ReturnType<typeof animationDurationPreference.read>;
export type TextScalePreference = ReturnType<typeof textScalePreference.read>;
export type ThemePreference = ReturnType<typeof themePreference.read>;
export const systemThemeQuery = "(prefers-color-scheme: dark)";

export function resolveTheme(theme: ThemePreference, systemIsDark: boolean): "dark" | "light" {
  return theme === "system" ? (systemIsDark ? "dark" : "light") : theme;
}
