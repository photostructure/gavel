import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAccessToken } from './access-token.js';

describe('loadAccessToken', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gavel-access-token-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a 22-character token that only the owner can read, in a new directory', () => {
    const path = join(dir, 'nested', 'access-token');
    const token = loadAccessToken(path);

    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(readFileSync(path, 'utf8').trim()).toBe(token);
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, 'nested')).mode & 0o777).toBe(0o700);
    }
  });

  it('returns the same token on every later load', () => {
    const path = join(dir, 'access-token');
    expect(loadAccessToken(path)).toBe(loadAccessToken(path));
  });

  it('reads a token whose file ends with a newline', () => {
    const path = join(dir, 'access-token');
    writeFileSync(path, 'abcdefghijklmnopqrstuv\n');
    expect(loadAccessToken(path)).toBe('abcdefghijklmnopqrstuv');
  });

  it('refuses a file that does not hold a token', () => {
    const path = join(dir, 'access-token');
    writeFileSync(path, 'short');
    expect(() => loadAccessToken(path)).toThrow(/does not hold a gavel access token/);
  });
});
