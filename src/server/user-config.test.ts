import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  getUserConfigPath,
  MAX_USER_CONFIG_BYTES,
  parseAutoViewedPatternsBody,
  readUserConfig,
  writeAutoViewedPatterns,
} from './user-config.js';

describe('user-config', () => {
  let configDir: string;
  let configPath: string;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(join(tmpdir(), 'gavel-user-config-'));
    configPath = join(configDir, 'config.json');
  });

  afterEach(async () => {
    await fs.rm(configDir, { recursive: true, force: true });
  });

  describe('getUserConfigPath', () => {
    const originalConfigDir = process.env.GAVEL_CONFIG_DIR;

    afterEach(() => {
      if (originalConfigDir === undefined) {
        delete process.env.GAVEL_CONFIG_DIR;
      } else {
        process.env.GAVEL_CONFIG_DIR = originalConfigDir;
      }
    });

    it('defaults to ~/.gavel/config.json', () => {
      delete process.env.GAVEL_CONFIG_DIR;
      expect(getUserConfigPath()).toMatch(/\.gavel[/\\]config\.json$/);
    });

    it('respects GAVEL_CONFIG_DIR', () => {
      process.env.GAVEL_CONFIG_DIR = configDir;
      expect(getUserConfigPath()).toBe(join(configDir, 'config.json'));
    });
  });

  describe('readUserConfig', () => {
    it('returns defaults when the file does not exist', async () => {
      const config = await readUserConfig(configPath);
      expect(config).toEqual({ version: 1, client: {}, autoViewedPatterns: [] });
    });

    it('rejects a file that is not valid JSON, naming the file', async () => {
      await fs.writeFile(configPath, 'not json', 'utf-8');
      await expect(readUserConfig(configPath)).rejects.toThrow(configPath);
    });

    it('returns defaults when client is not an object', async () => {
      await fs.writeFile(configPath, JSON.stringify({ version: 1, client: [1, 2] }), 'utf-8');
      const config = await readUserConfig(configPath);
      expect(config).toEqual({ version: 1, client: {}, autoViewedPatterns: [] });
    });

    it('reads stored client settings', async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({ version: 1, client: { diffViewMode: 'split' } }),
        'utf-8',
      );
      const config = await readUserConfig(configPath);
      expect(config.client).toEqual({ diffViewMode: 'split' });
    });
  });

  describe('auto-viewed patterns', () => {
    it('reads patterns saved inside the old appearance settings', async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({ version: 1, client: { appearance: { autoViewedPatterns: ['*.snap'] } } }),
        'utf-8',
      );
      const config = await readUserConfig(configPath);
      expect(config.autoViewedPatterns).toEqual(['*.snap']);
      // Browsers copy `client` into a size-limited cookie; the patterns stay out of it.
      expect(config.client).toEqual({ appearance: {} });
    });

    it('prefers patterns saved under their own key', async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          version: 1,
          client: { appearance: { autoViewedPatterns: ['*.snap'] } },
          autoViewedPatterns: [],
        }),
        'utf-8',
      );
      const config = await readUserConfig(configPath);
      expect(config.autoViewedPatterns).toEqual([]);
    });

    it('saves patterns without touching the other settings', async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({ version: 1, client: { diffViewMode: 'split' } }),
        'utf-8',
      );

      await writeAutoViewedPatterns(['vendor/**'], configPath);

      expect(JSON.parse(await fs.readFile(configPath, 'utf-8'))).toEqual({
        version: 1,
        client: { diffViewMode: 'split' },
        autoViewedPatterns: ['vendor/**'],
      });
      expect(await fs.readdir(configDir)).toEqual(['config.json']);
    });

    it('leaves a file that is not valid JSON untouched', async () => {
      const broken = '{"version":1,"autoViewedPatterns":["*.snap",]}';
      await fs.writeFile(configPath, broken, 'utf-8');

      await expect(writeAutoViewedPatterns(['*.lock'], configPath)).rejects.toThrow(configPath);
      expect(await fs.readFile(configPath, 'utf-8')).toBe(broken);
    });

    it('creates the config directory on first write', async () => {
      const nestedPath = join(configDir, 'nested', 'config.json');
      await writeAutoViewedPatterns(['*.lock'], nestedPath);
      expect((await readUserConfig(nestedPath)).autoViewedPatterns).toEqual(['*.lock']);
    });

    it('rejects patterns over the size limit', async () => {
      await expect(
        writeAutoViewedPatterns(['x'.repeat(MAX_USER_CONFIG_BYTES)], configPath),
      ).rejects.toThrow('maximum allowed size');
    });

    it('accepts only a list of strings in a request body', () => {
      expect(parseAutoViewedPatternsBody({ patterns: ['*.snap'] })).toEqual(['*.snap']);
      expect(parseAutoViewedPatternsBody({ patterns: '*.snap' })).toBeNull();
      expect(parseAutoViewedPatternsBody({ patterns: [1] })).toBeNull();
      expect(parseAutoViewedPatternsBody(undefined)).toBeNull();
    });
  });
});
