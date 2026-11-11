import { act, renderHook } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { DiffCommentThread } from '../../types/diff';
import type { NamedReviewMetadata } from '../../types/review';
import type { ReviewOp } from '../../types/reviewOps';
import { applyReviewOp } from '../../utils/reviewOps';
import { useDiffComments } from './useDiffComments';

const NO_THREADS: DiffCommentThread[] = [];

/** A server holding each review's threads, which applies each queued op at once. */
function useReview(scope: string, capture?: Pick<NamedReviewMetadata, 'version' | 'patchDigest'>) {
  const [reviews, setReviews] = useState<Record<string, DiffCommentThread[]>>({});
  const enqueue = useCallback(
    (op: ReviewOp) =>
      setReviews((current) => {
        const outcome = applyReviewOp(current[scope] ?? [], op, new Date().toISOString());
        return 'error' in outcome ? current : { ...current, [scope]: outcome.threads };
      }),
    [scope],
  );
  const replaceThreads = (threads: DiffCommentThread[]) =>
    setReviews((current) => ({ ...current, [scope]: threads }));
  return {
    ...useDiffComments(scope, reviews[scope] ?? NO_THREADS, enqueue, capture),
    replaceThreads,
  };
}

describe('comment context isolation', () => {
  it('retains thread anchors and stamps new roots as a named capture advances', () => {
    const { result, rerender } = renderHook(({ capture }) => useReview('review:task', capture), {
      initialProps: { capture: { version: 1, patchDigest: 'first' } },
    });
    act(() =>
      result.current.addThread({
        filePath: 'file.ts',
        side: 'new',
        line: 1,
        body: 'Original inline question',
      }),
    );
    rerender({ capture: { version: 2, patchDigest: 'second' } });
    expect(result.current.threads[0]?.capture).toEqual({ version: 1, patchDigest: 'first' });
    act(() => result.current.addReviewThread('New general question'));
    expect(result.current.threads[1]?.capture).toEqual({ version: 2, patchDigest: 'second' });
    expect(result.current.threads[0]?.messages[0]?.body).toBe('Original inline question');
  });
});

describe('comment deletion undo', () => {
  it('removes deleted content from live data and prompts, then restores it in place', () => {
    const { result } = renderHook(() => useReview('feature'));
    act(() => result.current.addReviewThread('Root question', { intent: 'question' }));
    const root = result.current.threads[0]!;
    act(() => result.current.replyToThread({ threadId: root.id, body: 'Delete this reply' }));
    const reply = result.current.threads[0]!.messages[1]!;
    act(() => result.current.removeMessage(root.id, reply.id));
    expect(result.current.threads[0]!.messages.map((message) => message.body)).toEqual([
      'Root question',
    ]);
    expect(result.current.generateAllCommentsPrompt()).not.toContain('Delete this reply');
    expect(result.current.deletedComments).toHaveLength(1);

    act(() => result.current.updateMessage(root.id, root.id, 'Edited root', 'change'));
    act(() => result.current.replyToThread({ threadId: root.id, body: 'New reply' }));
    act(() => result.current.restoreComment(root.id, reply.id));
    expect(result.current.threads[0]!.messages.map((message) => message.body)).toEqual([
      'Edited root',
      'Delete this reply',
      'New reply',
    ]);
    expect(result.current.threads[0]!.messages[1]!.id).toBe(reply.id);
    expect(result.current.deletedComments).toHaveLength(0);
  });

  it('keeps independent undo copies for adjacent threads and preserves their order', () => {
    const { result } = renderHook(() => useReview('feature'));
    for (const body of ['A', 'B', 'C']) act(() => result.current.addReviewThread(body));
    const [a, b] = result.current.threads;
    act(() => result.current.removeThread(a!.id));
    act(() => result.current.removeThread(b!.id));
    expect(result.current.threads.map((thread) => thread.messages[0]!.body)).toEqual(['C']);
    expect(result.current.generateAllCommentsPrompt()).not.toContain('A');
    act(() => result.current.addReviewThread('New thread'));
    act(() => result.current.restoreComment(a!.id));
    act(() => result.current.restoreComment(b!.id));
    expect(result.current.threads.map((thread) => thread.messages[0]!.body)).toEqual([
      'A',
      'B',
      'C',
      'New thread',
    ]);
    expect(result.current.threads[0]!.id).toBe(a!.id);
  });

  it('retains a deleted reply when deleting and restoring its entire thread', () => {
    const { result } = renderHook(() => useReview('feature'));
    act(() => result.current.addReviewThread('Root'));
    const id = result.current.threads[0]!.id;
    act(() => result.current.replyToThread({ threadId: id, body: 'Reply' }));
    const replyId = result.current.threads[0]!.messages[1]!.id;
    act(() => result.current.removeMessage(id, replyId));
    act(() => result.current.removeThread(id));
    expect(result.current.threads).toEqual([]);
    act(() => result.current.restoreComment(id));
    expect(result.current.threads[0]!.messages).toHaveLength(1);
    act(() => result.current.restoreComment(id, replyId));
    expect(result.current.threads[0]!.messages.map((message) => message.body)).toEqual([
      'Root',
      'Reply',
    ]);
  });

  it('keeps undo copies to the review they were made in', () => {
    const { result, rerender } = renderHook(({ scope }) => useReview(scope), {
      initialProps: { scope: 'A' },
    });
    act(() => result.current.addReviewThread('Only in A'));
    const id = result.current.threads[0]!.id;
    act(() => result.current.removeThread(id));
    rerender({ scope: 'B' });
    expect(result.current.deletedComments).toEqual([]);
    act(() => result.current.restoreComment(id));
    expect(result.current.threads).toEqual([]);
    act(() => result.current.addReviewThread('Only in B'));
    act(() => result.current.removeThread(result.current.threads[0]!.id));
    expect(result.current.deletedComments).toHaveLength(1);
    rerender({ scope: 'A' });
    expect(result.current.deletedComments).toHaveLength(1);
    act(() => result.current.restoreComment(id));
    expect(result.current.threads[0]!.messages[0]!.body).toBe('Only in A');
  });

  it('restores the latest deletion after the server sent the same thread again', () => {
    const { result } = renderHook(() => useReview('repeated-delete'));
    act(() => result.current.addReviewThread('First version'));
    const thread = result.current.threads[0]!;
    act(() => result.current.removeThread(thread.id));
    act(() =>
      result.current.replaceThreads([
        { ...thread, messages: [{ ...thread.messages[0]!, body: 'New version' }] },
      ]),
    );
    act(() => result.current.removeThread(thread.id));
    expect(result.current.deletedComments).toHaveLength(1);
    act(() => result.current.restoreComment(thread.id));
    expect(result.current.threads[0]!.messages[0]!.body).toBe('New version');
  });
});
