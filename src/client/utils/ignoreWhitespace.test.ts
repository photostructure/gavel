import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommentThread, DiffChunk, DiffFile, DiffLine, LineNumber } from '../../types/diff';

import { hideWhitespaceChanges, remapWhitespaceCursor } from './ignoreWhitespace';

const old = (content: string, oldLineNumber: number): DiffLine => ({
  type: 'delete',
  content,
  oldLineNumber,
});
const added = (content: string, newLineNumber: number): DiffLine => ({
  type: 'add',
  content,
  newLineNumber,
});
const chunk = (lines: DiffLine[]): DiffChunk => ({
  header: '@@ -20,3 +40,4 @@',
  oldStart: 20,
  oldLines: 3,
  newStart: 40,
  newLines: 4,
  lines,
});
const thread = (side: 'old' | 'new', line: LineNumber): CommentThread => ({
  id: 'comment',
  file: 'file.ts',
  side,
  line,
  createdAt: '',
  updatedAt: '',
  messages: [],
});

describe('captured whitespace presentation', () => {
  // The alignment budgets are wall-clock milliseconds, so a busy machine would change the result.
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(0));
  afterEach(() => vi.restoreAllMocks());

  it.each(['left', 'right'] as const)(
    'remaps a surviving %s-side cursor by its captured line number',
    (side) => {
      const original: DiffFile = {
        path: 'file.ts',
        status: 'modified',
        additions: 2,
        deletions: 2,
        chunks: [chunk([old(' a', 20), old('before', 21), added('a', 40), added('after', 41)])],
      };
      const projected = { ...original, chunks: hideWhitespaceChanges(original.chunks, []) };
      expect(
        remapWhitespaceCursor([original], [projected], {
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: side === 'left' ? 1 : 3,
          side,
        }),
      ).toEqual({ fileIndex: 0, chunkIndex: 0, lineIndex: side === 'left' ? 0 : 1, side });
      expect(
        remapWhitespaceCursor([projected], [original], {
          fileIndex: 0,
          chunkIndex: 0,
          lineIndex: side === 'left' ? 0 : 1,
          side,
        }),
      ).toEqual({ fileIndex: 0, chunkIndex: 0, lineIndex: side === 'left' ? 1 : 3, side });
    },
  );

  it('aligns whitespace pairs around inserted and substantive changes without changing anchors', () => {
    const original = chunk([
      old('  first();\t', 20),
      old('before();', 21),
      old('  last();', 22),
      added('first();', 40),
      added('inserted();', 41),
      added('after();', 42),
      added('last();\r', 43),
    ]);
    const before = structuredClone(original);
    const result = hideWhitespaceChanges([original], [])[0]!;
    expect(result.lines).toEqual([original.lines[1], original.lines[4], original.lines[5]]);
    expect(result.snapshotLines).toBe(original.lines);
    expect(result).toMatchObject({
      header: original.header,
      oldStart: 20,
      newStart: 40,
      oldLines: 3,
      newLines: 4,
    });
    expect(original).toEqual(before);
    expect(result.lines[0]).toBe(original.lines[1]);
  });

  it.each(['old', 'new'] as const)(
    'retains both sides of pairs covered by a %s-side comment range',
    (side) => {
      const original = chunk([
        old(' a', 20),
        old(' b', 21),
        old(' c', 22),
        added('a', 40),
        added('b', 41),
        added('c', 42),
      ]);
      const range: [number, number] = side === 'old' ? [20, 21] : [40, 41];
      const result = hideWhitespaceChanges([original], [thread(side, range)])[0]!;
      expect(result.lines).toEqual([
        original.lines[0],
        original.lines[1],
        original.lines[3],
        original.lines[4],
      ]);
    },
  );

  it('keeps standalone blank additions/deletions and Unicode whitespace changes', () => {
    for (const lines of [
      [added('  ', 40)],
      [old('\t', 20)],
      [old('a\u00a0b', 20), added('ab', 40)],
    ]) {
      const original = chunk(lines);
      expect(hideWhitespaceChanges([original], [])[0]).toBe(original);
    }
  });

  it('retains available whitespace anchors for outdated discussions too', () => {
    const original = chunk([old(' a', 20), added('a', 40)]);
    const discussion = { ...thread('old', 20), isOutdated: true };
    expect(hideWhitespaceChanges([original], [discussion])[0]).toBe(original);
  });

  it('does not match across context or hunk boundaries', () => {
    const original = chunk([
      old(' a', 20),
      { type: 'normal', content: 'context', oldLineNumber: 21, newLineNumber: 40 },
      added('a', 41),
    ]);
    expect(hideWhitespaceChanges([original], [])[0]).toBe(original);
    const chunks = [chunk([old(' a', 20)]), chunk([added('a', 40)])];
    expect(hideWhitespaceChanges(chunks, [])).toEqual(chunks);
  });

  it('keeps all-whitespace files as empty presentation chunks with original snapshots and metadata', () => {
    const original = {
      ...chunk([old(' a', 20), added('a', 40)]),
      originalIndices: [0],
      hiddenLinesBefore: 19,
    };
    const result = hideWhitespaceChanges([original], [])[0]!;
    expect(result.lines).toEqual([]);
    expect(result.snapshotLines).toBe(original.lines);
    expect(result.originalIndices).toBe(original.originalIndices);
    expect(result.hiddenLinesBefore).toBe(19);
  });

  it('leaves oversized or expensive alignments visible', () => {
    const oversized = chunk([old(' '.repeat(200_001) + 'a', 20), added('a', 40)]);
    const tooManyLines = chunk([
      ...Array.from({ length: 1_001 }, (_, index) => old(` a${index}`, index + 1)),
      ...Array.from({ length: 1_001 }, (_, index) => added(`a${index}`, index + 1)),
    ]);
    const expensive = chunk([
      ...Array.from({ length: 101 }, (_, index) => old(`old${index}`, index + 1)),
      old(' shared', 102),
      ...Array.from({ length: 101 }, (_, index) => added(`new${index}`, index + 1)),
      added('shared', 102),
    ]);
    for (const original of [oversized, tooManyLines, expensive]) {
      expect(hideWhitespaceChanges([original], [])[0]).toBe(original);
    }
  });
});
