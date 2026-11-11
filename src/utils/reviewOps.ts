import type { DiffCommentMessage, DiffCommentThread } from '../types/diff.js';
import type { ReviewOp } from '../types/reviewOps.js';

import { insertBeforeFollowing } from './commentThreads.js';

type ReviewOpOutcome = { threads: DiffCommentThread[] } | { error: string };

type IdentifiedOp = Record<string, unknown> & { id: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringList = (value: unknown): boolean =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isIntent = (value: unknown): boolean =>
  value === 'comment' || value === 'question' || value === 'change';

const isOrigin = (value: unknown): boolean => value === 'user' || value === 'agent';

function isMessage(value: unknown): value is DiffCommentMessage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.body === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    (value.intent === undefined || isIntent(value.intent)) &&
    (value.origin === undefined || isOrigin(value.origin)) &&
    (value.author === undefined || typeof value.author === 'string')
  );
}

function isPosition(value: unknown): boolean {
  if (!isRecord(value) || (value.side !== 'old' && value.side !== 'new')) return false;
  const { line } = value;
  return (
    typeof line === 'number' ||
    (isRecord(line) && typeof line.start === 'number' && typeof line.end === 'number')
  );
}

function isThread(value: unknown): value is DiffCommentThread {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.messages) &&
    value.messages.length > 0 &&
    value.messages.every(isMessage) &&
    (value.scope === 'review' || (typeof value.filePath === 'string' && isPosition(value.position)))
  );
}

const hasValidPlacement = (op: Record<string, unknown>): boolean =>
  (op.followingIds === undefined || isStringList(op.followingIds)) &&
  (op.precedingIds === undefined || isStringList(op.precedingIds));

/** The batch of a review-ops request, or undefined when a result could not name each op. */
export function parseReviewOpBatch(
  body: unknown,
): { repositoryId: string; ops: IdentifiedOp[] } | undefined {
  if (!isRecord(body) || typeof body.repositoryId !== 'string' || !Array.isArray(body.ops))
    return undefined;
  const ops: unknown[] = body.ops;
  const identified = (op: unknown): op is IdentifiedOp =>
    isRecord(op) && typeof op.id === 'string' && op.id.length > 0;
  return ops.every(identified) ? { repositoryId: body.repositoryId, ops } : undefined;
}

/** The op a request names, or undefined for a malformed op or one this server does not know. */
export function parseReviewOp(op: Record<string, unknown>): ReviewOp | undefined {
  const { threadId, messageId } = op;
  let valid: boolean;
  switch (op.type) {
    case 'thread.add':
      valid = isThread(op.thread) && hasValidPlacement(op);
      break;
    case 'message.add':
      valid = typeof threadId === 'string' && isMessage(op.message) && hasValidPlacement(op);
      break;
    case 'message.edit':
      valid =
        typeof threadId === 'string' &&
        typeof messageId === 'string' &&
        typeof op.body === 'string' &&
        typeof op.at === 'string' &&
        (op.intent === undefined || isIntent(op.intent));
      break;
    case 'message.delete':
      valid = typeof threadId === 'string' && typeof messageId === 'string';
      break;
    case 'thread.delete':
      valid = typeof threadId === 'string';
      break;
    case 'thread.resolve':
      valid =
        typeof threadId === 'string' &&
        typeof op.resolved === 'boolean' &&
        typeof op.at === 'string';
      break;
    // The verdict endpoint's own checks validate the rest.
    case 'verdict.set':
      valid = typeof op.verdict === 'string';
      break;
    default:
      valid = false;
  }
  return valid ? (op as unknown as ReviewOp) : undefined;
}

// With no placement, every existing item precedes the new one, so it is appended.
function place<T extends { id: string }>(
  items: T[],
  item: T,
  placement: { followingIds?: string[]; precedingIds?: string[] },
): T[] {
  return insertBeforeFollowing(
    items,
    item,
    placement.followingIds ?? [],
    placement.precedingIds ?? items.map(({ id }) => id),
  );
}

function replaceThread(threads: DiffCommentThread[], next: DiffCommentThread): DiffCommentThread[] {
  return threads.map((thread) => (thread.id === next.id ? next : thread));
}

/**
 * Applies one op to a review's threads. `now` stamps the ops that carry no time of their own.
 * Deleting something already gone succeeds; changing something gone is an error.
 */
export function applyReviewOp(
  threads: DiffCommentThread[],
  op: ReviewOp,
  now: string,
): ReviewOpOutcome {
  if (op.type === 'verdict.set') return { threads };
  if (op.type === 'thread.add') return { threads: place(threads, op.thread, op) };

  const thread = threads.find(({ id }) => id === op.threadId);
  switch (op.type) {
    case 'message.add': {
      if (!thread) return { error: `Thread not found: ${op.threadId}` };
      if (thread.messages.some(({ id }) => id === op.message.id)) return { threads };
      return {
        threads: replaceThread(threads, {
          ...thread,
          updatedAt: op.message.updatedAt,
          messages: place(thread.messages, op.message, op),
        }),
      };
    }
    case 'message.edit': {
      if (!thread) return { error: `Thread not found: ${op.threadId}` };
      if (!thread.messages.some(({ id }) => id === op.messageId))
        return { error: `Message not found: ${op.messageId}` };
      const { intent, at, body } = op;
      return {
        threads: replaceThread(threads, {
          ...thread,
          updatedAt: at,
          ...(intent !== undefined && thread.messages[0]?.id === op.messageId
            ? { isQuestion: intent === 'question' ? true : undefined }
            : {}),
          messages: thread.messages.map((message) =>
            message.id === op.messageId
              ? {
                  ...message,
                  body,
                  ...(intent === undefined ? {} : { intent, origin: 'user' as const }),
                  updatedAt: at,
                  // The agent's activity on the old text no longer applies.
                  progress: undefined,
                }
              : message,
          ),
        }),
      };
    }
    case 'message.delete': {
      const index = thread?.messages.findIndex(({ id }) => id === op.messageId) ?? -1;
      if (!thread || index < 0) return { threads };
      // A thread does not outlive its first message.
      if (index === 0) return { threads: threads.filter(({ id }) => id !== thread.id) };
      return {
        threads: replaceThread(threads, {
          ...thread,
          updatedAt: now,
          messages: thread.messages.filter(({ id }) => id !== op.messageId),
        }),
      };
    }
    case 'thread.delete':
      return { threads: threads.filter(({ id }) => id !== op.threadId) };
    case 'thread.resolve':
      if (!thread) return { error: `Thread not found: ${op.threadId}` };
      return {
        threads: replaceThread(threads, {
          ...thread,
          updatedAt: op.at,
          resolution: { resolved: op.resolved, updatedAt: op.at },
        }),
      };
  }
}
