import { useState, useCallback, useMemo } from 'react';

import {
  type DeletedComment,
  type CommentIntent,
  type DiffCommentThread,
  type DiffSide,
} from '../../types/diff';
import type { ReviewOp } from '../../types/reviewOps';
import {
  type CommentPromptDiffContext,
  type CommentThreadPromptContext,
  formatCommentThreadPrompt,
  formatAllCommentThreadsPrompt,
} from '../../utils/commentFormatting';
import { toCommentThread as normalizeThread } from '../../utils/commentThreads';
import { createId } from '../../utils/createId';
import type { NamedReviewMetadata } from '../../types/review';
import { getLanguageFromPath } from '../utils/diffUtils';
import { includeDeletedComments } from '../utils/commentDeletion';

interface AddThreadParams {
  filePath: string;
  body: string;
  intent?: CommentIntent;
  side: DiffSide;
  line: number | { start: number; end: number };
  codeSnapshot?: DiffCommentThread['codeSnapshot'];
  isQuestion?: boolean;
}

interface ReplyToThreadParams {
  threadId: string;
  body: string;
  intent?: CommentIntent;
}

function withoutThreadProgress(thread: DiffCommentThread): DiffCommentThread {
  return {
    ...thread,
    messages: thread.messages.map((message) => ({ ...message, progress: undefined })),
  };
}

/**
 * The page's comment actions. Each one queues a review op through `enqueue`; `liveThreads` are
 * the server's threads with the queued ops applied. Undo copies of deleted comments stay in page memory,
 * kept for each review `scope`.
 */
