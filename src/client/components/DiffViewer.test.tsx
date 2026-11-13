import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffChunk, DiffFile } from '../../types/diff';
import { WordHighlightProvider } from '../contexts/WordHighlightContext';
import {
  CommentDraftScope,
  useCommentDraft,
  type LineDraftAnchor,
} from '../hooks/useCommentDrafts';
import type { MergedChunk } from '../hooks/useExpandedLines';

import { DiffViewer } from './DiffViewer';

const normal = (n: number) => ({
  type: 'normal' as const,
  content: `line ${n}`,
  oldLineNumber: n,
  newLineNumber: n,
});
const hunk = (start: number): DiffChunk => ({
  header: `@@ -${start},3 +${start},3 @@`,
  oldStart: start,
  oldLines: 3,
  newStart: start,
  newLines: 3,
  lines: [start, start + 1, start + 2].map(normal),
});
const file: DiffFile = {
  path: 'notes.txt',
  status: 'modified',
  additions: 0,
  deletions: 0,
  chunks: [hunk(1), hunk(20)],
};
// Lines 4-19 sit hidden between the two hunks.
const mergedChunks: MergedChunk[] = [
  { ...hunk(1), originalIndices: [0], hiddenLinesBefore: 0, hiddenLinesAfter: 0 },
  { ...hunk(20), originalIndices: [1], hiddenLinesBefore: 16, hiddenLinesAfter: 0 },
];

type AddComment = (file: string, line: number | [number, number], body: string) => Promise<void>;

type ExpandAllBetweenChunks = (
  file: DiffFile,
  chunkIndex: number,
  hiddenLines: number,
) => Promise<void>;

function renderViewer(
  expandAllBetweenChunks: ExpandAllBetweenChunks,
  chunks: MergedChunk[] = mergedChunks,
  onAddComment: AddComment = vi.fn(async () => {}),
  pendingJump: LineDraftAnchor | null = null,
  shownFile: DiffFile = file,
  extraProps: Partial<ComponentProps<typeof DiffViewer>> = {},
) {
  return render(
    <WordHighlightProvider>
      <CommentDraftScope value="review-a">
        <DiffViewer
          file={shownFile}
          threads={[]}
          diffMode="unified"
          reviewedFiles={new Set()}
          onToggleReviewed={vi.fn()}
          collapsedFiles={new Set()}
          onToggleCollapsed={vi.fn()}
          onToggleAllCollapsed={vi.fn()}
          onAddComment={onAddComment}
          onGenerateThreadPrompt={() => ''}
          onToggleThreadResolved={vi.fn()}
          onReplyToThread={vi.fn(async () => {})}
          onRemoveMessage={vi.fn()}
          onUpdateMessage={vi.fn()}
          baseCommitish="HEAD"
          targetCommitish="."
          mergedChunks={chunks}
          expandLines={vi.fn(async () => {})}
          expandAllBetweenChunks={expandAllBetweenChunks}
          expandAllLines={vi.fn(async () => {})}
          collapseExpandedLines={vi.fn()}
          prefetchFileContent={vi.fn(async () => {})}
          isExpandLoading={false}
          pendingJump={pendingJump}
          {...extraProps}
        />
      </CommentDraftScope>
    </WordHighlightProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('DiffViewer context expansion for line drafts', () => {
  it('reopens the hidden context that holds a restored draft', () => {
    const { result, unmount } = renderHook(
      () => useCommentDraft({ kind: 'line', filePath: 'notes.txt', side: 'new', lineNumber: 10 }),
      {
        wrapper: ({ children }) => (
          <CommentDraftScope value="review-a">{children}</CommentDraftScope>
        ),
      },
    );
    act(() => result.current.setBody('On a hidden line'));
    unmount();

    const expandAllBetweenChunks = vi.fn<ExpandAllBetweenChunks>(async () => {});
    renderViewer(expandAllBetweenChunks);
    expect(expandAllBetweenChunks).toHaveBeenCalledWith(file, 1, 16);
  });

  it("reopens the hidden context that holds a comment link's line", () => {
    const expandAllBetweenChunks = vi.fn<ExpandAllBetweenChunks>(async () => {});
    renderViewer(expandAllBetweenChunks, mergedChunks, undefined, {
      kind: 'line',
      filePath: 'notes.txt',
      side: 'new',
      lineNumber: [9, 11],
    });
    expect(expandAllBetweenChunks).toHaveBeenCalledWith(file, 1, 16);
  });

  it('does not expand a file whose path is not valid UTF-8, whose content cannot be fetched', () => {
    const { result, unmount } = renderHook(
      () => useCommentDraft({ kind: 'line', filePath: 'notes.txt', side: 'new', lineNumber: 10 }),
      {
        wrapper: ({ children }) => (
          <CommentDraftScope value="review-a">{children}</CommentDraftScope>
        ),
      },
    );
    act(() => result.current.setBody('On a hidden line'));
    unmount();

    const expandAllBetweenChunks = vi.fn<ExpandAllBetweenChunks>(async () => {});
    renderViewer(expandAllBetweenChunks, mergedChunks, undefined, null, {
      ...file,
      hasNonUtf8Path: true,
    });
    expect(expandAllBetweenChunks).not.toHaveBeenCalled();
    expect(screen.getByText('16 lines outside this patch')).toBeInTheDocument();
  });

  it('expands nothing while the reviewer types on a revealed context line', () => {
    // Lines 15-19 were revealed from the lower hunk; lines 4-14 are still hidden.
    const partlyExpanded: MergedChunk[] = [
      mergedChunks[0]!,
      {
        ...hunk(20),
        lines: [15, 16, 17, 18, 19, 20, 21, 22].map(normal),
        originalIndices: [1],
        hiddenLinesBefore: 11,
        hiddenLinesAfter: 0,
      },
    ];
    const expandAllBetweenChunks = vi.fn<ExpandAllBetweenChunks>(async () => {});
    const { container } = renderViewer(expandAllBetweenChunks, partlyExpanded);
    // Rows 0-2 are lines 1-3; row 4 is line 16.
    const row = container.querySelectorAll('[data-diff-line-row="true"]')[4]!;
    fireEvent.click(row);
    fireEvent.click(row, { shiftKey: true });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'H' } });
    expect(expandAllBetweenChunks).not.toHaveBeenCalled();
  });

  it('keeps a line draft when saving the comment fails', async () => {
    const onAddComment = vi.fn<AddComment>(async () => {
      throw new Error('save failed');
    });
    const { container } = renderViewer(
      vi.fn<ExpandAllBetweenChunks>(async () => {}),
      mergedChunks,
      onAddComment,
    );
    const row = container.querySelectorAll('[data-diff-line-row="true"]')[4]!;
    fireEvent.click(row);
    fireEvent.click(row, { shiftKey: true });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Do not lose this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onAddComment).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
    expect(screen.getByRole('textbox')).toHaveValue('Do not lose this');
  });
});

