import { useState, useEffect, useCallback, useRef } from 'react';

import {
  type BaseMode,
  type DeletedComment,
  type CommentImport,
  type CommentIntent,
  type DiffContextStorage,
  type DiffCommentThread,
  type DiffSide,
  type LegacyDiffComment,
} from '../../types/diff';
import {
  type CommentPromptDiffContext,
  formatCommentThreadPrompt,
  formatAllCommentThreadsPrompt,
} from '../../utils/commentFormatting';
import { toCommentThread as normalizeThread } from '../../utils/commentThreads';
import { createId } from '../../utils/createId';
import { mergeCommentImports } from '../../utils/commentImports';
import { storageService } from '../services/StorageService';
import { normalizeBaseMode } from '../../utils/diffSelection';
import type { NamedReviewMetadata } from '../../types/review';
import { getLanguageFromPath } from '../utils/diffUtils';
import { includeDeletedComments, insertBeforeFollowing } from '../utils/commentDeletion';

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

interface UseDiffCommentsReturn {
  hasLoadedComments: boolean;
  comments: LegacyDiffComment[];
  threads: DiffCommentThread[];
  deletedComments: DeletedComment[];
  restoreComment: (threadId: string, messageId?: string) => void;
  replaceThreads: (threads: DiffCommentThread[]) => void;
  addComment: (params: AddThreadParams) => LegacyDiffComment;
  addThread: (params: AddThreadParams) => DiffCommentThread;
  addReviewThread: (
    body: string,
    options?: { isQuestion?: boolean; intent?: CommentIntent },
  ) => void;
  toggleThreadResolved: (threadId: string) => void;
  removeComment: (commentId: string) => void;
  replyToThread: (params: ReplyToThreadParams) => void;
  removeThread: (threadId: string) => void;
  updateComment: (commentId: string, newBody: string) => void;
  removeMessage: (threadId: string, messageId: string) => void;
  updateMessage: (
    threadId: string,
    messageId: string,
    newBody: string,
    intent?: CommentIntent,
  ) => void;
  setThreadQuestion: (threadId: string, isQuestion: boolean) => void;
  clearAllComments: (options?: { resetAppliedCommentImportIds?: boolean }) => void;
  applyCommentImports: (imports: CommentImport[], importId: string) => string[];
  generatePrompt: (commentId: string) => string;
  generateThreadPrompt: (threadId: string) => string;
  generateAllCommentsPrompt: (context?: CommentPromptDiffContext) => string;
}

function normalizeRootComment(thread: DiffCommentThread): LegacyDiffComment | null {
  const rootMessage = thread.messages[0];
  if (!rootMessage || thread.scope === 'review') return null;

  return {
    id: thread.id,
    filePath: thread.filePath,
    body: rootMessage.body,
    author: rootMessage.author,
    createdAt: rootMessage.createdAt,
    updatedAt: rootMessage.updatedAt,
    position: thread.position,
    codeSnapshot: thread.codeSnapshot,
  };
}

function normalizeQuestionFlags(threads: DiffCommentThread[]): DiffCommentThread[] {
  return threads.map((thread) => {
    const intent = thread.messages[0]?.intent;
    if (intent === undefined) return thread;
    const isQuestion = intent === 'question' || undefined;
    return thread.isQuestion === isQuestion ? thread : { ...thread, isQuestion };
  });
}

function withoutThreadProgress(thread: DiffCommentThread): DiffCommentThread {
  return {
    ...thread,
    messages: thread.messages.map((message) => ({ ...message, progress: undefined })),
  };
}

function withoutProgress(threads: DiffCommentThread[]): DiffCommentThread[] {
  return threads.map(withoutThreadProgress);
}

