import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DiffChunk as DiffChunkData } from '../../types/diff';
import { DEFAULT_DIFF_VIEW_MODE } from '../../utils/diffMode';
import { WordHighlightProvider } from '../contexts/WordHighlightContext';
import { CommentDraftScope, useCommentDraft } from '../hooks/useCommentDrafts';
import { hideWhitespaceChanges } from '../utils/ignoreWhitespace';

import { DiffChunk } from './DiffChunk';
import { SideBySideDiffChunk } from './SideBySideDiffChunk';

const testChunk: DiffChunkData = {
  header: '@@ -10,3 +10,3 @@',
  oldStart: 10,
  oldLines: 2,
  newStart: 10,
  newLines: 3,
  lines: [
    {
      type: 'normal',
      content: 'const first = 1;',
      oldLineNumber: 10,
      newLineNumber: 10,
    },
    {
      type: 'normal',
      content: 'const second = 2;',
      oldLineNumber: 11,
      newLineNumber: 11,
    },
    {
      type: 'add',
      content: 'const third = 3;',
      newLineNumber: 12,
    },
  ],
};

const noop = () => {};
const asyncNoop = async () => {};
const renderWithProviders = (ui: ReactNode) =>
  render(<WordHighlightProvider>{ui}</WordHighlightProvider>);

