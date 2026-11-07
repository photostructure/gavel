import { describe, expect, it } from 'vitest';

import type { DiffLine } from '../../types/diff';
import type { LineDraftAnchor } from '../hooks/useCommentDrafts';

import { anchorsNotShown, codeInFiles } from './LineCommentComposer';

const normal = (n: number): DiffLine => ({
  type: 'normal',
  content: `line ${n}`,
  oldLineNumber: n,
  newLineNumber: n,
});
const anchor = (lineNumber: number): LineDraftAnchor => ({
  kind: 'line',
  filePath: 'a.ts',
  side: 'new',
  lineNumber,
});

describe('anchorsNotShown', () => {
  it('keeps only the drafts whose line no chunk shows', () => {
    const chunks = [{ lines: [1, 2, 3].map(normal) }, { lines: [16, 17].map(normal) }];
    expect(anchorsNotShown([anchor(2), anchor(9), anchor(16)], chunks)).toEqual([anchor(9)]);
  });

  it('finds the code of a draft in any file of the diff', () => {
    const files = [
      { path: 'a.ts', chunks: [{ lines: [1, 2].map(normal) }] },
      { path: 'b.ts', chunks: [{ lines: [7, 8].map(normal) }] },
    ];
    expect(codeInFiles(files, { ...anchor(8), filePath: 'b.ts' })).toBe('line 8');
    expect(codeInFiles(files, { ...anchor(9), filePath: 'b.ts' })).toBeUndefined();
    expect(codeInFiles(files, { ...anchor(1), filePath: 'gone.ts' })).toBeUndefined();
  });

  it('uses the whitespace snapshot lines when a chunk has them', () => {
    const files = [
      {
        path: 'a.ts',
        chunks: [{ lines: [normal(1)], snapshotLines: [{ ...normal(1), content: ' line 1 ' }] }],
      },
    ];
    expect(codeInFiles(files, anchor(1))).toBe(' line 1 ');
  });
});
