import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bootstrapAppearanceTheme,
  getResolvedTheme,
  resolveThemePreference,
} from './appearanceTheme';
import { resetClientSettingsForTests, saveClientSettings } from '../services/userSettings';

const setMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
};

describe('appearanceTheme', () => {
  beforeEach(() => {
    resetClientSettingsForTests();
    document.documentElement.removeAttribute('data-color-vision');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
    setMatchMedia(true);
  });

  it('resolves an explicit theme preference', () => {
    expect(resolveThemePreference('light', 'dark')).toBe('light');
    expect(resolveThemePreference('dark', 'light')).toBe('dark');
  });

  it('bootstraps the saved light theme before app mount', () => {
    saveClientSettings({
      appearance: {
        theme: 'light',
      },
    });

    expect(bootstrapAppearanceTheme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--color-github-bg-primary')).toBe(
      '#ffffff',
    );
  });

  it('bootstraps the saved color vision mode before app mount', () => {
    saveClientSettings({
      appearance: {
        colorVision: 'deuteranopia',
        theme: 'dark',
      },
    });

    expect(bootstrapAppearanceTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-color-vision')).toBe('deuteranopia');
    expect(document.documentElement.style.getPropertyValue('--color-diff-addition-bg')).toBe(
      '#0c2d6b',
    );
  });

  // Violet in normal vision, not the danger red of errors. Deuteranopia keeps it orange, since
  // that mode spends blue on Approve and violet on Approve after comments.
  it.each([
    ['normal', 'dark', '#8957e5'],
    ['normal', 'light', '#8250df'],
    ['deuteranopia', 'dark', '#d29922'],
    ['deuteranopia', 'light', '#bf8700'],
  ] as const)('colors Reject in %s vision on %s', (colorVision, theme, color) => {
    saveClientSettings({ appearance: { colorVision, theme } });

    bootstrapAppearanceTheme();
    expect(document.documentElement.style.getPropertyValue('--color-verdict-reject')).toBe(color);
  });

  // Yellow and this mode's orange Reject measure 1.60:1 on dark and 1.57:1 on light, too close
  // for two verdicts that mean opposite things.
  it.each([
    ['dark', '#a371f7'],
    ['light', '#8250df'],
  ] as const)('gives approve-after-comments its own color in %s deuteranopia', (theme, color) => {
    saveClientSettings({ appearance: { colorVision: 'deuteranopia', theme } });

    bootstrapAppearanceTheme();
    expect(document.documentElement.style.getPropertyValue('--color-verdict-after-comments')).toBe(
      color,
    );
  });

  it('resolves auto theme from system preference when no attribute is present', () => {
    saveClientSettings({
      appearance: {
        theme: 'auto',
      },
    });
    setMatchMedia(false);

    expect(getResolvedTheme()).toBe('light');
    expect(bootstrapAppearanceTheme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
