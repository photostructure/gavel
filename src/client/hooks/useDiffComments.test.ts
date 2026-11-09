import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { DiffContextStorage } from '../../types/diff';
import { Conversation } from '../../server/conversation';
import type { ConversationStreamEvent } from '../../types/conversation';
import { useDiffComments } from './useDiffComments';

// Mock StorageService
let mockDiffContextData: DiffContextStorage | null = null;
vi.mock('../services/StorageService', () => ({
  storageService: {
    getCommentThreads: vi.fn(() => mockDiffContextData?.threads || []),
    saveCommentThreads: vi.fn(
      (baseCommitish: string, targetCommitish: string, threads: DiffContextStorage['threads']) => {
        const now = new Date().toISOString();
        mockDiffContextData = {
          ...mockDiffContextData,
          version: 2,
          baseCommitish,
          targetCommitish,
          createdAt: mockDiffContextData?.createdAt ?? now,
          lastModifiedAt: now,
          threads,
          viewedFiles: mockDiffContextData?.viewedFiles ?? [],
          appliedCommentImportIds: mockDiffContextData?.appliedCommentImportIds ?? [],
        };
      },
    ),
    getComments: vi.fn(() => []),
    saveComments: vi.fn(),
    getDiffContextData: vi.fn(() => mockDiffContextData),
    saveDiffContextData: vi.fn(
      (baseCommitish: string, targetCommitish: string, data: DiffContextStorage) => {
        mockDiffContextData = {
          ...data,
          baseCommitish,
          targetCommitish,
        };
      },
    ),
  },
}));

// Mock diffUtils
vi.mock('../utils/diffUtils', () => ({
  getLanguageFromPath: vi.fn((path: string) => {
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
    if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
    return 'plaintext';
  }),
}));

