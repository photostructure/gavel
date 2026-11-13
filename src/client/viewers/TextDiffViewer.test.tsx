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

  it('points each arrow the way the shown code grows, as GitHub does', () => {
    const top = { ...first, hiddenLinesBefore: 30 };
    const bottom = { ...second, hiddenLinesBefore: 40, hiddenLinesAfter: 50 };
    const options = props({ mergedChunks: [top, bottom] });
    render(<TextDiffViewer {...options} />);
    const buttons = screen.getAllByRole('button', { name: /^Expand 20 lines/ });
    // Top of file: the first hunk grows up. Middle: the hunk above grows down, then
    // the hunk below grows up. End of file: the last hunk grows down.
    expect(
      buttons.map((button) => [
        button.getAttribute('aria-label'),
        button.querySelector('svg')?.getAttribute('class'),
      ]),
    ).toEqual([
      ['Expand 20 lines up', expect.stringContaining('lucide-arrow-up-from-line')],
      ['Expand 20 lines down', expect.stringContaining('lucide-arrow-down-from-line')],
      ['Expand 20 lines up', expect.stringContaining('lucide-arrow-up-from-line')],
      ['Expand 20 lines down', expect.stringContaining('lucide-arrow-down-from-line')],
    ]);
    for (const button of buttons) fireEvent.click(button);
    expect(vi.mocked(options.expandHiddenLines).mock.calls).toEqual([
      [file, 0, 'up'],
      [file, 0, 'down'],
      [file, 1, 'up'],
      [file, 1, 'down'],
    ]);
  });

  it('expands the whole gap on a Shift- or Alt-click of either arrow', () => {
    const top = { ...first, hiddenLinesBefore: 30 };
    const bottom = { ...second, hiddenLinesBefore: 40, hiddenLinesAfter: 50 };
    const options = props({ mergedChunks: [top, bottom] });
    render(<TextDiffViewer {...options} />);
    const [topUp, middleDown, middleUp, bottomDown] = screen.getAllByRole('button', {
      name: /^Expand 20 lines/,
    });
    expect(middleDown).toHaveAttribute(
      'title',
      'Expand 20 lines down (Shift+Click or Alt+Click to expand all 40)',
    );
    fireEvent.click(topUp!, { shiftKey: true });
    fireEvent.click(middleDown!, { altKey: true });
    fireEvent.click(middleUp!, { shiftKey: true });
    fireEvent.click(bottomDown!, { altKey: true });
    expect(vi.mocked(options.expandAllBetweenChunks).mock.calls).toEqual([
      [file, 0, 30],
      [file, 1, 40],
      [file, 1, 40],
    ]);
    expect(vi.mocked(options.expandHiddenLines).mock.calls).toEqual([[file, 1, 'down', 50]]);
  });

  it('makes the bar beside each gap button do what that button does', () => {
    const top = { ...first, hiddenLinesBefore: 30 };
    const bottom = { ...second, hiddenLinesBefore: 12, hiddenLinesAfter: 50 };
    const options = props({ mergedChunks: [top, bottom] });
    const { container } = render(<TextDiffViewer {...options} />);
    const areas = [...container.querySelectorAll<HTMLElement>('[data-expand-area]')];
    // A gap with two arrows splits its bar: the top half beside the down arrow, the
    // bottom half beside the up arrow. A gap with one button gives it the whole bar.
    expect(areas.map((area) => area.dataset.expandArea)).toEqual(['up', 'all', 'down']);
    for (const area of areas) fireEvent.click(area);
    fireEvent.click(areas[0]!, { shiftKey: true });
    expect(vi.mocked(options.expandHiddenLines).mock.calls).toEqual([
      [file, 0, 'up'],
      [file, 1, 'down'],
    ]);
    expect(vi.mocked(options.expandAllBetweenChunks).mock.calls).toEqual([
      [file, 1, 12],
      [file, 0, 30],
    ]);
  });

  it('splits the bar of a middle gap with both arrows into halves', () => {
    const middle = { ...second, hiddenLinesBefore: 40, hiddenLinesAfter: 0 };
    const options = props({ mergedChunks: [{ ...first, hiddenLinesBefore: 0 }, middle] });
    const { container } = render(<TextDiffViewer {...options} />);
    const areas = [...container.querySelectorAll<HTMLElement>('[data-expand-area]')];
    expect(areas.map((area) => area.dataset.expandArea)).toEqual(['down', 'up']);
    for (const area of areas) fireEvent.click(area);
    expect(vi.mocked(options.expandHiddenLines).mock.calls).toEqual([
      [file, 0, 'down'],
      [file, 1, 'up'],
    ]);
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
