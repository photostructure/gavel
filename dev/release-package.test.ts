import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'release-package.mjs',
);
const version = '6.0.0';
const files = [
  'package.json',
  'README.md',
  'LICENSE',
  'docs/agent-conversations.md',
  'dist/cli/index.js',
  'dist/server/server.js',
  'dist/client/index.html',
  'dist/client/assets/index.js',
  'dist/client/assets/index.css',
];

describe('release-package.mjs verify', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gavel-release-package-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  // Packs a tarball and npm pack report the way `release-package.mjs pack` leaves them, then
  // runs verify on them from a checkout whose package.json is the packed one.
  async function verify(bin: Record<string, string>) {
    const manifest = {
      name: '@photostructure/gavel',
      version,
      repository: { type: 'git', url: 'https://github.com/photostructure/gavel.git' },
      bin,
    };
    const staging = join(directory, 'staging');
    for (const file of files) {
      const path = join(staging, 'package', file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file === 'package.json' ? JSON.stringify(manifest) : '');
    }
    await writeFile(join(directory, 'package.json'), JSON.stringify(manifest));
    const artifacts = join(directory, 'artifacts');
    await mkdir(artifacts);
    const filename = `photostructure-gavel-${version}.tgz`;
    execFileSync('tar', [
      '-czf',
      join(artifacts, filename),
      '-C',
      staging,
      ...files.map((file) => `package/${file}`),
    ]);
    await writeFile(
      join(artifacts, 'PACK.json'),
      JSON.stringify([
        { name: manifest.name, version, filename, files: files.map((path) => ({ path })) },
      ]),
    );
    return spawnSync(process.execPath, [script, 'verify', artifacts], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_REPOSITORY: 'photostructure/gavel',
        EXPECTED_PACKAGE_VERSION: version,
      },
    });
  }

  it('accepts @photostructure/gavel with the gavel command', async () => {
    const result = await verify({ gavel: './dist/cli/index.js' });
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      `Verified @photostructure/gavel@${version}: ${files.length} files\n`,
    );
    expect(result.status).toBe(0);
  });

  it('rejects a package without the gavel command', async () => {
    const result = await verify({ difit: './dist/cli/index.js' });
    expect(result.stderr).toContain('CLI entrypoint does not match the release');
    expect(result.status).toBe(1);
  });
});
