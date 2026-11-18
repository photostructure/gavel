import { renderHook, act } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';

import type { DiffCommentThread } from '../../types/diff';
import type { ReviewOp } from '../../types/reviewOps';
import { applyReviewOp } from '../../utils/reviewOps';
import { useDiffComments } from './useDiffComments';

vi.mock('../utils/diffUtils', () => ({
  getLanguageFromPath: vi.fn((path: string) => {
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
    if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
    return 'plaintext';
  }),
}));

/** The page's comments with each queued op applied at once, as the review-op queue shows them. */
function useComments(initial: DiffCommentThread[] = []) {
  const [threads, setThreads] = useState(initial);
  const [ops, setOps] = useState<ReviewOp[]>([]);
  const enqueue = useCallback((op: ReviewOp) => {
    setOps((current) => [...current, op]);
    setThreads((current) => {
      const outcome = applyReviewOp(current, op, new Date().toISOString());
      return 'error' in outcome ? current : outcome.threads;
    });
  }, []);
  return { ...useDiffComments('review', threads, enqueue), ops, replaceThreads: setThreads };
}

const importedFinding = (): DiffCommentThread => ({
  id: 'finding',
  filePath: 'a.ts',
  position: { side: 'new', line: 1 },
  createdAt: '2026-10-24T00:00:00Z',
  updatedAt: '2026-10-24T00:00:00Z',
  messages: [
    {
      id: 'finding',
      body: 'Review finding',
      author: 'Codex',
      origin: 'agent',
      createdAt: '2026-10-24T00:00:00Z',
      updatedAt: '2026-10-24T00:00:00Z',
      progress: { status: 'replied', cursor: 'stream:1', updatedAt: '2026-10-24T00:00:00Z' },
    },
  ],
});

