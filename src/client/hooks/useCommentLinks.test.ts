import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommentThread, DiffSelection } from '../../types/diff';

import { writeReviewLocation } from '../utils/reviewNavigation';

import { useCommentLinks } from './useCommentLinks';

const thread = (id: string, extra: Partial<CommentThread> = {}): CommentThread =>
  ({
    id,
    file: 'src/a.ts',
    line: 4,
    side: 'new',
    createdAt: '',
    updatedAt: '',
    messages: [],
    ...extra,
  }) as CommentThread;

const current: DiffSelection = { baseCommitish: 'base', targetCommitish: '.', reviewName: 'here' };
const other: DiffSelection = { baseCommitish: 'base', targetCommitish: '.', reviewName: 'there' };

function setup(overrides: { threads?: CommentThread[]; jumps?: boolean } = {}) {
  const calls = {
    // As the App's openReviewFromTab does.
    switchReview: vi.fn((selection: DiffSelection) =>
      writeReviewLocation({ ...selection, retained: true }, 'push'),
    ),
    canShowLine: vi.fn(() => overrides.jumps ?? true),
    jumpToLine: vi.fn(),
    jumpToThread: vi.fn(),
    openFile: vi.fn<(filePath: string) => void>(),
    focusInConversation: vi.fn<(threadId: string) => void>(),
  };
  const props = {
    ready: true,
    currentSelection: current,
    reviews: [{ selection: current }, { selection: other }],
    threads: overrides.threads ?? [thread('t1'), thread('t2', { line: [7, 9] })],
    filePaths: ['src/a.ts'],
    ...calls,
  };
  const hook = renderHook((p: typeof props) => useCommentLinks(p), { initialProps: props });
  return { ...hook, calls, props };
}

