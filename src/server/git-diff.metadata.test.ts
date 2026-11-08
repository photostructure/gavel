import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GitDiffParser } from './git-diff.js';

describe('native Git metadata paths', () => {
  it.each(['plain space.sh', 'é space.sh', '🌲 space.sh', 'dir b/part name.sh'])(
    'renders a metadata-only mode change literally: %s',
    (path) => {
      const patch = `diff --git a/${path} b/${path}\nold mode 100644\nnew mode 100755\n`;
      const response = new GitDiffParser().parseStdinDiff(patch);
      expect(response.files).toEqual([
        expect.objectContaining({ path, status: 'modified', chunks: [] }),
      ]);
      expect(response.isEmpty).toBe(false);
    },
  );

  it.each(['rename', 'copy'])(
    'preserves literal prefix-like directories in %s metadata',
    (operation) => {
      const patch = `diff --git a/a/old space.txt b/b/new space.txt\nsimilarity index 100%\n${operation} from a/old space.txt\n${operation} to b/new space.txt\n`;
      expect(new GitDiffParser().parseStdinDiff(patch).files).toEqual([
        expect.objectContaining({
          path: 'b/new space.txt',
          oldPath: 'a/old space.txt',
          status: 'renamed',
          chunks: [],
        }),
      ]);
    },
  );

  it('renders a pure copy from actual Git output without ordinary file headers', () => {
    const root = mkdtempSync(join(tmpdir(), 'gavel-metadata-copy-'));
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: '1',
    };
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
          '-c',
          `core.hooksPath=${join(root, 'disabled-hooks')}`,
          ...args,
        ],
        { cwd: root, env, encoding: 'utf8' },
      );
    try {
      git('init', '--quiet');
      git('config', 'color.ui', 'always');
      const original = 'one\ntwo\nthree\n';
      writeFileSync(join(root, 'old space.txt'), original);
      git('add', 'old space.txt');
      git('commit', '--quiet', '--no-verify', '-m', 'fixture');
      writeFileSync(join(root, 'new space.txt'), original);
      writeFileSync(join(root, 'old space.txt'), 'changed\ntwo\nthree\n');
      git('add', 'old space.txt', 'new space.txt');
      // git -c color.ui=always diff --color=never --find-copies HEAD -- keeps headers uncolored.
      const patch = git(
        'diff',
        '--color=never',
        '--no-ext-diff',
        '--no-textconv',
        '--find-copies',
        'HEAD',
        '--',
      );
      expect(patch).toContain('copy from old space.txt\ncopy to new space.txt\n');
      const files = new GitDiffParser(root).parseStdinDiff(patch).files;
      expect(files.map((file) => file.path)).toEqual(['new space.txt', 'old space.txt']);
      expect(files[0]).toMatchObject({ oldPath: 'old space.txt', status: 'renamed', chunks: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
