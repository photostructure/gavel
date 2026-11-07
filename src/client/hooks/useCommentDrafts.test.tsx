import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CommentDraftScope,
  filesWithDrafts,
  useDraftAnchors,
  useDraftCount,
  useCommentDraft,
  useLineDraftAnchors,
  type LineDraftAnchor,
} from './useCommentDrafts';

const anchor = { kind: 'reply', threadId: 'thread-1' } as const;

function scoped(scope: string) {
  return ({ children }: { children: ReactNode }) => (
    <CommentDraftScope value={scope}>{children}</CommentDraftScope>
  );
}

afterEach(() => sessionStorage.clear());

describe('useCommentDraft', () => {
  it('keeps a draft in sessionStorage across a remount', () => {
    const first = renderHook(() => useCommentDraft(anchor), { wrapper: scoped('review-a') });
    act(() => first.result.current.setIntent('question'));
    act(() => first.result.current.setBody('Half a thought'));
    first.unmount();

    const second = renderHook(() => useCommentDraft(anchor), { wrapper: scoped('review-a') });
    expect(second.result.current.draft).toEqual({
      anchor,
      body: 'Half a thought',
      intent: 'question',
    });
  });

  it('keeps drafts of different reviews apart', () => {
    const a = renderHook(() => useCommentDraft(anchor), { wrapper: scoped('review-a') });
    act(() => a.result.current.setBody('For review A'));
    const b = renderHook(() => useCommentDraft(anchor), { wrapper: scoped('review-b') });
    expect(b.result.current.draft).toBeUndefined();
    expect(a.result.current.body).toBe('For review A');
  });

  it('keeps an emptied draft until it is cleared', () => {
    const { result } = renderHook(() => useCommentDraft(anchor), {
      wrapper: scoped('review-a'),
    });
    act(() => result.current.setBody('Draft'));
    act(() => result.current.setBody(''));
    expect(result.current.draft).toEqual({ anchor, body: '', intent: 'comment' });
    act(() => result.current.clear());
    expect(result.current.draft).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  it('applies functional updates to the current body', () => {
    const { result } = renderHook(() => useCommentDraft(anchor), {
      wrapper: scoped('review-a'),
    });
    act(() => result.current.setBody('Draft'));
    act(() => result.current.setBody((body) => `${body}, continued`));
    expect(result.current.body).toBe('Draft, continued');
  });

  it('lists the line-draft anchors of one file', () => {
    const line: LineDraftAnchor = {
      kind: 'line',
      filePath: 'a.ts',
      side: 'new',
      lineNumber: [3, 5],
    };
    const other = { kind: 'line', filePath: 'b.ts', side: 'old', lineNumber: 7 } as const;
    const { result } = renderHook(
      () => ({
        line: useCommentDraft(line),
        other: useCommentDraft(other),
        reply: useCommentDraft(anchor),
        list: useLineDraftAnchors('a.ts'),
      }),
      { wrapper: scoped('review-a') },
    );
    act(() => result.current.line.setBody('On a.ts'));
    act(() => result.current.other.setBody('On b.ts'));
    act(() => result.current.reply.setBody('A reply'));
    expect(result.current.list).toEqual([line]);
  });

  it('re-renders only the subscribers whose drafts changed', () => {
    const renders = { other: 0, sameFile: 0, otherFile: 0 };
    const line: LineDraftAnchor = { kind: 'line', filePath: 'a.ts', side: 'new', lineNumber: 3 };
    const { result } = renderHook(
      () => {
        const typed = useCommentDraft(line);
        return typed;
      },
      { wrapper: scoped('review-a') },
    );
    act(() => result.current.setBody('First'));
    renderHook(
      () => {
        renders.other += 1;
        return useCommentDraft(anchor);
      },
      { wrapper: scoped('review-a') },
    );
    renderHook(
      () => {
        renders.sameFile += 1;
        return useLineDraftAnchors('a.ts');
      },
      { wrapper: scoped('review-a') },
    );
    renderHook(
      () => {
        renders.otherFile += 1;
        return useLineDraftAnchors('b.ts');
      },
      { wrapper: scoped('review-a') },
    );
    const before = { ...renders };
    act(() => result.current.setBody('First, then more'));
    expect(renders).toEqual(before);
  });

  it('lists the files that hold a draft, through their threads for replies and edits', () => {
    const line: LineDraftAnchor = { kind: 'line', filePath: 'a.ts', side: 'new', lineNumber: 3 };
    const edit = { kind: 'edit', threadId: 'thread-2', messageId: 'm' } as const;
    const { result } = renderHook(
      () => ({
        line: useCommentDraft(line),
        reply: useCommentDraft(anchor),
        edit: useCommentDraft(edit),
      }),
      { wrapper: scoped('review-a') },
    );
    act(() => result.current.line.setBody('On a.ts'));
    act(() => result.current.reply.setBody('Reply on b.ts'));
    act(() => result.current.edit.setBody('Edit on an unloaded thread'));
    const fileOfThread = (threadId: string) => (threadId === 'thread-1' ? 'b.ts' : undefined);
    expect(filesWithDrafts('review-a', fileOfThread).sort()).toEqual(['a.ts', 'b.ts']);
    expect(filesWithDrafts('review-b', fileOfThread)).toEqual([]);
  });

  it('lists every draft anchor of a review and counts them by scope', () => {
    const line: LineDraftAnchor = {
      kind: 'line',
      filePath: 'a.ts',
      side: 'old',
      lineNumber: [3, 5],
    };
    const edit = { kind: 'edit', threadId: 'thread-2', messageId: 'm' } as const;
    const { result } = renderHook(
      () => ({
        line: useCommentDraft(line),
        reply: useCommentDraft(anchor),
        edit: useCommentDraft(edit),
        all: useDraftAnchors(),
        count: useDraftCount('review-a'),
        otherCount: useDraftCount('review-b'),
      }),
      { wrapper: scoped('review-a') },
    );
    act(() => result.current.line.setBody('On a.ts'));
    act(() => result.current.reply.setBody('A reply'));
    act(() => result.current.edit.setBody('An edit'));
    expect(result.current.all).toEqual([line, anchor, edit]);
    expect(result.current.count).toBe(3);
    expect(result.current.otherCount).toBe(0);
  });
});
