import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readBuildInfo } from './build-info.js';

const script = join(dirname(fileURLToPath(import.meta.url)), 'build-info.js');
let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'gavel-build-info-'));
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  await writeFile(join(repo, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '--quiet', '-m', 'initial');
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('readBuildInfo', () => {
  it('reports the HEAD commit and no uncommitted changes on a clean tree', () => {
    expect(readBuildInfo(repo)).toEqual({ commit: git('rev-parse', 'HEAD'), diffHash: null });
  });

  it('hashes edits to tracked files', async () => {
    await writeFile(join(repo, 'a.txt'), 'two\n');
    const first = readBuildInfo(repo).diffHash;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    await writeFile(join(repo, 'a.txt'), 'three\n');
    expect(readBuildInfo(repo).diffHash).not.toBe(first);
  });

  it('includes untracked files in the hash', async () => {
    await writeFile(join(repo, 'b.txt'), 'new\n');
    const first = readBuildInfo(repo).diffHash;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    await writeFile(join(repo, 'b.txt'), 'newer\n');
    expect(readBuildInfo(repo).diffHash).not.toBe(first);
  });

  it('ignores files git ignores', async () => {
    await writeFile(join(repo, '.gitignore'), 'out/\n');
    git('add', '.gitignore');
    git('commit', '--quiet', '-m', 'ignore');
    await mkdir(join(repo, 'out'));
    await writeFile(join(repo, 'out', 'bundle.js'), 'x');
    expect(readBuildInfo(repo).diffHash).toBeNull();
  });

  it('hashes a tracked diff larger than the default 1 MiB subprocess buffer', async () => {
    await writeFile(join(repo, 'a.txt'), 'x'.repeat(1_200_000));
    expect(readBuildInfo(repo).diffHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes an untracked symlink by its target text, as git does, without following it', async () => {
    await symlink('missing-target', join(repo, 'dangling'));
    const first = readBuildInfo(repo).diffHash;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    await rm(join(repo, 'dangling'));
    await symlink('other-target', join(repo, 'dangling'));
    expect(readBuildInfo(repo).diffHash).not.toBe(first);
  });

  it('hashes an untracked nested repository by its path', async () => {
    await mkdir(join(repo, 'nested'));
    execFileSync('git', ['init', '--quiet'], { cwd: join(repo, 'nested') });
    await writeFile(join(repo, 'nested', 'x.txt'), 'x');
    execFileSync('git', ['add', 'x.txt'], { cwd: join(repo, 'nested') });
    execFileSync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'i'],
      { cwd: join(repo, 'nested') },
    );
    expect(readBuildInfo(repo).diffHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('prints the same values when run as a script', async () => {
    await writeFile(join(repo, 'a.txt'), 'two\n');
    await writeFile(join(repo, 'b.txt'), 'new\n');
    const printed = execFileSync(process.execPath, [script], { cwd: repo, encoding: 'utf8' });
    expect(JSON.parse(printed)).toEqual(readBuildInfo(repo));
  });

  it('gives the same hash for the same changes', async () => {
    await writeFile(join(repo, 'a.txt'), 'two\n');
    await writeFile(join(repo, 'b.txt'), 'new\n');
    expect(readBuildInfo(repo).diffHash).toBe(readBuildInfo(repo).diffHash);
  });
});