describe('useDiffComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiffContextData = null;
  });

  it('stores general questions without a file location and preserves resolved conversations', () => {
    const { result } = renderHook(() => useDiffComments('main', 'feature', 'abc123'));
    act(() => result.current.addReviewThread('Why this approach?', { intent: 'question' }));
    const thread = result.current.threads[0]!;
    expect(thread.scope).toBe('review');
    expect(thread).not.toHaveProperty('filePath');
    expect(thread).not.toHaveProperty('position');
    expect(thread.messages[0]!.intent).toBe('question');
    expect(result.current.generateThreadPrompt(thread.id)).toContain('Review conversation');
    act(() => result.current.toggleThreadResolved(thread.id));
    expect(result.current.threads[0]!.resolution?.resolved).toBe(true);
    expect(result.current.threads[0]!.messages).toEqual(thread.messages);
    act(() => result.current.toggleThreadResolved(thread.id));
    expect(result.current.threads[0]!.resolution?.resolved).toBe(false);
    expect(mockDiffContextData!.threads[0]!.messages).toEqual(thread.messages);
  });

  it('keeps live progress in memory but never persists or restores it', () => {
    const { result, unmount } = renderHook(() => useDiffComments('main', 'feature', 'abc123'));
    act(() => {
      result.current.addComment({ filePath: 'a.ts', body: 'Why?', side: 'new', line: 1 });
    });
    const live = structuredClone(result.current.threads);
    live[0]!.messages[0]!.progress = {
      status: 'thinking',
      cursor: 'stream:1',
      updatedAt: '2026-10-24T00:00:00Z',
    };
    act(() => result.current.replaceThreads(live));
    expect(result.current.threads[0]!.messages[0]!.progress?.status).toBe('thinking');
    expect(mockDiffContextData!.threads[0]!.messages[0]!.progress).toBeUndefined();
    // Earlier builds of this feature wrote progress to the live review's browser storage.
    mockDiffContextData!.threads = structuredClone(live);
    unmount();
    const reopened = renderHook(() => useDiffComments('main', 'feature', 'abc123'));
    expect(reopened.result.current.threads[0]!.messages[0]!.progress).toBeUndefined();
    expect(reopened.result.current.threads[0]!.messages[0]!.body).toBe('Why?');
  });

  it.each(['comment', 'change', 'question', undefined] as const)(
    'restores and persists question flags from root intent %s with a legacy fallback',
    (intent) => {
      const { result, unmount } = renderHook(() => useDiffComments('main', 'feature', 'abc123'));
      act(() => result.current.addReviewThread('Root'));
      const stored = mockDiffContextData!.threads[0]!;
      stored.isQuestion = intent === 'question' ? undefined : true;
      stored.messages[0]!.intent = intent;
      const originalMessage = structuredClone(stored.messages[0]!);
      const expectedQuestion = intent === undefined || intent === 'question' ? true : undefined;
      unmount();

      const reopened = renderHook(() => useDiffComments('main', 'feature', 'abc123'));

      expect(reopened.result.current.threads[0]!.isQuestion).toBe(expectedQuestion);
      expect(mockDiffContextData!.threads[0]!.isQuestion).toBe(expectedQuestion);
      expect(reopened.result.current.threads[0]!.messages[0]).toEqual(originalMessage);
      expect(reopened.result.current.generateThreadPrompt(stored.id).includes('[QUESTION')).toBe(
        Boolean(expectedQuestion),
      );
    },
  );

  it.each(['comment', 'change', 'question', undefined] as const)(
    'aligns live question flags with root intent %s while preserving current progress',
    (intent) => {
      const { result } = renderHook(() => useDiffComments('main', 'feature', 'abc123'));
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

      expect(result.current.threads[0]!.isQuestion).toBe(expectedQuestion);
      expect(mockDiffContextData!.threads[0]!.isQuestion).toBe(expectedQuestion);
      expect(result.current.threads[0]!.messages[0]).toEqual(message);
      expect(mockDiffContextData!.threads[0]!.messages[0]!.progress).toBeUndefined();
      expect(result.current.generateThreadPrompt(thread.id).includes('[QUESTION')).toBe(
        Boolean(expectedQuestion),
      );
    },
  );

  it('clears progress immediately when editing a message', () => {
    const { result } = renderHook(() => useDiffComments('main', 'feature', 'abc123'));
    act(() => {
      result.current.addComment({ filePath: 'a.ts', body: 'Why?', side: 'new', line: 1 });
    });
    const live = structuredClone(result.current.threads);
    const thread = live[0]!;
    const message = thread.messages[0]!;
    message.progress = {
      status: 'replied',
      cursor: 'stream:1',
      updatedAt: '2026-10-24T00:00:00Z',
    };
    act(() => result.current.replaceThreads(live));
    act(() => result.current.updateMessage(thread.id, message.id, 'Different question'));
    expect(result.current.threads[0]!.messages[0]!.progress).toBeUndefined();
    expect(mockDiffContextData!.threads[0]!.messages[0]!.progress).toBeUndefined();
  });

  it('delivers an intent-only edit on an imported finding as a user revision', () => {
    const { result } = renderHook(() => useDiffComments('main', 'feature', 'abc123'));
    act(() => {
      result.current.applyCommentImports(
        [
          {
            type: 'thread',
            id: 'finding',
            filePath: 'a.ts',
            position: { side: 'new', line: 1 },
            body: 'Review finding',
            author: 'Codex',
          },
        ],
        'review-findings',
      );
    });
    const importedThreads = structuredClone(result.current.threads);
    const message = importedThreads[0]!.messages[0]!;
    message.updatedAt = '2026-10-24T00:00:00Z';
    message.progress = {
      status: 'replied',
      cursor: 'stream:1',
      updatedAt: message.updatedAt,
    };
    act(() => result.current.replaceThreads(importedThreads));
    const selection = { baseCommitish: 'main', targetCommitish: 'feature' };
    const events: ConversationStreamEvent[] = [];
    const journal = new Conversation((event) => events.push(event));
    journal.update(selection, [], importedThreads, 'agent');
    events.length = 0;

    act(() => result.current.updateMessage('finding', message.id, message.body, 'question'));
    journal.update(selection, importedThreads, result.current.threads, 'user');

    const edited = result.current.threads[0]!.messages[0]!;
    expect(edited).toMatchObject({ body: message.body, intent: 'question', origin: 'user' });
    expect(edited.updatedAt).not.toBe(message.updatedAt);
    expect(edited.progress).toBeUndefined();
    expect(result.current.threads[0]!.isQuestion).toBe(true);
    expect(mockDiffContextData!.threads[0]!.messages[0]).toEqual(edited);
    expect(events).toEqual([
      expect.objectContaining({ type: 'comment.updated', origin: 'user', intent: 'question' }),
    ]);
    expect(journal.snapshot().reviews[0]!.threads[0]!.messages[0]!.progress?.status).toBe('queued');
  });

  it.each(['comment', 'change'] as const)(
    'clears a legacy root question marker when its intent is explicitly changed to %s',
    (intent) => {
      const { result } = renderHook(() => useDiffComments('main', 'feature', 'abc123'));
      act(() => result.current.addReviewThread('Why?', { isQuestion: true }));
      const legacy = structuredClone(result.current.threads);
      delete legacy[0]!.messages[0]!.intent;
      act(() => result.current.replaceThreads(legacy));
      const thread = result.current.threads[0]!;
      const message = thread.messages[0]!;

      act(() => result.current.updateMessage(thread.id, message.id, message.body, intent));

      expect(result.current.threads[0]!.isQuestion).toBeUndefined();
      expect(mockDiffContextData!.threads[0]!.isQuestion).toBeUndefined();
      expect(result.current.threads[0]!.messages[0]).toMatchObject({ intent, origin: 'user' });
      expect(result.current.generateThreadPrompt(thread.id)).not.toContain('[QUESTION');
    },
  );

  it.each([
    { rootIntent: 'question', replyIntent: 'comment' },
    { rootIntent: 'comment', replyIntent: 'question' },
  ] as const)('keeps the root $rootIntent intent when a reply becomes $replyIntent', (intents) => {
    const { result } = renderHook(() => useDiffComments('main', 'feature', 'abc123'));
    act(() => result.current.addReviewThread('Root', { intent: intents.rootIntent }));
    const threadId = result.current.threads[0]!.id;
    act(() => result.current.replyToThread({ threadId, body: 'Reply' }));
    const thread = result.current.threads[0]!;
    const reply = thread.messages[1]!;

    act(() => result.current.updateMessage(threadId, reply.id, reply.body, intents.replyIntent));

    expect(result.current.threads[0]!.isQuestion).toBe(thread.isQuestion);
    expect(result.current.threads[0]!.messages[0]).toEqual(thread.messages[0]);
    expect(result.current.threads[0]!.messages[1]).toMatchObject({
      body: reply.body,
      intent: intents.replyIntent,
      origin: 'user',
    });
  });

  it('preserves existing intent and origin when a body edit omits intent', () => {
    const { result } = renderHook(() => useDiffComments('main', 'feature', 'abc123'));
    act(() => result.current.addReviewThread('Why?', { intent: 'question' }));
    const imported = structuredClone(result.current.threads);
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

  it.each(['review', 'line'] as const)(
    'uses explicit intent before the legacy question flag for new %s threads',
    (scope) => {
      const { result } = renderHook(() => useDiffComments('main', 'feature', 'abc123'));
      const cases = [
        { intent: 'comment', isQuestion: true, expected: undefined },
        { intent: 'change', isQuestion: true, expected: undefined },
        { intent: 'question', isQuestion: false, expected: true },
        { isQuestion: true, expected: true },
      ] as const;
      for (const { expected, ...options } of cases) {
        act(() => {
          if (scope === 'review') result.current.addReviewThread('Body', options);
          else
            result.current.addThread({
              filePath: 'a.ts',
              side: 'new',
              line: 1,
              body: 'Body',
              ...options,
            });
        });
        const thread = result.current.threads.at(-1)!;
        expect(thread.isQuestion).toBe(expected);
        expect(thread.messages[0]!.intent).toBe('intent' in options ? options.intent : 'question');
      }
    },
  );

  it('delivers a question toggle on an imported finding as a user revision', () => {
    const { result } = renderHook(() => useDiffComments('main', 'feature', 'abc123'));
    act(() => {
      result.current.applyCommentImports(
        [
          {
            type: 'thread',
            id: 'finding',
            filePath: 'a.ts',
            position: { side: 'new', line: 1 },
            body: 'Review finding',
            author: 'Codex',
          },
        ],
        'review-findings',
      );
    });
    const importedThreads = result.current.threads;
    expect(importedThreads[0]!.messages[0]!.origin).toBe('agent');
    const selection = { baseCommitish: 'main', targetCommitish: 'feature' };
    const events: ConversationStreamEvent[] = [];
    const journal = new Conversation((event) => events.push(event));
    journal.update(selection, [], importedThreads, 'agent');
    events.length = 0;

    act(() => result.current.setThreadQuestion('finding', true));
    journal.update(selection, importedThreads, result.current.threads, 'user');

    expect(events).toEqual([
      expect.objectContaining({ type: 'comment.updated', origin: 'user', intent: 'question' }),
    ]);
    expect(journal.snapshot().reviews[0]!.threads[0]!.messages[0]!.progress?.status).toBe('queued');
  });

  it.each(['review', 'line'] as const)(
    'persists %s question labels through replies, reloads and toggles',
    (scope) => {
      const { result, unmount } = renderHook(() => useDiffComments('main', 'questions', 'abc123'));
      act(() => {
        if (scope === 'review') result.current.addReviewThread('Why?', { isQuestion: true });
        else
          result.current.addThread({
            filePath: 'src/a.ts',
            side: 'new',
            line: 3,
            body: 'Why?',
            isQuestion: true,
          });
      });
      const id = result.current.threads[0]!.id;
      act(() => result.current.replyToThread({ threadId: id, body: 'Here is why.' }));
      expect(result.current.generateThreadPrompt(id)).toContain(
        "[QUESTION — answer, don't change code]",
      );
      expect(result.current.generateAllCommentsPrompt()).toContain(
        "[QUESTION — answer, don't change code]",
      );
      unmount();
      const reopened = renderHook(() => useDiffComments('main', 'questions', 'abc123'));
      expect(reopened.result.current.threads[0]).toMatchObject({
        isQuestion: true,
        messages: [{ body: 'Why?' }, { body: 'Here is why.' }],
      });
      act(() => reopened.result.current.setThreadQuestion(id, false));
      expect(reopened.result.current.generateThreadPrompt(id)).not.toContain('[QUESTION');
      expect(mockDiffContextData!.threads[0]!.isQuestion).toBeFalsy();
      act(() => reopened.result.current.setThreadQuestion(id, true));
      expect(reopened.result.current.generateThreadPrompt(id)).toContain('[QUESTION');
    },
  );

  describe('generatePrompt', () => {
    it('should format single line comment correctly', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      act(() => {
        result.current.addComment({
          filePath: 'src/client/components/CommentForm.tsx',
          body: 'コメント内容',
          side: 'new',
          line: 42,
        });
      });

      const comment = result.current.comments[0];
      expect(comment).toBeDefined();
      const prompt = result.current.generatePrompt(comment!.id);

      expect(prompt).toBe(`<review-thread location="src/client/components/CommentForm.tsx:L42">
<comment>
コメント内容
</comment>
</review-thread>`);
    });

    it('should format multi-line comment correctly', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      act(() => {
        result.current.addComment({
          filePath: 'src/client/components/CommentForm.tsx',
          body: '複数行',
          side: 'new',
          line: { start: 36, end: 39 },
        });
      });

      const comment = result.current.comments[0];
      expect(comment).toBeDefined();
      const prompt = result.current.generatePrompt(comment!.id);

      expect(prompt).toBe(`<review-thread location="src/client/components/CommentForm.tsx:L36-L39">
<comment>
複数行
</comment>
</review-thread>`);
    });

    it('should return empty string for non-existent comment', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      const prompt = result.current.generatePrompt('non-existent-id');
      expect(prompt).toBe('');
    });
  });

  describe('generateAllCommentsPrompt', () => {
    it('should return empty string when no comments', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      const prompt = result.current.generateAllCommentsPrompt();
      expect(prompt).toBe('');
    });

    it('should format multiple comments with separator', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      act(() => {
        result.current.addComment({
          filePath: 'src/client/components/CommentForm.tsx',
          body: '複数行',
          side: 'new',
          line: { start: 36, end: 39 },
        });
      });

      act(() => {
        result.current.addComment({
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

      // Check if comments are in the correct order
      expect(result.current.comments).toHaveLength(2);
      expect(result.current.comments[0]?.position.line).toEqual({ start: 36, end: 39 });
      expect(result.current.comments[1]?.position.line).toBe(42);

      const expected = `<review-threads diff="main...feature-branch (abc1234...def5678)">
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
</review-threads>`;

      expect(prompt).toBe(expected);
    });

    it('should handle comments from different files', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      act(() => {
        result.current.addComment({
          filePath: 'src/client/App.tsx',
          body: 'App comment',
          side: 'new',
          line: 10,
        });
      });

      act(() => {
        result.current.addComment({
          filePath: 'src/server/server.ts',
          body: 'Server comment',
          side: 'new',
          line: { start: 20, end: 25 },
        });
      });

      const prompt = result.current.generateAllCommentsPrompt();

      // Check if comments are in the correct order
      expect(result.current.comments).toHaveLength(2);
      expect(result.current.comments[0]?.filePath).toBe('src/client/App.tsx');
      expect(result.current.comments[1]?.filePath).toBe('src/server/server.ts');

      const expected = `<review-threads>
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
</review-threads>`;

      expect(prompt).toBe(expected);
    });

    it('should include ORIGINAL section for suggestion comments with code snapshot', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      act(() => {
        result.current.addComment({
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
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      act(() => {
        result.current.addComment({
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

      expect(result.current.comments).toHaveLength(1);
      const comment = result.current.comments[0];
      expect(comment).toBeDefined();
      expect(comment!.filePath).toBe('src/utils/test.ts');
      expect(comment!.body).toBe('Test comment');
      expect(comment!.author).toBe('User');
      expect(comment!.position.side).toBe('new');
      expect(comment!.position.line).toBe(15);
      expect(comment!.codeSnapshot?.content).toBe('const x = 42;');
      expect(comment!.codeSnapshot?.language).toBe('typescript');
    });

    it('should remove comment by id', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      let commentId: string;
      act(() => {
        const comment = result.current.addComment({
          filePath: 'test.ts',
          body: 'To be removed',
          side: 'new',
          line: 1,
        });
        commentId = comment.id;
      });

      expect(result.current.comments).toHaveLength(1);

      act(() => {
        result.current.removeComment(commentId);
      });

      expect(result.current.comments).toHaveLength(0);
    });

    it('should update comment body', async () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      let commentId: string;
      act(() => {
        const comment = result.current.addComment({
          filePath: 'test.ts',
          body: 'Original comment',
          side: 'new',
          line: 1,
        });
        commentId = comment.id;
      });

      // Wait a bit to ensure updatedAt timestamp is different
      await new Promise((resolve) => setTimeout(resolve, 10));

      act(() => {
        result.current.updateComment(commentId, 'Updated comment');
      });

      expect(result.current.comments[0]?.body).toBe('Updated comment');
      expect(result.current.comments[0]?.updatedAt).not.toBe(result.current.comments[0]?.createdAt);
    });

    it('should clear all comments', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      act(() => {
        result.current.addComment({
          filePath: 'test1.ts',
          body: 'Comment 1',
          side: 'new',
          line: 1,
        });
      });

      act(() => {
        result.current.addComment({
          filePath: 'test2.ts',
          body: 'Comment 2',
          side: 'new',
          line: 2,
        });
      });

      expect(result.current.comments).toHaveLength(2);

      act(() => {
        result.current.clearAllComments();
      });

      expect(result.current.comments).toHaveLength(0);
    });

    it('applies imported thread comments once and skips reapplying the same import id', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      let warnings: string[] = [];
      act(() => {
        warnings = result.current.applyCommentImports(
          [
            {
              type: 'thread',
              id: 'imported-thread',
              filePath: 'test.ts',
              position: { side: 'new', line: 10 },
              body: 'Imported comment',
              author: 'AI',
            },
          ],
          'import-bundle-1',
        );
      });

      expect(warnings).toEqual([]);
      expect(result.current.threads).toHaveLength(1);
      expect(result.current.threads[0]?.messages[0]?.body).toBe('Imported comment');

      act(() => {
        result.current.applyCommentImports(
          [
            {
              type: 'thread',
              id: 'imported-thread',
              filePath: 'test.ts',
              position: { side: 'new', line: 10 },
              body: 'Imported comment',
              author: 'AI',
            },
          ],
          'import-bundle-1',
        );
      });

      expect(result.current.threads).toHaveLength(1);
      expect(mockDiffContextData?.appliedCommentImportIds).toEqual(['import-bundle-1']);
    });

    it('adds imported replies to the newest matching thread', async () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      let olderThreadId = '';
      let newerThreadId = '';

      act(() => {
        olderThreadId = result.current.addThread({
          filePath: 'test.ts',
          body: 'Older thread',
          side: 'new',
          line: 10,
        }).id;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      act(() => {
        newerThreadId = result.current.addThread({
          filePath: 'test.ts',
          body: 'Newer thread',
          side: 'new',
          line: 10,
        }).id;
      });

      act(() => {
        result.current.applyCommentImports(
          [
            {
              type: 'reply',
              filePath: 'test.ts',
              position: { side: 'new', line: 10 },
              body: 'Imported reply',
              author: 'AI',
            },
          ],
          'import-bundle-2',
        );
      });

      expect(
        result.current.threads.find((thread) => thread.id === olderThreadId)?.messages,
      ).toHaveLength(1);
      expect(
        result.current.threads.find((thread) => thread.id === newerThreadId)?.messages,
      ).toHaveLength(2);
    });

    it('warns when imported replies have no matching thread', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      let warnings: string[] = [];
      act(() => {
        warnings = result.current.applyCommentImports(
          [
            {
              type: 'reply',
              filePath: 'missing.ts',
              position: { side: 'new', line: 99 },
              body: 'Imported reply',
            },
          ],
          'import-bundle-3',
        );
      });

      expect(result.current.threads).toHaveLength(0);
      expect(warnings).toHaveLength(1);
    });

    it('clears applied import ids when requested', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

      act(() => {
        result.current.applyCommentImports(
          [
            {
              type: 'thread',
              filePath: 'test.ts',
              position: { side: 'new', line: 10 },
              body: 'Imported comment',
            },
          ],
          'import-bundle-4',
        );
      });

      expect(mockDiffContextData?.appliedCommentImportIds).toEqual(['import-bundle-4']);

      act(() => {
        result.current.clearAllComments({ resetAppliedCommentImportIds: true });
      });

      expect(result.current.threads).toHaveLength(0);
      expect(mockDiffContextData?.appliedCommentImportIds).toEqual([]);
    });

    it('should not remove a thread when reply deletion targets a missing message id', () => {
      const { result } = renderHook(() => useDiffComments('main', 'feature-branch', 'abc123'));

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

      expect(result.current.threads).toHaveLength(1);
      expect(result.current.threads[0]?.messages).toHaveLength(2);

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
