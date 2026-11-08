import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  onSettingsSaveError,
  readClientSettings,
  saveClientSettings,
  resetClientSettingsForTests,
} from './userSettings';

const settingsCookie = () =>
  document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith('gavel-settings='))
    ?.slice('gavel-settings='.length);

describe('userSettings service', () => {
  let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;

  let saveErrors: string[];
  let stopListening: () => void;

  beforeEach(() => {
    resetClientSettingsForTests();
    mockFetch = vi.fn<typeof fetch>();
    global.fetch = mockFetch as any;
    saveErrors = [];
    stopListening = onSettingsSaveError((message) => saveErrors.push(message));
  });

  afterEach(() => {
    stopListening();
  });

  describe('readClientSettings', () => {
    it('returns no settings before anything is saved', () => {
      expect(readClientSettings()).toEqual({});
    });
  });

  describe('saveClientSettings', () => {
    it('merges each patch into the browser cookie', () => {
      saveClientSettings({ sidebarWidth: 300 });
      saveClientSettings({ sidebarWidth: 320 });
      saveClientSettings({ sidebarOpen: false });

      expect(readClientSettings()).toEqual({ sidebarWidth: 320, sidebarOpen: false });
      expect(JSON.parse(decodeURIComponent(settingsCookie() ?? ''))).toEqual({
        sidebarWidth: 320,
        sidebarOpen: false,
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('reports settings that exceed the cookie size limit', () => {
      saveClientSettings({ sidebarOpen: true });

      saveClientSettings({ notes: 'x'.repeat(4000) });

      expect(saveErrors).toEqual([expect.stringMatching(/cookie limit/)]);
      expect(readClientSettings()).toEqual({ sidebarOpen: true });
    });
  });

  describe('when the browser drops the cookie', () => {
    let cookieDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
      // As Chromium does in a cross-site frame, or with cookies blocked.
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => '',
        set: () => {},
      });
    });

    afterEach(() => {
      delete (document as { cookie?: string }).cookie;
      expect(Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')).toEqual(
        cookieDescriptor,
      );
    });

    it('reports that the settings were not saved', () => {
      saveClientSettings({ sidebarOpen: false });

      expect(saveErrors).toEqual([expect.stringMatching(/did not keep/)]);
    });
  });
});