export function useDiffComments(
  baseCommitish?: string,
  targetCommitish?: string,
  currentCommitHash?: string,
  branchToHash?: Map<string, string>,
  repositoryId?: string,
  baseMode?: BaseMode,
  capture?: Pick<NamedReviewMetadata, 'version' | 'patchDigest'>,
): UseDiffCommentsReturn {
  const [threads, setThreads] = useState<DiffCommentThread[]>([]);
  const [deletedComments, setDeletedComments] = useState<DeletedComment[]>([]);
  const contextKey = JSON.stringify([
    baseCommitish,
    targetCommitish,
    currentCommitHash,
    repositoryId,
    normalizeBaseMode(baseMode),
    branchToHash ? [...branchToHash].sort(([left], [right]) => left.localeCompare(right)) : null,
  ]);
  const activeContext = useRef(contextKey);
  activeContext.current = contextKey;
  const [loadedContextKey, setLoadedContextKey] = useState<string | null>(null);
  const hasLoadedComments =
    Boolean(baseCommitish && targetCommitish) && loadedContextKey === contextKey;

  const loadDiffContextData = useCallback(() => {
    if (!baseCommitish || !targetCommitish) {
      return null;
    }

    return storageService.getDiffContextData(
      baseCommitish,
      targetCommitish,
      currentCommitHash,
      branchToHash,
      repositoryId,
      baseMode,
    );
  }, [baseCommitish, targetCommitish, currentCommitHash, branchToHash, repositoryId, baseMode]);

  const createEmptyDiffContext = useCallback((): DiffContextStorage | null => {
    if (!baseCommitish || !targetCommitish) {
      return null;
    }

    const now = new Date().toISOString();
    return {
      version: 2,
      baseCommitish,
      targetCommitish,
      baseMode,
      createdAt: now,
      lastModifiedAt: now,
      threads: [],
      viewedFiles: [],
      appliedCommentImportIds: [],
    };
  }, [baseCommitish, targetCommitish, baseMode]);

  useEffect(() => {
    if (!baseCommitish || !targetCommitish) {
      setThreads([]);
      setDeletedComments([]);
      setLoadedContextKey(null);
      return;
    }

    const storedContext = loadDiffContextData();
    setDeletedComments(storedContext?.deletedComments ?? []);
    const loadedThreads =
      storedContext?.threads ||
      storageService.getCommentThreads(
        baseCommitish,
        targetCommitish,
        currentCommitHash,
        branchToHash,
        repositoryId,
        baseMode,
      );
    const normalizedThreads = normalizeQuestionFlags(loadedThreads);
    if (normalizedThreads.some((thread, index) => thread !== loadedThreads[index])) {
      storageService.saveCommentThreads(
        baseCommitish,
        targetCommitish,
        withoutProgress(normalizedThreads),
        currentCommitHash,
        branchToHash,
        repositoryId,
        baseMode,
      );
    }
    // Persisted activity belongs to an earlier connection, never the current agent.
    setThreads(withoutProgress(normalizedThreads));
    setLoadedContextKey(contextKey);
  }, [
    baseCommitish,
    targetCommitish,
    currentCommitHash,
    branchToHash,
    repositoryId,
    baseMode,
    loadDiffContextData,
    contextKey,
  ]);

  const saveThreads = useCallback(
    (newThreads: DiffCommentThread[]) => {
      if (!baseCommitish || !targetCommitish || activeContext.current !== contextKey) return;

      const normalizedThreads = normalizeQuestionFlags(newThreads);
      storageService.saveCommentThreads(
        baseCommitish,
        targetCommitish,
        withoutProgress(normalizedThreads),
        currentCommitHash,
        branchToHash,
        repositoryId,
        baseMode,
      );
      setThreads(normalizedThreads);
      setLoadedContextKey(contextKey);
    },
    [
      baseCommitish,
      targetCommitish,
      currentCommitHash,
      branchToHash,
      repositoryId,
      baseMode,
      contextKey,
    ],
  );

  const replaceThreads = useCallback(
    (newThreads: DiffCommentThread[]) => {
      saveThreads(newThreads);
    },
    [saveThreads],
  );

  const addThread = useCallback(
    (params: AddThreadParams): DiffCommentThread => {
      const now = new Date().toISOString();
      const threadId = createId();
      const newThread: DiffCommentThread = {
        ...(capture
          ? { capture: { version: capture.version, patchDigest: capture.patchDigest } }
          : {}),
        id: threadId,
        filePath: params.filePath,
        createdAt: now,
        updatedAt: now,
        position: {
          side: params.side,
          line: params.line,
        },
        codeSnapshot: params.codeSnapshot || {
          content: '',
          language: getLanguageFromPath(params.filePath),
        },
        ...((params.intent === undefined ? params.isQuestion : params.intent === 'question')
          ? { isQuestion: true }
          : {}),
        messages: [
          {
            id: threadId,
            body: params.body,
            intent: params.intent ?? (params.isQuestion ? 'question' : undefined),
            author: 'User',
            createdAt: now,
            updatedAt: now,
          },
        ],
      };

      const newThreads = [...threads, newThread];
      saveThreads(newThreads);
      return newThread;
    },
    [saveThreads, threads, capture],
  );

  const addReviewThread = useCallback(
    (body: string, options?: { isQuestion?: boolean; intent?: CommentIntent }) => {
      const now = new Date().toISOString();
      const id = createId();
      saveThreads([
        ...threads,
        {
          id,
          ...(capture
            ? { capture: { version: capture.version, patchDigest: capture.patchDigest } }
            : {}),
          scope: 'review',
          isQuestion:
            (options?.intent === undefined ? options?.isQuestion : options.intent === 'question') ||
            undefined,
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id,
              body,
              intent: options?.intent ?? (options?.isQuestion ? 'question' : undefined),
              author: 'User',
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
      ]);
    },
    [saveThreads, threads, capture],
  );

  const toggleThreadResolved = useCallback(
    (threadId: string) => {
      const now = new Date().toISOString();
      saveThreads(
        threads.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                updatedAt: now,
                resolution: { resolved: !thread.resolution?.resolved, updatedAt: now },
              }
            : thread,
        ),
      );
    },
    [saveThreads, threads],
  );

  const addComment = useCallback(
    (params: AddThreadParams): LegacyDiffComment => {
      const thread = addThread(params);
      const rootComment = normalizeRootComment(thread);
      if (!rootComment) {
        throw new Error('Failed to create root comment');
      }
      return rootComment;
    },
    [addThread],
  );

  const replyToThread = useCallback(
    ({ threadId, body, intent }: ReplyToThreadParams) => {
      const now = new Date().toISOString();
      const newThreads = threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              updatedAt: now,
              messages: [
                ...thread.messages,
                {
                  id: createId(),
                  body,
                  intent,
                  author: 'User',
                  createdAt: now,
                  updatedAt: now,
                },
              ],
            }
          : thread,
      );
      saveThreads(newThreads);
    },
    [saveThreads, threads],
  );

  const saveDeletedComments = useCallback(
    (next: DeletedComment[]) => {
      if (!baseCommitish || !targetCommitish || activeContext.current !== contextKey) return;
      const data = loadDiffContextData() || createEmptyDiffContext();
      if (!data) return;
      storageService.saveDiffContextData(
        baseCommitish,
        targetCommitish,
        {
          ...data,
          deletedComments: next.map((entry) => ({
            ...entry,
            thread: withoutThreadProgress(entry.thread),
          })),
        },
        currentCommitHash,
        branchToHash,
        repositoryId,
        baseMode,
      );
      setDeletedComments(next);
    },
    [
      baseCommitish,
      targetCommitish,
      contextKey,
      loadDiffContextData,
      createEmptyDiffContext,
      currentCommitHash,
      branchToHash,
      repositoryId,
      baseMode,
    ],
  );

  const restoreComment = useCallback(
    (threadId: string, messageId?: string) => {
      const entry = deletedComments.find(
        (item) => item.thread.id === threadId && item.messageId === messageId,
      );
      if (!entry || activeContext.current !== contextKey) return;
      const now = new Date().toISOString();
      if (messageId === undefined) {
        if (!threads.some((thread) => thread.id === threadId)) {
          saveThreads(
            insertBeforeFollowing(
              threads,
              { ...withoutThreadProgress(entry.thread), updatedAt: now },
              entry.followingIds,
              entry.precedingIds,
            ),
          );
        }
      } else {
        const message = entry.thread.messages.find((item) => item.id === messageId);
        const thread = threads.find((item) => item.id === threadId);
        if (!message || !thread) return;
        if (!thread.messages.some((item) => item.id === messageId)) {
          const messages = insertBeforeFollowing(
            thread.messages,
            { ...message, updatedAt: now, progress: undefined },
            entry.followingIds,
            entry.precedingIds,
          );
          saveThreads(
            threads.map((item) =>
              item.id === threadId ? { ...item, messages, updatedAt: now } : item,
            ),
          );
        }
      }
      saveDeletedComments(deletedComments.filter((item) => item !== entry));
    },
    [deletedComments, threads, saveThreads, saveDeletedComments, contextKey],
  );

  const removeThread = useCallback(
    (threadId: string) => {
      const index = threads.findIndex((thread) => thread.id === threadId);
      const thread = threads[index];
      if (!thread || activeContext.current !== contextKey) return;
      const display = includeDeletedComments(threads, deletedComments);
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
      saveThreads(threads.filter((item) => item.id !== threadId));
    },
    [saveThreads, threads, saveDeletedComments, deletedComments, contextKey],
  );

  const removeComment = useCallback(
    (commentId: string) => {
      removeThread(commentId);
    },
    [removeThread],
  );

  const removeMessage = useCallback(
    (threadId: string, messageId: string) => {
      const thread = threads.find((item) => item.id === threadId);
      if (!thread) return;

      const targetIndex = thread.messages.findIndex((message) => message.id === messageId);
      if (targetIndex < 0) {
        return;
      }

      if (targetIndex === 0) {
        removeThread(threadId);
        return;
      }

      if (activeContext.current !== contextKey) return;
      const display = includeDeletedComments(threads, deletedComments).find(
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
      const now = new Date().toISOString();
      const newThreads = threads.map((item) =>
        item.id === threadId
          ? {
              ...item,
              updatedAt: now,
              messages: item.messages.filter((message) => message.id !== messageId),
            }
          : item,
      );
      saveThreads(newThreads);
    },
    [removeThread, saveThreads, threads, saveDeletedComments, deletedComments, contextKey],
  );

  const updateMessage = useCallback(
    (threadId: string, messageId: string, newBody: string, intent?: CommentIntent) => {
      const now = new Date().toISOString();
      const newThreads = threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              updatedAt: now,
              ...(intent !== undefined && thread.messages[0]?.id === messageId
                ? { isQuestion: intent === 'question' || undefined }
                : {}),
              messages: thread.messages.map((message) =>
                message.id === messageId
                  ? {
                      ...message,
                      body: newBody,
                      ...(intent === undefined ? {} : { intent, origin: 'user' as const }),
                      updatedAt: now,
                      progress: undefined,
                    }
                  : message,
              ),
            }
          : thread,
      );
      saveThreads(newThreads);
    },
    [saveThreads, threads],
  );

  const setThreadQuestion = useCallback(
    (threadId: string, isQuestion: boolean) => {
      const now = new Date().toISOString();
      const newThreads = threads.map((thread): DiffCommentThread =>
        thread.id === threadId
          ? {
              ...thread,
              isQuestion: isQuestion || undefined,
              updatedAt: now,
              messages: thread.messages.map((message, index) =>
                index === 0
                  ? {
                      ...message,
                      origin: 'user',
                      intent: isQuestion
                        ? 'question'
                        : message.intent === 'question'
                          ? 'comment'
                          : message.intent,
                      updatedAt: now,
                      progress: undefined,
                    }
                  : message,
              ),
            }
          : thread,
      );
      saveThreads(newThreads);
    },
    [saveThreads, threads],
  );

  const updateComment = useCallback(
    (commentId: string, newBody: string) => {
      updateMessage(commentId, commentId, newBody);
    },
    [updateMessage],
  );

  const clearAllComments = useCallback(() => {
    saveThreads([]);
    saveDeletedComments([]);
  }, [saveThreads, saveDeletedComments]);

  const clearAllCommentsWithOptions = useCallback(
    (options?: { resetAppliedCommentImportIds?: boolean }) => {
      if (!options?.resetAppliedCommentImportIds) {
        clearAllComments();
        return;
      }

      const existingData = loadDiffContextData() || createEmptyDiffContext();
      if (!existingData || !baseCommitish || !targetCommitish) {
        return;
      }

      const nextData: DiffContextStorage = {
        ...existingData,
        threads: [],
        deletedComments: [],
        appliedCommentImportIds: [],
      };

      storageService.saveDiffContextData(
        baseCommitish,
        targetCommitish,
        nextData,
        currentCommitHash,
        branchToHash,
        repositoryId,
        baseMode,
      );
      setThreads([]);
      setDeletedComments([]);
    },
    [
      baseCommitish,
      targetCommitish,
      branchToHash,
      clearAllComments,
      createEmptyDiffContext,
      currentCommitHash,
      loadDiffContextData,
      repositoryId,
      baseMode,
    ],
  );

  const applyCommentImports = useCallback(
    (imports: CommentImport[], importId: string): string[] => {
      if (!baseCommitish || !targetCommitish || imports.length === 0 || importId.length === 0) {
        return [];
      }

      const existingData = loadDiffContextData() || createEmptyDiffContext();
      if (!existingData) {
        return [];
      }

      if (existingData.appliedCommentImportIds.includes(importId)) {
        const normalizedThreads = normalizeQuestionFlags(existingData.threads);
        if (normalizedThreads.some((thread, index) => thread !== existingData.threads[index])) {
          saveThreads(normalizedThreads);
        } else {
          setThreads(normalizedThreads);
        }
        return [];
      }

      const merged = mergeCommentImports(existingData.threads, imports);
      const nextData: DiffContextStorage = {
        ...existingData,
        threads: withoutProgress(normalizeQuestionFlags(merged.threads)),
        appliedCommentImportIds: [...existingData.appliedCommentImportIds, importId],
      };

      storageService.saveDiffContextData(
        baseCommitish,
        targetCommitish,
        nextData,
        currentCommitHash,
        branchToHash,
        repositoryId,
        baseMode,
      );
      setThreads(normalizeQuestionFlags(merged.threads));
      return merged.warnings;
    },
    [
      baseCommitish,
      targetCommitish,
      branchToHash,
      createEmptyDiffContext,
      currentCommitHash,
      loadDiffContextData,
      repositoryId,
      baseMode,
      saveThreads,
    ],
  );

  const generateThreadPrompt = useCallback(
    (threadId: string): string => {
      const thread = threads.find((item) => item.id === threadId);
      if (!thread) return '';

      return formatCommentThreadPrompt(normalizeThread(thread));
    },
    [threads],
  );

  const generatePrompt = useCallback(
    (commentId: string): string => {
      return generateThreadPrompt(commentId);
    },
    [generateThreadPrompt],
  );

  const generateAllCommentsPrompt = useCallback(
    (context?: CommentPromptDiffContext): string => {
      return formatAllCommentThreadsPrompt(threads.map(normalizeThread), context);
    },
    [threads],
  );

  const visibleThreads = hasLoadedComments ? threads : [];
  const comments = visibleThreads
    .map((thread) => normalizeRootComment(thread))
    .filter((comment): comment is LegacyDiffComment => comment !== null);

  return {
    hasLoadedComments,
    comments,
    threads: visibleThreads,
    deletedComments: hasLoadedComments ? deletedComments : [],
    restoreComment,
    replaceThreads,
    addComment,
    addThread,
    addReviewThread,
    toggleThreadResolved,
    removeComment,
    replyToThread,
    removeThread,
    updateComment,
    removeMessage,
    updateMessage,
    setThreadQuestion,
    clearAllComments: clearAllCommentsWithOptions,
    applyCommentImports,
    generatePrompt,
    generateThreadPrompt,
    generateAllCommentsPrompt,
  };
}
