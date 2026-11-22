import { describe, expect, it } from 'vitest';

import type { DiffFile } from '../../types/diff';

import { getDiffContentForHashing, isLargeDiffFile } from './diffUtils';

describe('isLargeDiffFile', () => {
  it('counts added and deleted lines, and calls a file large past 1024 of them', () => {
    expect(isLargeDiffFile({ additions: 1024, deletions: 0 })).toBe(false);
    expect(isLargeDiffFile({ additions: 1025, deletions: 0 })).toBe(true);
    expect(isLargeDiffFile({ additions: 600, deletions: 425 })).toBe(true);
  });
});

describe('getDiffContentForHashing', () => {
  const file = (start: number, header: string, added: string): DiffFile => ({
    path: 'src/a.ts',
    status: 'modified',
    additions: 1,
    deletions: 0,
    chunks: [
      {
        header,
        oldStart: start,
        oldLines: 1,
        newStart: start,
        newLines: 2,
        lines: [
          { type: 'normal', content: 'const a = 1;' },
          { type: 'add', content: added },
        ],
      },
    ],
  });

  it('ignores hunk line numbers, so a rebase that shifts a hunk keeps its viewed mark', () => {
    expect(getDiffContentForHashing(file(10, '@@ -10 +10,2 @@ function f()', 'b'))).toBe(
      getDiffContentForHashing(file(40, '@@ -40 +40,2 @@ function f()', 'b')),
    );
  });

  it('still tells apart hunks whose lines or context text differ', () => {
    const base = getDiffContentForHashing(file(10, '@@ -10 +10,2 @@ function f()', 'b'));
    expect(getDiffContentForHashing(file(10, '@@ -10 +10,2 @@ function f()', 'c'))).not.toBe(base);
    expect(getDiffContentForHashing(file(10, '@@ -10 +10,2 @@ function g()', 'b'))).not.toBe(base);
  });
});