describe('useDiffComments', () => {
  it('queues each comment change as a review op', () => {
    const { result } = renderHook(() => useComments());
    act(() => result.current.addReviewThread('Why?'));
    const threadId = result.current.threads[0]!.id;
    act(() => result.current.replyToThread({ threadId, body: 'Because.' }));
    const replyId = result.current.threads[0]!.messages[1]!.id;
    act(() => result.current.updateMessage(threadId, replyId, 'Because of this.'));
    act(() => result.current.toggleThreadResolved(threadId));
    act(() => result.current.removeMessage(threadId, replyId));
    act(() => result.current.removeThread(threadId));

    expect(result.current.ops.map(({ type }) => type)).toEqual([
      'thread.add',
      'message.add',
      'message.edit',
      'thread.resolve',
      'message.delete',
      'thread.delete',
    ]);
    expect(result.current.ops[3]).toMatchObject({ threadId, resolved: true });
    expect(result.current.threads).toEqual([]);
  });

  it('stores general comments without a file location and preserves resolved conversations', () => {
    const { result } = renderHook(() => useComments());
    act(() => result.current.addReviewThread('Why this approach?'));
    const thread = result.current.threads[0]!;
    expect(thread.scope).toBe('review');
    expect(thread).not.toHaveProperty('filePath');
    expect(thread).not.toHaveProperty('position');
    expect(result.current.generateThreadPrompt(thread.id)).toContain('Review conversation');
    act(() => result.current.toggleThreadResolved(thread.id));
    expect(result.current.threads[0]!.resolution?.resolved).toBe(true);
    expect(result.current.threads[0]!.messages).toEqual(thread.messages);
    act(() => result.current.toggleThreadResolved(thread.id));
    expect(result.current.threads[0]!.resolution?.resolved).toBe(false);
  });

  it('stamps new threads with the displayed capture', () => {
    const capture = { version: 3, patchDigest: 'a'.repeat(64) };
    const { result } = renderHook(() => {
      const [threads, setThreads] = useState<DiffCommentThread[]>([]);
      const enqueue = useCallback((op: ReviewOp) => {
        if (op.type === 'thread.add') setThreads((current) => [...current, op.thread]);
      }, []);
      return useDiffComments('review', threads, enqueue, capture);
    });

    act(() => void result.current.addThread({ filePath: 'a.ts', body: 'x', side: 'new', line: 1 }));
    act(() => result.current.addReviewThread('y'));

    expect(result.current.threads.map((thread) => thread.capture)).toEqual([capture, capture]);
  });

  it.each(['comment', 'change', 'question', undefined] as const)(
    'labels a question by its root intent %s, over a legacy flag, while preserving current progress',
    (intent) => {
      const { result } = renderHook(() => useComments());
      act(() => result.current.addReviewThread('Root'));
      const live = structuredClone(result.current.threads);
      const thread = live[0]!;
      thread.isQuestion = intent === 'question' ? undefined : true;
      const message = thread.messages[0]!;
      message.intent = intent;
      message.progress = {
        status: 'thinking',
        cursor: 'stream:1',
        updatedAt: '2026-10-24T00:00:00Z',
      };
      const expectedQuestion = intent === undefined || intent === 'question' ? true : undefined;

      act(() => result.current.replaceThreads(live));

      expect(result.current.threads[0]!.messages[0]).toEqual(message);
      expect(result.current.generateThreadPrompt(thread.id).includes('[QUESTION')).toBe(
        Boolean(expectedQuestion),
      );
    },
  );

  it('clears progress immediately when editing a message', () => {
    const { result } = renderHook(() => useComments([importedFinding()]));

    act(() => result.current.updateMessage('finding', 'finding', 'Different question'));

    expect(result.current.threads[0]!.messages[0]!.progress).toBeUndefined();
  });

  it('preserves a stored intent and origin when the body is edited', () => {
    const { result } = renderHook(() => useComments());
    act(() => result.current.addReviewThread('Why?'));
    const imported = structuredClone(result.current.threads);
    imported[0]!.isQuestion = true;
    imported[0]!.messages[0]!.intent = 'question';
    imported[0]!.messages[0]!.origin = 'agent';
    act(() => result.current.replaceThreads(imported));
    const thread = result.current.threads[0]!;
    const message = thread.messages[0]!;

    act(() => result.current.updateMessage(thread.id, message.id, 'Reworded question'));

    expect(result.current.threads[0]!.isQuestion).toBe(true);
    expect(result.current.threads[0]!.messages[0]).toMatchObject({
      body: 'Reworded question',
      intent: 'question',
      origin: 'agent',
    });
  });

  describe('generateThreadPrompt', () => {
    it('should format single line comment correctly', () => {
      const { result } = renderHook(() => useComments());

      let id = '';
      act(() => {
        id = result.current.addThread({
          filePath: 'src/client/components/CommentForm.tsx',
          body: 'コメント内容',
          side: 'new',
          line: 42,
        }).id;
      });

      expect(result.current.generateThreadPrompt(id))
        .toBe(`<review-thread location="src/client/components/CommentForm.tsx:L42">
<comment>
コメント内容
</comment>
</review-thread>`);
    });

    it('should format multi-line comment correctly', () => {
      const { result } = renderHook(() => useComments());

      let id = '';
      act(() => {
        id = result.current.addThread({
          filePath: 'src/client/components/CommentForm.tsx',
          body: '複数行',
          side: 'new',
          line: { start: 36, end: 39 },
        }).id;
      });

      expect(result.current.generateThreadPrompt(id))
        .toBe(`<review-thread location="src/client/components/CommentForm.tsx:L36-L39">
<comment>
複数行
</comment>
</review-thread>`);
    });

    it('should return empty string for non-existent comment', () => {
      const { result } = renderHook(() => useComments());

      expect(result.current.generateThreadPrompt('non-existent-id')).toBe('');
    });
  });

  describe('generateAllCommentsPrompt', () => {
    it('should return empty string when no comments', () => {
      const { result } = renderHook(() => useComments());

      expect(result.current.generateAllCommentsPrompt()).toBe('');
    });

    it('should format multiple comments with separator', () => {
      const { result } = renderHook(() => useComments());

      act(() => {
        result.current.addThread({
          filePath: 'src/client/components/CommentForm.tsx',
          body: '複数行',
          side: 'new',
          line: { start: 36, end: 39 },
        });
      });

      act(() => {
        result.current.addThread({
          filePath: 'src/client/components/CommentForm.tsx',
          body: 'コメント内容',
          side: 'new',
          line: 42,
        });
      });

      const prompt = result.current.generateAllCommentsPrompt({
        requestedBaseCommitish: 'main',
        requestedTargetCommitish: 'feature-branch',
        baseMode: 'merge-base',
        resolvedBaseCommitish: 'abc1234',
        resolvedTargetCommitish: 'def5678',
      });

      expect(prompt).toBe(`<review-threads diff="main...feature-branch (abc1234...def5678)">
<review-thread location="src/client/components/CommentForm.tsx:L36-L39">
<comment>
複数行
</comment>
</review-thread>
<review-thread location="src/client/components/CommentForm.tsx:L42">
<comment>
コメント内容
</comment>
</review-thread>
</review-threads>`);
    });

    it('should handle comments from different files', () => {
      const { result } = renderHook(() => useComments());

      act(() => {
        result.current.addThread({
          filePath: 'src/client/App.tsx',
          body: 'App comment',
          side: 'new',
          line: 10,
        });
      });

      act(() => {
        result.current.addThread({
          filePath: 'src/server/server.ts',
          body: 'Server comment',
          side: 'new',
          line: { start: 20, end: 25 },
        });
      });

      expect(result.current.generateAllCommentsPrompt()).toBe(`<review-threads>
<review-thread location="src/client/App.tsx:L10">
<comment>
App comment
</comment>
</review-thread>
<review-thread location="src/server/server.ts:L20-L25">
<comment>
Server comment
</comment>
</review-thread>
</review-threads>`);
    });

    it('should include ORIGINAL section for suggestion comments with code snapshot', () => {
      const { result } = renderHook(() => useComments());

      act(() => {
        result.current.addThread({
          filePath: 'src/client/components/Button.tsx',
          body: `Please apply this:\n\`\`\`suggestion
const next = true;
\`\`\``,
          side: 'new',
          line: 12,
          codeSnapshot: {
            content: 'const prev = false;',
            language: 'typescript',
          },
        });
      });

      const prompt = result.current.generateAllCommentsPrompt();

      expect(prompt).toContain('src/client/components/Button.tsx:L12');
      expect(prompt).toContain('ORIGINAL:');
      expect(prompt).toContain('const prev = false;');
      expect(prompt).toContain('SUGGESTED:');
      expect(prompt).toContain('const next = true;');
    });
  });

  describe('comment CRUD operations', () => {
    it('should add comment with code snapshot', () => {
      const { result } = renderHook(() => useComments());

      act(() => {
        result.current.addThread({
          filePath: 'src/utils/test.ts',
          body: 'Test comment',
          side: 'new',
          line: 15,
          codeSnapshot: {
            content: 'const x = 42;',
            language: 'typescript',
          },
        });
      });

      expect(result.current.threads).toEqual([
        expect.objectContaining({
          filePath: 'src/utils/test.ts',
          position: { side: 'new', line: 15 },
          codeSnapshot: { content: 'const x = 42;', language: 'typescript' },
          messages: [expect.objectContaining({ body: 'Test comment', author: 'User' })],
        }),
      ]);
    });

    it('should update comment body', async () => {
      const { result } = renderHook(() => useComments());

      let commentId = '';
      act(() => {
        commentId = result.current.addThread({
          filePath: 'test.ts',
          body: 'Original comment',
          side: 'new',
          line: 1,
        }).id;
      });

      // Wait a bit to ensure updatedAt timestamp is different
      await new Promise((resolve) => setTimeout(resolve, 10));

      act(() => {
        result.current.updateMessage(commentId, commentId, 'Updated comment');
      });

      const message = result.current.threads[0]!.messages[0]!;
      expect(message.body).toBe('Updated comment');
      expect(message.updatedAt).not.toBe(message.createdAt);
    });

    it('should clear all comments', () => {
      const { result } = renderHook(() => useComments());

      act(() => {
        result.current.addThread({ filePath: 'test1.ts', body: 'Comment 1', side: 'new', line: 1 });
      });
      act(() => {
        result.current.addThread({ filePath: 'test2.ts', body: 'Comment 2', side: 'new', line: 2 });
      });

      act(() => {
        result.current.clearAllComments();
      });

      expect(result.current.threads).toHaveLength(0);
      expect(result.current.deletedComments).toEqual([]);
    });

    it('should not remove a thread when reply deletion targets a missing message id', () => {
      const { result } = renderHook(() => useComments());

      let threadId = '';
      act(() => {
        threadId = result.current.addThread({
          filePath: 'test.ts',
          body: 'Root comment',
          side: 'new',
          line: 1,
        }).id;
      });

      act(() => {
        result.current.replyToThread({
          threadId,
          body: 'Reply comment',
        });
      });

      act(() => {
        result.current.removeMessage(threadId, 'missing-message-id');
      });

      expect(result.current.threads).toHaveLength(1);
      expect(result.current.threads[0]?.id).toBe(threadId);
      expect(result.current.threads[0]?.messages).toHaveLength(2);
      expect(result.current.threads[0]?.messages[1]?.body).toBe('Reply comment');
    });
  });
});
