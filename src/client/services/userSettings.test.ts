import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  migrateServerSettings,
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

const serverResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

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

    it('still applies settings copied from the server for this visit', async () => {
      mockFetch.mockResolvedValue(serverResponse({ version: 1, client: { sidebarOpen: false } }));

      await expect(migrateServerSettings()).resolves.toEqual({ sidebarOpen: false });
      expect(saveErrors).toEqual([expect.stringMatching(/did not keep/)]);
    });
  });

  describe('migrateServerSettings', () => {
    it('copies settings saved on the server into a browser that has none', async () => {
      mockFetch.mockResolvedValue(
        serverResponse({ version: 1, client: { diffViewMode: 'unified', sidebarWidth: 280 } }),
      );

      await expect(migrateServerSettings()).resolves.toEqual({
        diffViewMode: 'unified',
        sidebarWidth: 280,
      });
      expect(mockFetch).toHaveBeenCalledWith('/api/user-settings');
      expect(readClientSettings()).toEqual({ diffViewMode: 'unified', sidebarWidth: 280 });
    });

    it('shares one request between concurrent callers', async () => {
      mockFetch.mockResolvedValue(serverResponse({ version: 1, client: { sidebarOpen: true } }));

      await Promise.all([migrateServerSettings(), migrateServerSettings()]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('keeps changes made in this browser while the server settings load', async () => {
      mockFetch.mockResolvedValue(
        serverResponse({ version: 1, client: { diffViewMode: 'unified', sidebarWidth: 280 } }),
      );

      const migration = migrateServerSettings();
      saveClientSettings({ diffViewMode: 'split' });

      await expect(migration).resolves.toEqual({ diffViewMode: 'split', sidebarWidth: 280 });
      expect(readClientSettings()).toEqual({ diffViewMode: 'split', sidebarWidth: 280 });
    });

    it('skips the server once this browser has its own settings', async () => {
      saveClientSettings({ sidebarOpen: false });
      resetClientSettingsForTests({ keepCookie: true });

      await expect(migrateServerSettings()).resolves.toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when the server has no settings', async () => {
      mockFetch.mockResolvedValue(serverResponse({ version: 1, client: {} }));

      await expect(migrateServerSettings()).resolves.toBeNull();
      expect(readClientSettings()).toEqual({});
    });

    it('returns null when the server responds with an error', async () => {
      mockFetch.mockResolvedValue(new Response('nope', { status: 404 }));
      await expect(migrateServerSettings()).resolves.toBeNull();
    });

    it('returns null when there is no server (static demo site)', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));
      await expect(migrateServerSettings()).resolves.toBeNull();
    });
  });
});
