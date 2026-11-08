import { useState, useEffect, useCallback, useMemo } from 'react';

import {
  DEFAULT_SETTINGS,
  FONT_FAMILIES,
  type AppearanceSettings,
} from '../components/SettingsModal';
import {
  APPEARANCE_SETTINGS_KEY,
  readClientSettings,
  saveClientSettings,
} from '../services/userSettings';
import {
  applyResolvedTheme,
  resolveThemePreference,
  type ColorVisionMode,
  type ResolvedTheme,
} from '../utils/appearanceTheme';
import { getFallbackSyntaxTheme, isSyntaxThemeForResolvedTheme } from '../utils/themeLoader';

const normalizeStoredSettings = (raw: unknown): AppearanceSettings | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const parsed = raw as Partial<AppearanceSettings>;

  // Match on the first family, so a saved font survives changes to its fallbacks.
  const firstFamily = (stack: string) => stack.split(',')[0]?.trim();
  const savedFamily =
    typeof parsed.fontFamily === 'string' ? firstFamily(parsed.fontFamily) : undefined;
  const fontFamily =
    FONT_FAMILIES.find((font) => firstFamily(font.value) === savedFamily)?.value ??
    DEFAULT_SETTINGS.fontFamily;

  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    fontFamily,
    // Animations added since the settings were saved start out on.
    approvalAnimations: { ...DEFAULT_SETTINGS.approvalAnimations, ...parsed.approvalAnimations },
  };
};

interface UseAppearanceSettingsReturn {
  settings: AppearanceSettings;
  updateSettings: (newSettings: AppearanceSettings) => void;
}

export function useAppearanceSettings(): UseAppearanceSettingsReturn {
  const [settings, setSettings] = useState<AppearanceSettings>(
    () =>
      normalizeStoredSettings(readClientSettings()[APPEARANCE_SETTINGS_KEY]) ?? DEFAULT_SETTINGS,
  );

  const applyTheme = useCallback(
    (theme: 'light' | 'dark', colorVision: ColorVisionMode = 'normal') => {
      applyResolvedTheme(theme, colorVision);
    },
    [],
  );

  const saveSettings = useCallback((newSettings: AppearanceSettings) => {
    saveClientSettings({ [APPEARANCE_SETTINGS_KEY]: newSettings });
  }, []);

  const getSettingsForResolvedTheme = useCallback(
    (currentSettings: AppearanceSettings, resolvedTheme: ResolvedTheme) => {
      if (isSyntaxThemeForResolvedTheme(currentSettings.syntaxTheme, resolvedTheme)) {
        return currentSettings;
      }

      const fallbackSyntaxTheme = getFallbackSyntaxTheme(resolvedTheme);
      if (!fallbackSyntaxTheme) {
        return currentSettings;
      }

      return {
        ...currentSettings,
        syntaxTheme: fallbackSyntaxTheme.id,
      };
    },
    [],
  );

  // Apply settings to document
  useEffect(() => {
    const root = document.documentElement;

    // Apply font size
    root.style.setProperty('--app-font-size', `${settings.fontSize}px`);

    // Apply font family
    root.style.setProperty('--mono-font-family', settings.fontFamily);

    // Apply theme
    const colorVision = settings.colorVision ?? 'normal';
    const applyResolvedAppearance = (resolvedTheme: ResolvedTheme) => {
      applyTheme(resolvedTheme, colorVision);

      const nextSettings = getSettingsForResolvedTheme(settings, resolvedTheme);
      if (nextSettings !== settings) {
        setSettings(nextSettings);
        saveSettings(nextSettings);
      }
    };

    if (settings.theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyResolvedAppearance(
        resolveThemePreference('auto', mediaQuery.matches ? 'dark' : 'light'),
      );

      const handleChange = (e: MediaQueryListEvent) => {
        applyResolvedAppearance(resolveThemePreference('auto', e.matches ? 'dark' : 'light'));
      };

      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      applyResolvedAppearance(settings.theme);
      return undefined;
    }
  }, [settings, applyTheme, getSettingsForResolvedTheme, saveSettings]);

  const updateSettings = useCallback(
    (newSettings: AppearanceSettings) => {
      setSettings(newSettings);
      saveSettings(newSettings);
    },
    [saveSettings],
  );

  return useMemo(() => ({ settings, updateSettings }), [settings, updateSettings]);
}