describe('useCommentLinks', () => {
  beforeEach(() => window.history.replaceState(null, '', '/?review=here#gavel-editor-token=k'));
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('jumps to a thread and records both ends in history, keeping the editor token', () => {
    const { result, calls } = setup();
    const before = window.history.length;
    act(() => result.current.follow('#thread=t2', { threadId: 't1' }));
    // One jump for the line and its comment card, so the view scrolls once, to the card.
    expect(calls.jumpToThread).toHaveBeenCalledWith(
      { kind: 'line', filePath: 'src/a.ts', side: 'new', lineNumber: [7, 9] },
      't2',
    );
    expect(calls.jumpToLine).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#gavel-editor-token=k&thread=t2');
    expect(window.history.length).toBe(before + 1);
  });

  it('marks the entry it leaves with the thread the link was in', async () => {
    const { result, calls } = setup();
    act(() => result.current.follow('#thread=t2', { threadId: 't1' }));
    calls.jumpToThread.mockClear();
    await act(async () => {
      const popped = new Promise((resolve) =>
        window.addEventListener('popstate', resolve, { once: true }),
      );
      window.history.back();
      await popped;
    });
    expect(window.location.hash).toBe('#gavel-editor-token=k&thread=t1');
    expect(calls.jumpToThread).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'src/a.ts', lineNumber: 4 }),
      't1',
    );
  });

  it('opens review-wide threads, and threads whose line cannot be shown, in Conversation', () => {
    const { result, calls } = setup({
      threads: [
        thread('general', { scope: 'review', file: undefined, line: undefined }),
        thread('t1'),
      ],
      jumps: false,
    });
    act(() => result.current.follow('#thread=general'));
    act(() => result.current.follow('#thread=t1'));
    expect(calls.focusInConversation.mock.calls).toEqual([['general'], ['t1']]);
    expect(result.current.notice).toBeNull();
  });

  it('opens a file, or jumps to a line in it', () => {
    const { result, calls } = setup();
    act(() => result.current.follow('#file=src/a.ts'));
    expect(calls.openFile).toHaveBeenCalledWith('src/a.ts');
    expect(calls.jumpToThread).not.toHaveBeenCalled();
    act(() => result.current.follow('#file=src/a.ts&line=40-52&side=old'));
    expect(calls.jumpToLine).toHaveBeenCalledWith({
      kind: 'line',
      filePath: 'src/a.ts',
      side: 'old',
      lineNumber: [40, 52],
    });
  });

  it.each([
    ['#thread=t9', 'No comment "t9" in this review.'],
    ['#file=src/b.ts', '"src/b.ts" is not in this review.'],
    ['?review=nope#thread=t1', 'No review named "nope".'],
    [
      '#file=src/a.ts&side=left',
      `Can't follow this link: its side, "left", is neither old nor new.`,
    ],
  ])('reports %s without touching history', (href, notice) => {
    const { result, calls } = setup();
    const before = window.location.href;
    act(() => result.current.follow(href, { threadId: 't1' }));
    expect(result.current.notice).toBe(notice);
    expect(window.location.href).toBe(before);
    expect(calls.switchReview).not.toHaveBeenCalled();
    act(() => result.current.dismissNotice());
    expect(result.current.notice).toBeNull();
  });

  it('reports a line that the diff cannot show, without touching history', () => {
    const { result, calls } = setup({ jumps: false });
    const before = window.location.href;
    act(() => result.current.follow('#file=src/a.ts&line=40-52', { threadId: 't1' }));
    expect(window.location.href).toBe(before);
    expect(calls.jumpToLine).not.toHaveBeenCalled();
    expect(result.current.notice).toBe('Lines 40-52 of "src/a.ts" are not in this diff.');
    act(() => result.current.follow('#file=src/a.ts&line=40'));
    expect(result.current.notice).toBe('Line 40 of "src/a.ts" is not in this diff.');
  });

  it('switches review, then jumps once that review has loaded', () => {
    const { result, calls, rerender, props } = setup();
    const before = window.history.length;
    act(() => result.current.follow('?review=there#thread=t5', { threadId: 't1' }));
    expect(calls.switchReview).toHaveBeenCalledWith(other);
    expect(window.location.search).toBe('?review=there');
    expect(window.location.hash).toBe('#gavel-editor-token=k&thread=t5');
    // The switch adds the link's one entry.
    expect(window.history.length).toBe(before + 1);
    // The App shows the new review's comments only after loading them.
    rerender({ ...props, ready: false });
    expect(calls.jumpToThread).not.toHaveBeenCalled();
    rerender({ ...props, ready: true, currentSelection: other, threads: [thread('t5')] });
    expect(calls.jumpToThread).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumber: 4 }),
      't5',
    );
  });

  it('returns on Back from another review to the thread the link was in', async () => {
    const { result } = setup();
    act(() => result.current.follow('?review=there#thread=t5', { threadId: 't1' }));
    await act(async () => {
      const popped = new Promise((resolve) =>
        window.addEventListener('popstate', resolve, { once: true }),
      );
      window.history.back();
      await popped;
    });
    expect(window.location.search).toBe('?review=here');
    expect(window.location.hash).toBe('#gavel-editor-token=k&thread=t1');
  });

  it('resolves a relative link in another review against that review', () => {
    const { result, calls } = setup();
    act(() => result.current.follow('#thread=t5', { threadId: 't4', review: other }));
    expect(calls.switchReview).toHaveBeenCalledWith(other);
  });

  it('follows no relative link written in a deleted review, and says why', () => {
    const { result, calls } = setup();
    act(() =>
      result.current.follow('#thread=t5', { threadId: 't4', review: other, deleted: true }),
    );
    expect(calls.switchReview).not.toHaveBeenCalled();
    expect(calls.jumpToThread).not.toHaveBeenCalled();
    expect(result.current.notice).toMatch(/deleted/);
    expect(window.location.search).toBe('?review=here');
  });

  it('follows the page URL on load and on Back or Forward', async () => {
    window.history.replaceState(null, '', '/?review=here#thread=t2');
    const { calls } = setup();
    expect(calls.jumpToThread).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumber: [7, 9] }),
      't2',
    );
    await act(async () => {
      window.history.pushState(null, '', '#thread=t1');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(calls.jumpToThread).toHaveBeenLastCalledWith(
      expect.objectContaining({ lineNumber: 4 }),
      't1',
    );
  });

  it('adds no history entry for a link to the place already shown', () => {
    const { result } = setup();
    act(() => result.current.follow('#thread=t2', { threadId: 't1' }));
    const length = window.history.length;
    act(() => result.current.follow('#thread=t2', { threadId: 't2' }));
    // The same link clicked again in t1, which is still on screen beside t2.
    act(() => result.current.follow('#thread=t2', { threadId: 't1' }));
    expect(window.history.length).toBe(length);
    expect(window.location.hash).toBe('#gavel-editor-token=k&thread=t2');
  });

  it('clears an earlier notice when a later link works', () => {
    const { result } = setup();
    act(() => result.current.follow('#thread=t9'));
    act(() => result.current.follow('#thread=t1'));
    expect(result.current.notice).toBeNull();
  });
});
