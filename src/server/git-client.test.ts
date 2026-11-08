import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GitDiffParser } from './git-diff.js';

// Git hooks export GIT_DIR and GIT_INDEX_FILE; strip GIT_* so setup commands
// cannot touch the repository that is running this suite.
const setupEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

function createRepo(root: string, name: string): { path: string; head: string } {
  const path = join(root, name);
  mkdirSync(path);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=gavel',
        '-c',
        'user.email=gavel@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: path, env: setupEnv, encoding: 'utf8' },
    ).trim();
  git('init', '--quiet');
  writeFileSync(join(path, 'file.txt'), `${name}\n`);
  git('add', 'file.txt');
  git('commit', '--quiet', '--no-verify', '--message', name);
  return { path, head: git('rev-parse', 'HEAD').slice(0, 7) };
}

describe('git client repository environment', () => {
  let root: string;

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the repository named by GIT_DIR and GIT_WORK_TREE', async () => {
    root = mkdtempSync(join(tmpdir(), 'gavel-git-env-'));
    const cwdRepo = createRepo(root, 'cwd-repo');
    const envRepo = createRepo(root, 'env-repo');
    vi.stubEnv('GIT_DIR', join(envRepo.path, '.git'));
    vi.stubEnv('GIT_WORK_TREE', envRepo.path);

    const parser = new GitDiffParser(cwdRepo.path);

    await expect(parser.resolveCommitish('HEAD')).resolves.toBe(envRepo.head);
  });

  it('uses the same alternate index for staged diffs and blob reads', async () => {
    root = mkdtempSync(join(tmpdir(), 'gavel-git-index-'));
    const repo = createRepo(root, 'index-repo');
    const index = join(root, 'alternate-index');
    const env = { ...setupEnv, GIT_INDEX_FILE: index };
    execFileSync('git', ['read-tree', 'HEAD'], { cwd: repo.path, env });
    writeFileSync(join(repo.path, 'file.txt'), 'alternate staged contents\n');
    execFileSync('git', ['add', 'file.txt'], { cwd: repo.path, env });
    vi.stubEnv('GIT_DIR', join(repo.path, '.git'));
    vi.stubEnv('GIT_WORK_TREE', repo.path);
    vi.stubEnv('GIT_INDEX_FILE', index);
    const parser = new GitDiffParser(repo.path);

    const diff = await parser.parseDiff({ baseCommitish: 'HEAD', targetCommitish: 'staged' });

    expect(diff.files.map((file) => file.path)).toContain('file.txt');
    expect(diff.files.flatMap((file) => file.chunks.flatMap((chunk) => chunk.lines))).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: 'alternate staged contents' })]),
    );
    await expect(parser.getBlobContent('file.txt', 'staged')).resolves.toEqual(
      Buffer.from('alternate staged contents\n'),
    );
    expect(
      execFileSync('git', ['diff', '--cached'], {
        cwd: repo.path,
        env: setupEnv,
        encoding: 'utf8',
      }),
    ).toBe('');
  });
});
