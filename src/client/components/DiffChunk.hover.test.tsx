import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffChunk as DiffChunkData } from '../../types/diff';
import { WordHighlightProvider } from '../contexts/WordHighlightContext';

import { DiffChunk } from './DiffChunk';

// Counts code-line renders. The stand-in is not memoized, so it renders whenever the row
// around it does.
const highlighter = vi.hoisted(() => ({ renders: 0 }));
vi.mock('./EnhancedPrismSyntaxHighlighter', () => ({
  EnhancedPrismSyntaxHighlighter: ({ code }: { code: string }) => {
    highlighter.renders++;
    return <span data-code-line="true">{code}</span>;
  },
}));

const chunk: DiffChunkData = {
  header: '@@ -1,5 +0,0 @@',
  oldStart: 1,
  oldLines: 5,
  newStart: 0,
  newLines: 0,
  lines: [1, 2, 3, 4, 5].map((n) => ({
    type: 'delete' as const,
    content: `const line${n} = ${n};`,
    oldLineNumber: n,
  })),
};

const noop = () => {};
const asyncNoop = async () => {};

const renderChunk = (mode: 'unified' | 'split') => {
  const view = render(
    <WordHighlightProvider>
      <DiffChunk
        chunk={chunk}
        chunkIndex={0}
        threads={[]}
        mode={mode}
        onAddComment={asyncNoop}
        onGenerateThreadPrompt={() => ''}
        onToggleThreadResolved={noop}
        onReplyToThread={asyncNoop}
        onRemoveMessage={noop}
        onUpdateMessage={noop}
        filename="file.ts"
      />
    </WordHighlightProvider>,
  );
  return [...view.container.querySelectorAll('[data-diff-line-row="true"]')];
};

beforeEach(() => {
  highlighter.renders = 0;
});

// In a hunk of thousands of lines, re-rendering every row on each pointer move took about
// 90 ms per row crossed.
describe('DiffChunk hover', () => {
  it.each([
    ['unified', (row: Element) => fireEvent.mouseEnter(row)],
    ['split', (row: Element) => fireEvent.mouseMove(row.children[1]!)],
  ] as const)('re-renders only the %s row under the pointer', (mode, hover) => {
    const rows = renderChunk(mode);
    const row = rows[2]!;
    highlighter.renders = 0;

    hover(row);

    expect(row.querySelector('[data-comment-button="true"]')).not.toBeNull();
    expect(highlighter.renders).toBe(row.querySelectorAll('[data-code-line="true"]').length);
  });

  it.each([
    ['unified', (row: Element) => fireEvent.mouseEnter(row)],
    ['split', (row: Element) => fireEvent.mouseMove(row.children[1]!)],
  ] as const)('moves the %s line buttons to the row the pointer enters', (mode, hover) => {
    const rows = renderChunk(mode);
    const withButtons = () =>
      rows.flatMap((row, index) =>
        row.querySelector('[data-comment-button="true"]') ? [index] : [],
      );

    hover(rows[1]!);
    expect(withButtons()).toEqual([1]);
    fireEvent.mouseLeave(rows[1]!);
    hover(rows[3]!);
    expect(withButtons()).toEqual([3]);
    fireEvent.mouseLeave(rows[3]!);
    expect(withButtons()).toEqual([]);
  });
});