describe('DiffChunk range comments', () => {
  it.each([
    ['unified', 'old'],
    ['unified', 'new'],
    ['split', 'old'],
    ['split', 'new'],
  ] as const)(
    'keeps exact %s %s-side snapshots across hidden whitespace rows',
    async (mode, side) => {
      const original: DiffChunkData = {
        header: '@@ -10,3 +10,3 @@',
        oldStart: 10,
        oldLines: 3,
        newStart: 10,
        newLines: 3,
        lines: [
          { type: 'delete', content: 'before', oldLineNumber: 10 },
          { type: 'delete', content: '\t hidden  ', oldLineNumber: 11 },
          { type: 'delete', content: 'after', oldLineNumber: 12 },
          { type: 'add', content: 'new before', newLineNumber: 10 },
          { type: 'add', content: ' hidden\t', newLineNumber: 11 },
          { type: 'add', content: 'new after', newLineNumber: 12 },
        ],
      };
      const filtered = hideWhitespaceChanges([original], [])[0]!;
      const onAddComment = vi.fn().mockResolvedValue(undefined);
      const onLineClick = vi.fn();
      const { container } = renderWithProviders(
        <DiffChunk
          chunk={filtered}
          chunkIndex={0}
          threads={[]}
          mode={mode}
          onAddComment={onAddComment}
          onGenerateThreadPrompt={() => ''}
          onLineClick={onLineClick}
          onToggleThreadResolved={noop}
          onReplyToThread={asyncNoop}
          onRemoveMessage={noop}
          onUpdateMessage={noop}
          filename="file.ts"
        />,
      );
      const rows = container.querySelectorAll('[data-diff-line-row="true"]');
      expect(rows).toHaveLength(mode === 'split' ? 2 : 4);
      if (mode === 'split') {
        const column = side === 'old' ? 0 : 2;
        fireEvent.click(rows[0]!.children[column]!);
        fireEvent.click(rows[1]!.children[column]!, { shiftKey: true });
      } else {
        const index = side === 'old' ? 0 : 2;
        fireEvent.click(rows[index]!);
        fireEvent.click(rows[index + 1]!, { shiftKey: true });
      }
      expect(onLineClick).toHaveBeenCalledWith(
        0,
        0,
        side === 'old' ? 0 : 2,
        side === 'old' ? 'left' : 'right',
      );
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Exact snapshot' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() =>
        expect(onAddComment).toHaveBeenCalledWith(
          [10, 12],
          'Exact snapshot',
          side === 'old' ? 'before\n\t hidden  \nafter' : 'new before\n hidden\t\nnew after',
          side,
          { isQuestion: false, intent: 'comment' },
        ),
      );
    },
  );

  it.each([
    // Stopping on a row with no number on the drag's side leaves one line selected.
    ['new', 2, [1], [2], 31, 'added'],
    ['old', 1, [2], [1], 21, 'removed'],
    // Crossing such a row on the way to a numbered row selects the range on that side.
    ['new', 0, [1, 2, 3], [0, 2, 3], [30, 32], 'before\nadded\nafter'],
    ['old', 1, [2, 3], [1, 3], [21, 22], 'removed\nafter'],
  ] as const)(
    'keeps a unified %s-side drag from row %i to its own side',
    async (side, startRow, movedRows, selectedRows, line, code) => {
      const chunk: DiffChunkData = {
        header: '@@ -20,3 +30,3 @@',
        oldStart: 20,
        oldLines: 3,
        newStart: 30,
        newLines: 3,
        lines: [
          { type: 'normal', content: 'before', oldLineNumber: 20, newLineNumber: 30 },
          { type: 'delete', content: 'removed', oldLineNumber: 21 },
          { type: 'add', content: 'added', newLineNumber: 31 },
          { type: 'normal', content: 'after', oldLineNumber: 22, newLineNumber: 32 },
        ],
      };
      const onAddComment = vi.fn().mockResolvedValue(undefined);
      const { container } = renderWithProviders(
        <DiffChunk
          chunk={chunk}
          chunkIndex={0}
          threads={[]}
          mode="unified"
          onAddComment={onAddComment}
          onGenerateThreadPrompt={() => ''}
          onToggleThreadResolved={noop}
          onReplyToThread={asyncNoop}
          onRemoveMessage={noop}
          onUpdateMessage={noop}
          filename="file.ts"
        />,
      );
      const rows = [...container.querySelectorAll('[data-diff-line-row="true"]')];

      fireEvent.mouseEnter(rows[startRow]!);
      fireEvent.mouseDown(container.querySelector('[data-comment-button="true"]')!);
      for (const row of movedRows) {
        fireEvent.mouseMove(rows[row]!);
      }
      expect(
        rows.flatMap((row, index) => (row.classList.contains('drag-selected') ? [index] : [])),
      ).toEqual(selectedRows);

      fireEvent.mouseUp(document);
      fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Dragged' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() =>
        expect(onAddComment).toHaveBeenCalledWith(line, 'Dragged', code, side, {
          isQuestion: false,
          intent: 'comment',
        }),
      );
    },
  );

  it('opens a unified range comment with shift-click', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithProviders(
      <DiffChunk
        chunk={testChunk}
        chunkIndex={0}
        threads={[]}
        mode="unified"
        onAddComment={onAddComment}
        onGenerateThreadPrompt={() => ''}
        onToggleThreadResolved={noop}
        onReplyToThread={asyncNoop}
        onRemoveMessage={noop}
        onUpdateMessage={noop}
        filename="src/example.ts"
      />,
    );

    const rows = container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[2]!, { shiftKey: true });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Please revisit this range' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith(
        [10, 12],
        'Please revisit this range',
        ['const first = 1;', 'const second = 2;', 'const third = 3;'].join('\n'),
        'new',
        { isQuestion: false, intent: 'comment' },
      );
    });
  });

  it('opens a split-view range comment with shift-click on the same side', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithProviders(
      <SideBySideDiffChunk
        chunk={testChunk}
        chunkIndex={0}
        threads={[]}
        onAddComment={onAddComment}
        onGenerateThreadPrompt={() => ''}
        onToggleThreadResolved={noop}
        onReplyToThread={asyncNoop}
        onRemoveMessage={noop}
        onUpdateMessage={noop}
        filename="src/example.ts"
      />,
    );

    const rows = container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows[0]!.children[2]!);
    fireEvent.click(rows[2]!.children[2]!, { shiftKey: true });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Please revisit this range' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith(
        [10, 12],
        'Please revisit this range',
        ['const first = 1;', 'const second = 2;', 'const third = 3;'].join('\n'),
        'new',
        { isQuestion: false, intent: 'comment' },
      );
    });
  });

  it('falls back to a single-line comment when shift-click has no anchor', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithProviders(
      <DiffChunk
        chunk={testChunk}
        chunkIndex={0}
        threads={[]}
        mode={DEFAULT_DIFF_VIEW_MODE}
        onAddComment={onAddComment}
        onGenerateThreadPrompt={() => ''}
        onToggleThreadResolved={noop}
        onReplyToThread={asyncNoop}
        onRemoveMessage={noop}
        onUpdateMessage={noop}
        filename="src/example.ts"
      />,
    );

    const rows = container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows[2]!.children[2]!, { shiftKey: true });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Single line only' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith(12, 'Single line only', 'const third = 3;', 'new', {
        isQuestion: false,
        intent: 'comment',
      });
    });
  });

  it('keeps a unified range when shift-clicking the comment button', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithProviders(
      <DiffChunk
        chunk={testChunk}
        chunkIndex={0}
        threads={[]}
        mode="unified"
        onAddComment={onAddComment}
        onGenerateThreadPrompt={() => ''}
        onToggleThreadResolved={noop}
        onReplyToThread={asyncNoop}
        onRemoveMessage={noop}
        onUpdateMessage={noop}
        filename="src/example.ts"
      />,
    );

    const rows = container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows[0]!);
    fireEvent.mouseEnter(rows[2]!);
    const commentButton = screen.getByRole('button', { name: 'Add a comment' });
    fireEvent.mouseDown(commentButton, { shiftKey: true });
    fireEvent.click(commentButton, { shiftKey: true });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Please revisit this range' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith(
        [10, 12],
        'Please revisit this range',
        ['const first = 1;', 'const second = 2;', 'const third = 3;'].join('\n'),
        'new',
        { isQuestion: false, intent: 'comment' },
      );
    });
  });

  it('keeps a split-view range when shift-clicking the comment button', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithProviders(
      <SideBySideDiffChunk
        chunk={testChunk}
        chunkIndex={0}
        threads={[]}
        onAddComment={onAddComment}
        onGenerateThreadPrompt={() => ''}
        onToggleThreadResolved={noop}
        onReplyToThread={asyncNoop}
        onRemoveMessage={noop}
        onUpdateMessage={noop}
        filename="src/example.ts"
      />,
    );

    const rows = container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows[0]!.children[2]!);
    fireEvent.mouseEnter(rows[2]!.children[2]!);
    const commentButton = screen.getByRole('button', { name: 'Add a comment' });
    fireEvent.mouseDown(commentButton, { shiftKey: true });
    fireEvent.click(commentButton, { shiftKey: true });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Please revisit this range' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith(
        [10, 12],
        'Please revisit this range',
        ['const first = 1;', 'const second = 2;', 'const third = 3;'].join('\n'),
        'new',
        { isQuestion: false, intent: 'comment' },
      );
    });
  });
});

