import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DiffFile } from '../../types/diff';
import { CommentDraftScope, useCommentDraft } from '../hooks/useCommentDrafts';
import type { MergedChunk } from '../hooks/useExpandedLines';

import { TextDiffViewer } from './TextDiffViewer';
import type { DiffViewerBodyProps } from './types';

vi.mock('../components/DiffChunk', () => ({ DiffChunk: () => <div>Captured hunk</div> }));

const first: MergedChunk = {
  header: '@@ -4 +4 @@',
  oldStart: 4,
  oldLines: 1,
  newStart: 4,
  newLines: 1,
  lines: [],
  originalIndices: [0],
  hiddenLinesBefore: 3,
  hiddenLinesAfter: 0,
};
const second: MergedChunk = {
  ...first,
  header: '@@ -7 +7 @@',
  oldStart: 7,
  newStart: 7,
  originalIndices: [1],
  hiddenLinesBefore: 2,
  hiddenLinesAfter: 4,
};
const file: DiffFile = {
  path: 'file.ts',
  status: 'modified',
  additions: 2,
  deletions: 2,
  chunks: [first, second],
};

function props(overrides: Partial<DiffViewerBodyProps> = {}): DiffViewerBodyProps {
  return {
    file,
    threads: [],
    diffMode: 'unified',
    baseCommitish: 'base',
    targetCommitish: '.',
    mergedChunks: [first, second],
    isExpandLoading: false,
    expandHiddenLines: vi.fn(async () => {}),
    expandAllBetweenChunks: vi.fn(async () => {}),
    onAddComment: vi.fn(async () => {}),
    onGenerateThreadPrompt: vi.fn(() => ''),
    onToggleThreadResolved: vi.fn(),
    onReplyToThread: vi.fn(async () => {}),
    onRemoveMessage: vi.fn(),
    onUpdateMessage: vi.fn(),
    ...overrides,
  };
}

describe('text patch context controls', () => {
  it.each([
    { label: 'fixed captures', overrides: { canExpandHiddenLines: false } },
    {
      label: 'stdin patches',
      overrides: { baseCommitish: 'stdin', targetCommitish: 'stdin', canExpandHiddenLines: false },
    },
  ])('shows inert gap labels for $label instead of expansion actions', ({ overrides }) => {
    const options = props(overrides);
    render(<TextDiffViewer {...options} />);
    expect(screen.queryByRole('button', { name: /Expand/ })).not.toBeInTheDocument();
    expect(screen.getByText('3 lines outside this patch')).toBeVisible();
    expect(screen.getByText('2 lines outside this patch')).toBeVisible();
    expect(screen.getByText('4 lines outside this patch')).toBeVisible();
    expect(screen.getAllByText('Captured hunk')).toHaveLength(2);
    expect(options.expandHiddenLines).not.toHaveBeenCalled();
    expect(options.expandAllBetweenChunks).not.toHaveBeenCalled();
  });

  it('keeps expansion actions working for ordinary Git comparisons', () => {
    const options = props({ canExpandHiddenLines: true });
    render(<TextDiffViewer {...options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all 3 hidden lines' }));
    expect(options.expandAllBetweenChunks).toHaveBeenCalledWith(file, 0, 3);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all 2 hidden lines' }));
    expect(options.expandAllBetweenChunks).toHaveBeenCalledWith(file, 1, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all 4 hidden lines' }));
    expect(options.expandHiddenLines).toHaveBeenCalledWith(file, 1, 'down', 4);
    expect(screen.queryByText(/outside this patch/)).not.toBeInTheDocument();
  });
});

describe('drafts on lines no longer in the diff', () => {
  afterEach(() => localStorage.clear());

  const shown: MergedChunk = {
    ...first,
    lines: [{ type: 'add', content: 'kept', newLineNumber: 4 }],
  };
  const seed = (lineNumber: number) => {
    const { result, unmount } = renderHook(
      () => useCommentDraft({ kind: 'line', filePath: 'file.ts', side: 'new', lineNumber }),
      {
        wrapper: ({ children }) => (
          <CommentDraftScope value="review-a">{children}</CommentDraftScope>
        ),
      },
    );
    act(() => result.current.setBody(`Draft on ${lineNumber}`));
    unmount();
  };
  const renderViewer = (onAddComment = vi.fn(async () => {})) =>
    render(
      <CommentDraftScope value="review-a">
        <TextDiffViewer {...props({ mergedChunks: [shown], onAddComment })} />
      </CommentDraftScope>,
    );

  it('shows the draft at the top of its file and can still send it', async () => {
    seed(9);
    const onAddComment = vi.fn(async () => {});
    renderViewer(onAddComment);
    expect(screen.getByText(/line 9, which is not shown here/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Draft on 9');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(onAddComment).toHaveBeenCalledWith(9, 'Draft on 9', undefined, 'new', {
        isQuestion: false,
        intent: 'comment',
      }),
    );
  });

  it('leaves a draft whose line is still shown to its chunk', () => {
    seed(4);
    renderViewer();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
