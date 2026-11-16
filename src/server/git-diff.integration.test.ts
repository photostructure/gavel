import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitDiffParser } from './git-diff.js';

describe('GitDiffParser working-tree blob reads with real git', () => {
  let root: string;
  let parser: GitDiffParser;

  beforeEach(() => {
    for (const key of Object.keys(process.env))
      if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
    vi.stubEnv('GIT_CONFIG_GLOBAL', devNull);
    vi.stubEnv('GIT_CONFIG_SYSTEM', devNull);
    // simple-git drops GIT_* variables from the git it spawns, so its global config comes
    // from HOME and XDG_CONFIG_HOME.
    vi.stubEnv('HOME', devNull);
    vi.stubEnv('XDG_CONFIG_HOME', devNull);
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-blob-')));
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'remote.origin.url', 'https://user:secret@example.com/r.git'], {
      cwd: root,
    });
    writeFileSync(join(root, '.gitignore'), '.env\n');
    writeFileSync(join(root, '.env'), 'TOKEN=secret\n');
    writeFileSync(join(root, 'tracked.txt'), 'one\ntwo\n');
    mkdirSync(join(root, 'docs'));
    // On a case-sensitive volume, a real directory named .GIT stands in for the .git that a
    // case-insensitive volume would open for .GIT/config.
    if (!existsSync(join(root, '.GIT'))) {
      mkdirSync(join(root, '.GIT'));
      writeFileSync(join(root, '.GIT', 'config'), 'case-folded\n');
    }
    symlinkSync(join(root, '.git', 'config'), join(root, 'link-to-git-config'));
    symlinkSync(join(root, '.env'), join(root, 'link-to-env'));
    execFileSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: root });
    parser = new GitDiffParser(root);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it.each(['.', 'working'])('serves a tracked file at ref %s', async (ref) => {
    await expect(parser.getBlobContent('tracked.txt', ref)).resolves.toEqual(
      Buffer.from('one\ntwo\n'),
    );
  });

  it.each([
    '.git/config',
    './.git/config',
    'docs/../.git/config',
    '.GIT/config',
    'link-to-git-config',
    '.env',
    'link-to-env',
  ])('refuses %s like a path outside the repository', async (filepath) => {
    for (const ref of ['.', 'working']) {
      await expect(parser.getBlobContent(filepath, ref)).rejects.toThrow(
        'File path outside repository',
      );
    }
  });

  it('refuses a line count for .git/config', async () => {
    await expect(parser.getLineCount('.git/config', '.')).rejects.toThrow(
      'File path outside repository',
    );
  });
});