describe('DiffChunk comment drafts', () => {
  afterEach(() => sessionStorage.clear());

  const renderChunk = (mode: 'unified' | 'split', onAddComment = vi.fn(asyncNoop)) =>
    renderWithProviders(
      <CommentDraftScope value="review-a">
        <DiffChunk
          chunk={testChunk}
          chunkIndex={0}
          threads={[]}
          mode={mode}
          onAddComment={onAddComment}
          onGenerateThreadPrompt={() => ''}
          onToggleThreadResolved={noop}
          onReplyToThread={asyncNoop}
          onRemoveMessage={noop}
          onUpdateMessage={noop}
          filename="src/example.ts"
        />
      </CommentDraftScope>,
    );
  // A click sets the selection anchor; a shift-click on the same line opens a
  // single-line comment there.
  const clickLine = (container: HTMLElement, mode: 'unified' | 'split', index: number) => {
    const row = container.querySelectorAll('[data-diff-line-row="true"]')[index]!;
    const target = mode === 'split' ? row.children[2]! : row;
    fireEvent.click(target);
    fireEvent.click(target, { shiftKey: true });
  };

  it.each(['unified', 'split'] as const)(
    'reopens a %s line comment with its text after the page remounts',
    (mode) => {
      const first = renderChunk(mode);
      clickLine(first.container, mode, 2);
      fireEvent.click(screen.getByRole('radio', { name: 'Question' }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Half a thought' } });
      first.unmount();

      renderChunk(mode);
      expect(screen.getByRole('textbox')).toHaveValue('Half a thought');
      expect(screen.getByRole('radio', { name: 'Question' })).toBeChecked();
    },
  );

  it.each(['unified', 'split'] as const)(
    'keeps a %s draft open when another line in the chunk is opened',
    (mode) => {
      const { container } = renderChunk(mode);
      clickLine(container, mode, 0);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First draft' } });
      clickLine(container, mode, 2);
      const boxes = screen.getAllByRole('textbox');
      expect(boxes.map((box) => (box as HTMLTextAreaElement).value)).toEqual(['First draft', '']);
    },
  );

  it('forgets a line draft once it is sent', async () => {
    const onAddComment = vi.fn(asyncNoop);
    const first = renderChunk('unified', onAddComment);
    clickLine(first.container, 'unified', 2);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ship it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(onAddComment).toHaveBeenCalledWith(12, 'Ship it', 'const third = 3;', 'new', {
        isQuestion: false,
        intent: 'comment',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    first.unmount();
    renderChunk('unified', onAddComment);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('forgets a line draft on Cancel', () => {
    const first = renderChunk('unified');
    clickLine(first.container, 'unified', 2);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Never mind' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    first.unmount();
    renderChunk('unified');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  // Only Cancel or Send removes text; a stray Escape must not.
  it('keeps a line draft open on Escape when it holds text', () => {
    const first = renderChunk('unified');
    clickLine(first.container, 'unified', 2);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep me' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.getByRole('textbox')).toHaveValue('Keep me');
    first.unmount();
    renderChunk('unified');
    expect(screen.getByRole('textbox')).toHaveValue('Keep me');
  });

  it('closes an empty line form on Escape', () => {
    const { container } = renderChunk('unified');
    clickLine(container, 'unified', 2);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('DiffChunk drafts across reviews', () => {
  afterEach(() => sessionStorage.clear());

  const renderIn = (scope: string) =>
    renderWithProviders(
      <CommentDraftScope value={scope}>
        <DiffChunk
          chunk={testChunk}
          chunkIndex={0}
          threads={[]}
          mode="unified"
          onAddComment={vi.fn(asyncNoop)}
          onGenerateThreadPrompt={() => ''}
          onToggleThreadResolved={noop}
          onReplyToThread={asyncNoop}
          onRemoveMessage={noop}
          onUpdateMessage={noop}
          filename="src/example.ts"
        />
      </CommentDraftScope>,
    );

  it("shows each review's drafts only in that review", () => {
    const a = renderIn('review-a');
    const row = a.container.querySelectorAll('[data-diff-line-row="true"]')[2]!;
    fireEvent.click(row);
    fireEvent.click(row, { shiftKey: true });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'For review A' } });
    a.unmount();

    const b = renderIn('review-b');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    b.unmount();

    renderIn('review-a');
    expect(screen.getByRole('textbox')).toHaveValue('For review A');
  });

  it('keeps a restored or second-opened line form open after its text is cleared', () => {
    const openLine = (container: HTMLElement, index: number) => {
      const row = container.querySelectorAll('[data-diff-line-row="true"]')[index]!;
      fireEvent.click(row);
      fireEvent.click(row, { shiftKey: true });
    };
    const first = renderIn('review-a');
    openLine(first.container, 2);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Restored' } });
    first.unmount();

    const second = renderIn('review-a');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(screen.getByRole('textbox')).toBeInTheDocument();

    openLine(second.container, 0);
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  const chunkWith = (lines: DiffChunkData['lines']): DiffChunkData => ({
    header: '@@ @@',
    oldStart: lines[0]!.oldLineNumber ?? 1,
    oldLines: lines.length,
    newStart: lines[0]!.newLineNumber ?? 1,
    newLines: lines.length,
    lines,
  });
  const normal = (n: number) => ({
    type: 'normal' as const,
    content: `line ${n}`,
    oldLineNumber: n,
    newLineNumber: n,
  });
  const renderLines = (chunk: DiffChunkData, onAddComment = vi.fn(asyncNoop)) =>
    renderWithProviders(
      <CommentDraftScope value="review-a">
        <DiffChunk
          chunk={chunk}
          chunkIndex={0}
          threads={[]}
          mode="unified"
          onAddComment={onAddComment}
          onGenerateThreadPrompt={() => ''}
          onToggleThreadResolved={noop}
          onReplyToThread={asyncNoop}
          onRemoveMessage={noop}
          onUpdateMessage={noop}
          filename="src/example.ts"
        />
      </CommentDraftScope>,
    );

  it('sends the code a range draft was written on after its first lines leave the hunk', async () => {
    const expanded = chunkWith([7, 8, 9, 10, 11, 12].map(normal));
    const first = renderLines(expanded);
    const rows = first.container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[5]!, { shiftKey: true });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Whole range' } });
    first.unmount();

    const onAddComment = vi.fn(asyncNoop);
    renderLines(chunkWith([10, 11, 12].map(normal)), onAddComment);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(onAddComment).toHaveBeenCalledWith(
        [7, 12],
        'Whole range',
        ['line 7', 'line 8', 'line 9', 'line 10', 'line 11', 'line 12'].join('\n'),
        'new',
        { isQuestion: false, intent: 'comment' },
      ),
    );
  });

  it('highlights the lines of every open draft, restored ones included', () => {
    const chunk = chunkWith([10, 11, 12, 13].map(normal));
    const first = renderLines(chunk);
    const rows = () => first.container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows()[0]!);
    fireEvent.click(rows()[1]!, { shiftKey: true });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'On 10-11' } });
    first.unmount();

    const second = renderLines(chunk);
    const highlighted = [...second.container.querySelectorAll('[data-diff-line-row="true"]')].map(
      (row) => row.classList.contains('comment-selected'),
    );
    expect(highlighted).toEqual([true, true, false, false]);
  });

  it('shows an old-side draft on an unchanged line under that line in unified view', () => {
    const { result, unmount } = renderHook(
      () =>
        useCommentDraft({
          kind: 'line',
          filePath: 'src/example.ts',
          side: 'old',
          lineNumber: 11,
        }),
      {
        wrapper: ({ children }) => (
          <CommentDraftScope value="review-a">{children}</CommentDraftScope>
        ),
      },
    );
    act(() => result.current.setBody('From split view'));
    unmount();
    const { container } = renderWithProviders(
      <CommentDraftScope value="review-a">
        <DiffChunk
          chunk={testChunk}
          chunkIndex={0}
          threads={[]}
          mode="unified"
          onAddComment={vi.fn(asyncNoop)}
          onGenerateThreadPrompt={() => ''}
          onToggleThreadResolved={noop}
          onReplyToThread={asyncNoop}
          onRemoveMessage={noop}
          onUpdateMessage={noop}
          filename="src/example.ts"
        />
      </CommentDraftScope>,
    );
    expect(screen.getByRole('textbox')).toHaveValue('From split view');
    const highlighted = [...container.querySelectorAll('[data-diff-line-row="true"]')].map((row) =>
      row.classList.contains('comment-selected'),
    );
    expect(highlighted).toEqual([false, true, false]);
  });

  it('sends the code shown now when a later capture changed the line under a draft', async () => {
    const first = renderLines(chunkWith([10, 11, 12].map(normal)));
    const rows = first.container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows[2]!);
    fireEvent.click(rows[2]!, { shiftKey: true });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'About line 12' } });
    first.unmount();

    const onAddComment = vi.fn(asyncNoop);
    const changed = chunkWith([10, 11, 12].map(normal));
    changed.lines[2] = { ...changed.lines[2]!, content: 'line 12, edited' };
    renderLines(changed, onAddComment);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(onAddComment).toHaveBeenCalledWith(12, 'About line 12', 'line 12, edited', 'new', {
        isQuestion: false,
        intent: 'comment',
      }),
    );
  });
});
