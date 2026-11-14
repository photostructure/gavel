import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const PROCESSES = 4;
const PATHS = 200;

// Servers and CLI commands that start together each load the token in their own process.
describe('loadAccessToken across processes', () => {
  let directory: string;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'gavel-access-token-race-'));
    const tsc = join(
      dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
      'bin/tsc',
    );
    execFileSync(process.execPath, [
      tsc,
      '--ignoreConfig',
      '--noCheck',
      '--target',
      'es2022',
      '--module',
      'esnext',
      '--rootDir',
      resolve(here, '..'),
      '--outDir',
      join(directory, 'dist'),
      join(here, 'access-token.ts'),
      join(here, 'user-config.ts'),
    ]);
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    // Each process waits for the go file, so all of them reach the same fresh paths together.
    writeFileSync(
      join(directory, 'load.js'),
      `import { existsSync } from 'node:fs';
import { loadAccessToken } from './dist/server/access-token.js';
const [go, ...paths] = process.argv.slice(2);
while (!existsSync(go));
process.stdout.write(JSON.stringify(paths.map((path) => {
  try { return loadAccessToken(path); } catch (error) { return 'error: ' + error.message; }
})));
`,
    );
  }, 60_000);

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('gives every process the same complete token when they create it at once', async () => {
    const go = join(directory, 'go');
    const paths = Array.from({ length: PATHS }, (_, i) => join(directory, 'tokens', `${i}`));
    const runs = Array.from({ length: PROCESSES }, () =>
      promisify(execFile)(process.execPath, [join(directory, 'load.js'), go, ...paths]),
    );
    writeFileSync(go, '');
    const results = (await Promise.all(runs)).map(({ stdout }) => JSON.parse(stdout) as string[]);

    for (const [i] of paths.entries()) {
      const tokens = results.map((tokensOfProcess) => tokensOfProcess[i]);
      expect(tokens[0]).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(new Set(tokens).size).toBe(1);
    }
  }, 60_000);
});
