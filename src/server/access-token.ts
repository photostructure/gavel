import { randomBytes } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { getUserConfigDir } from './user-config.js';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function getAccessTokenPath(): string {
  return join(getUserConfigDir(), 'access-token');
}

/**
 * Every gavel server and CLI command of this user shares one token, so a browser that saw it
 * once keeps working after a restart. The first load creates it; deleting the file rotates it.
 */
export function loadAccessToken(path: string = getAccessTokenPath()): string {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // Another process may be creating the token too. Each writes its whole token to a file of
    // its own and links that in place, so no process reads a partly written token, and the
    // link fails rather than replace a token another process published first.
    const draft = `${path}.${process.pid}.${randomBytes(4).toString('hex')}`;
    writeFileSync(draft, `${randomBytes(16).toString('base64url')}\n`, { flag: 'wx', mode: 0o600 });
    try {
      linkSync(draft, path);
    } catch (linkError) {
      if ((linkError as NodeJS.ErrnoException).code !== 'EEXIST') throw linkError;
    } finally {
      rmSync(draft);
    }
    text = readFileSync(path, 'utf8');
  }
  const token = text.trim();
  if (!TOKEN_PATTERN.test(token))
    throw new Error(`${path} does not hold a gavel access token; delete it to create a new one`);
  return token;
}