describe('DiffViewer header', () => {
  it('opens the file in the editor at its first hunk, unless the change deletes it', () => {
    const onOpenInEditor = vi.fn();
    const shifted = { ...file, chunks: [hunk(20)] };
    const view = renderViewer(
      vi.fn(async () => {}),
      mergedChunks,
      vi.fn(async () => {}),
      null,
      shifted,
      { onOpenInEditor },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open file in editor' }));
    expect(onOpenInEditor).toHaveBeenCalledWith('notes.txt', 20);
    view.unmount();

    renderViewer(
      vi.fn(async () => {}),
      mergedChunks,
      vi.fn(async () => {}),
      null,
      { ...file, status: 'deleted' },
      { onOpenInEditor },
    );
    expect(screen.queryByRole('button', { name: 'Open file in editor' })).toBeNull();
  });
});

describe('DiffViewer in a named review', () => {
  it("shows an image from the review's capture instead of an empty text diff", () => {
    const image: DiffFile = {
      path: 'still.webp',
      status: 'modified',
      additions: 0,
      deletions: 0,
      chunks: [],
      isBinary: true,
    };
    renderViewer(
      vi.fn(async () => {}),
      [],
      vi.fn(async () => {}),
      null,
      image,
      {
        capture: { name: 'task', version: 2 },
      },
    );
    expect(screen.getAllByRole('img').map((img) => img.getAttribute('src'))).toEqual([
      '/api/blob/still.webp?review=task&version=2&side=old',
      '/api/blob/still.webp?review=task&version=2&side=new',
    ]);
  });

  // A capture has no bytes for these files, and its base commit may not be the patch's base.
  it.each([
    [
      'File renamed without changes.',
      { path: 'after.webp', oldPath: 'before.webp', status: 'renamed' },
    ],
    [
      'File copied without changes.',
      { path: 'copy.webp', oldPath: 'still.webp', status: 'copied' },
    ],
    ['File mode changed.', { path: 'still.webp', status: 'modified' }],
  ] as const)(
    'says "%s" instead of loading an image with no bytes in the patch',
    (text, change) => {
      const image: DiffFile = { ...change, additions: 0, deletions: 0, chunks: [] };
      renderViewer(
        vi.fn(async () => {}),
        [],
        vi.fn(async () => {}),
        null,
        image,
        {
          capture: { name: 'task', version: 2 },
        },
      );
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.getByText(text)).toBeInTheDocument();
    },
  );

  it('expands a text file from the capture, unless its patch names no old blob', () => {
    const expandAllLines = vi.fn(async () => {});
    const view = renderViewer(
      vi.fn(async () => {}),
      mergedChunks,
      vi.fn(async () => {}),
      null,
      file,
      { capture: { name: 'task', version: 2 }, expandAllLines },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expand all lines' }));
    expect(expandAllLines).toHaveBeenCalledWith(file);
    expect(screen.getByRole('button', { name: 'Expand all 16 hidden lines' })).toBeEnabled();
    view.unmount();

    renderViewer(
      vi.fn(async () => {}),
      mergedChunks,
      vi.fn(async () => {}),
      null,
      { ...file, contextUnavailable: true },
      { capture: { name: 'task', version: 2 } },
    );
    expect(screen.queryByRole('button', { name: /^Expand all/ })).toBeNull();
    expect(screen.getByText('16 lines outside this patch')).toBeInTheDocument();
  });

  it('keeps the text diff of an SVG, which Git captures as text', () => {
    const svg: DiffFile = { ...file, path: 'icon.svg' };
    renderViewer(
      vi.fn(async () => {}),
      mergedChunks,
      vi.fn(async () => {}),
      null,
      svg,
      {
        capture: { name: 'task', version: 2 },
      },
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('16 lines outside this patch')).toBeInTheDocument();
  });

  it('keeps the text hunk of an image symlink replaced by an image', () => {
    // Git writes the symlink's deletion as text and the image's addition as binary, and the
    // parser folds both into one file that is binary and has the symlink's hunk.
    const typeChange: DiffFile = { ...file, path: 'icon.png', isBinary: true };
    renderViewer(
      vi.fn(async () => {}),
      mergedChunks,
      vi.fn(async () => {}),
      null,
      typeChange,
      {
        capture: { name: 'task', version: 2 },
      },
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('16 lines outside this patch')).toBeInTheDocument();
  });
});
