import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readClientSettings,
  resetClientSettingsForTests,
  saveClientSettings,
} from '../services/userSettings';

import { useAppearanceSettings } from './useAppearanceSettings';

const setMatchMedia = (initialMatches: boolean) => {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'change' && typeof listener === 'function') {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'change' && typeof listener === 'function') {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as MediaQueryList;

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => mediaQueryList),
  });

  return {
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      const event = {
        matches: nextMatches,
        media: mediaQueryList.media,
      } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
};

describe('useAppearanceSettings', () => {
  beforeEach(() => {
    resetClientSettingsForTests();
  });

  describe('theme', () => {
    beforeEach(() => {
      document.documentElement.removeAttribute('data-color-vision');
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.removeAttribute('style');
      document.body.removeAttribute('style');
    });

    it('updates syntax highlighting theme when auto theme follows OS changes', async () => {
      saveClientSettings({
        appearance: {
          theme: 'auto',
          syntaxTheme: 'vsDark',
        },
      });
      const matchMedia = setMatchMedia(true);

      const { result } = renderHook(() => useAppearanceSettings());

      await waitFor(() => {
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(result.current.settings.syntaxTheme).toBe('vsDark');
      });

      act(() => {
        matchMedia.setMatches(false);
      });

      await waitFor(() => {
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
        expect(result.current.settings.syntaxTheme).toBe('github');
      });

      expect(readClientSettings().appearance).toMatchObject({
        theme: 'auto',
        syntaxTheme: 'github',
      });
    });

    it('applies the selected font to --mono-font-family', () => {
      setMatchMedia(false);

      const { result } = renderHook(() => useAppearanceSettings());
      const plex = '"IBM Plex Mono", monospace';

      act(() => {
        result.current.updateSettings({
          ...result.current.settings,
          fontFamily: plex,
        });
      });

      expect(document.documentElement.style.getPropertyValue('--mono-font-family')).toBe(plex);
    });

    it('restores the browser default font', () => {
      setMatchMedia(false);
      saveClientSettings({ appearance: { fontFamily: 'monospace' } });

      const { result } = renderHook(() => useAppearanceSettings());

      expect(result.current.settings.fontFamily).toBe('monospace');
    });
  });

  describe('legacy editor storage', () => {
    it('discards browser-stored editor commands', () => {
      setMatchMedia(false);
      saveClientSettings({
        appearance: {
          theme: 'dark',
          editor: { id: 'custom', command: 'untrusted', argsTemplate: '%file' },
        },
      });

      const { result } = renderHook(() => useAppearanceSettings());

      expect(result.current.settings).not.toHaveProperty('editor');
    });

    it('leaves auto-viewed patterns to the server', () => {
      setMatchMedia(false);
      saveClientSettings({ appearance: { theme: 'dark', autoViewedPatterns: ['*.snap'] } });

      const { result } = renderHook(() => useAppearanceSettings());

      expect(result.current.settings).not.toHaveProperty('autoViewedPatterns');
    });
  });

  describe('settings normalization', () => {
    beforeEach(() => {
      setMatchMedia(false);
    });

    it('falls back to the default font when fontFamily is unknown', () => {
      saveClientSettings({
        appearance: {
          theme: 'dark',
          fontFamily: 'Comic Sans MS, cursive',
        },
      });

      const { result } = renderHook(() => useAppearanceSettings());

      expect(result.current.settings.fontFamily).toBe('"JetBrains Mono", monospace');
    });

    it('turns on approval animations that saved settings predate', () => {
      saveClientSettings({
        appearance: {
          theme: 'dark',
          approvalAnimations: { confetti: false, streamers: true, sparkles: true },
        },
      });

      const { result } = renderHook(() => useAppearanceSettings());

      expect(result.current.settings.approvalAnimations).toEqual({
        confetti: false,
        streamers: true,
        sparkles: true,
        fireworks: true,
        stamp: true,
        lasers: true,
        disco: true,
        balloons: true,
      });
    });
  });

  describe('settings saved on the server before they moved to a cookie', () => {
    beforeEach(() => {
      setMatchMedia(false);
      resetClientSettingsForTests();
    });

    it('copies the server settings into this browser on first load', async () => {
      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('/api/user-settings')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              version: 1,
              client: { appearance: { theme: 'light', fontSize: 16 } },
            }),
          });
        }
        return Promise.resolve({ ok: false });
      });

      const { result } = renderHook(() => useAppearanceSettings());

      await waitFor(() => {
        expect(result.current.settings.theme).toBe('light');
        expect(result.current.settings.fontSize).toBe(16);
      });

      expect(readClientSettings().appearance).toMatchObject({
        theme: 'light',
        fontSize: 16,
      });
    });
  });
});