export function useDiffComments(
  scope: string | null,
  liveThreads: DiffCommentThread[],
  enqueue: (op: ReviewOp) => unknown,
  capture?: Pick<NamedReviewMetadata, 'version' | 'patchDigest'>,
) {
  const [deleted, setDeleted] = useState<Record<string, DeletedComment[]>>({});
  const deletedComments = useMemo(
    () => (scope ? deleted[scope] : undefined) ?? [],
    [deleted, scope],
  );
  const saveDeletedComments = useCallback(
    (entries: DeletedComment[]) => {
      if (!scope) throw new Error('No review is open');
      setDeleted((all) => ({ ...all, [scope]: entries }));
    },
    [scope],
  );

  const newThread = useCallback(
    (fields: Partial<DiffCommentThread>, body: string, intent?: CommentIntent) => {
      const now = new Date().toISOString();
      const id = createId();
      const thread = {
        id,
        ...(capture
          ? { capture: { version: capture.version, patchDigest: capture.patchDigest } }
          : {}),
        ...fields,
        ...(intent === 'question' ? { isQuestion: true } : {}),
        createdAt: now,
        updatedAt: now,
        messages: [{ id, body, intent, author: 'User', createdAt: now, updatedAt: now }],
      } as DiffCommentThread;
      enqueue({ type: 'thread.add', thread });
      return thread;
    },
    [enqueue, capture],
  );

  const addThread = useCallback(
    (params: AddThreadParams): DiffCommentThread =>
      newThread(
        {
          filePath: params.filePath,
          position: { side: params.side, line: params.line },
          codeSnapshot: params.codeSnapshot || {
            content: '',
            language: getLanguageFromPath(params.filePath),
          },
        },
        params.body,
        params.intent ?? (params.isQuestion ? 'question' : undefined),
      ),
    [newThread],
  );

  const addReviewThread = useCallback(
    (body: string, options?: { isQuestion?: boolean; intent?: CommentIntent }) => {
      newThread(
        { scope: 'review' },
        body,
        options?.intent ?? (options?.isQuestion ? 'question' : undefined),
      );
    },
    [newThread],
  );

  const toggleThreadResolved = useCallback(
    (threadId: string) => {
      const thread = liveThreads.find((item) => item.id === threadId);
      enqueue({
        type: 'thread.resolve',
        threadId,
        resolved: !thread?.resolution?.resolved,
        at: new Date().toISOString(),
      });
    },
    [enqueue, liveThreads],
  );

  const replyToThread = useCallback(
    ({ threadId, body, intent }: ReplyToThreadParams) => {
      const now = new Date().toISOString();
      enqueue({
        type: 'message.add',
        threadId,
        message: { id: createId(), body, intent, author: 'User', createdAt: now, updatedAt: now },
      });
    },
    [enqueue],
  );

  const restoreComment = useCallback(
    (threadId: string, messageId?: string) => {
      const entry = deletedComments.find(
        (item) => item.thread.id === threadId && item.messageId === messageId,
      );
      if (!entry) return;
      const now = new Date().toISOString();
      const placement = { followingIds: entry.followingIds, precedingIds: entry.precedingIds };
      if (messageId === undefined) {
        enqueue({
          type: 'thread.add',
          thread: { ...withoutThreadProgress(entry.thread), updatedAt: now },
          ...placement,
        });
      } else {
        const message = entry.thread.messages.find((item) => item.id === messageId);
        if (!message || !liveThreads.some((item) => item.id === threadId)) return;
        enqueue({
          type: 'message.add',
          threadId,
          message: { ...message, updatedAt: now, progress: undefined },
          ...placement,
        });
      }
      saveDeletedComments(deletedComments.filter((item) => item !== entry));
    },
    [deletedComments, liveThreads, enqueue, saveDeletedComments],
  );

  const removeThread = useCallback(
    (threadId: string) => {
      const thread = liveThreads.find((item) => item.id === threadId);
      if (!thread) return;
      const display = includeDeletedComments(liveThreads, deletedComments);
      const displayIndex = display.findIndex((item) => item.id === threadId);
      saveDeletedComments([
        ...deletedComments.filter(
          (entry) => entry.thread.id !== threadId || entry.messageId !== undefined,
        ),
        {
          thread,
          followingIds: display.slice(displayIndex + 1).map((item) => item.id),
          precedingIds: display.slice(0, displayIndex).map((item) => item.id),
        },
      ]);
      enqueue({ type: 'thread.delete', threadId });
    },
    [enqueue, liveThreads, saveDeletedComments, deletedComments],
  );

  const removeMessage = useCallback(
    (threadId: string, messageId: string) => {
      const thread = liveThreads.find((item) => item.id === threadId);
      if (!thread) return;

      const targetIndex = thread.messages.findIndex((message) => message.id === messageId);
      if (targetIndex < 0) {
        return;
      }

      if (targetIndex === 0) {
        removeThread(threadId);
        return;
      }

      const display = includeDeletedComments(liveThreads, deletedComments).find(
        (item) => item.id === threadId,
      );
      if (!display) return;
      const displayIndex = display.messages.findIndex((item) => item.id === messageId);
      saveDeletedComments([
        ...deletedComments.filter(
          (entry) => entry.thread.id !== threadId || entry.messageId !== messageId,
        ),
        {
          thread,
          followingIds: display.messages.slice(displayIndex + 1).map((item) => item.id),
          precedingIds: display.messages.slice(0, displayIndex).map((item) => item.id),
          messageId,
        },
      ]);
      enqueue({ type: 'message.delete', threadId, messageId });
    },
    [removeThread, enqueue, liveThreads, saveDeletedComments, deletedComments],
  );

  const updateMessage = useCallback(
    (threadId: string, messageId: string, newBody: string, intent?: CommentIntent) => {
      enqueue({
        type: 'message.edit',
        threadId,
        messageId,
        body: newBody,
        intent,
        at: new Date().toISOString(),
      });
    },
    [enqueue],
  );

  const clearAllComments = useCallback(() => {
    for (const thread of liveThreads) enqueue({ type: 'thread.delete', threadId: thread.id });
    saveDeletedComments([]);
  }, [enqueue, liveThreads, saveDeletedComments]);

  const generateThreadPrompt = useCallback(
    (threadId: string, context?: CommentThreadPromptContext): string => {
      const thread = liveThreads.find((item) => item.id === threadId);
      if (!thread) return '';

      return formatCommentThreadPrompt(normalizeThread(thread), context);
    },
    [liveThreads],
  );

  const generateAllCommentsPrompt = useCallback(
    (context?: CommentPromptDiffContext): string => {
      return formatAllCommentThreadsPrompt(liveThreads.map(normalizeThread), context);
    },
    [liveThreads],
  );

  return {
    threads: liveThreads,
    deletedComments,
    restoreComment,
    addThread,
    addReviewThread,
    toggleThreadResolved,
    replyToThread,
    removeThread,
    removeMessage,
    updateMessage,
    clearAllComments,
    generateThreadPrompt,
    generateAllCommentsPrompt,
  };
}
