import { createHash, randomUUID } from 'node:crypto';

import type { Express } from 'express';

import type {
  ConversationEvent,
  ConversationStreamEvent,
  ConversationSnapshot,
  ConversationBatch,
  ReviewApproval,
  ReviewSummary,
  ApprovalMode,
  ReviewStoreStatus,
} from '../types/conversation.js';
import type { CommentProgress, DiffCommentThread, DiffSelection } from '../types/diff.js';
import { getDiffSelectionKey } from '../utils/diffSelection.js';
import type { NamedReviewMetadata } from '../types/review.js';
import type { ReviewPresence } from './review-presence.js';
import type { SavedReviewState } from './review-store.js';

interface Review {
  capture?: NamedReviewMetadata;
  id: string;
  selection: DiffSelection;
  threads: DiffCommentThread[];
  progress: Map<string, CommentProgress>;
  approval: ReviewApproval;
  summary: ReviewSummary;
}

// The agent acts on the comments and commits, so nothing but the reviewer changes this verdict.
const isAfterComments = (approval: ReviewApproval) =>
  approval.requested === true && approval.mode === 'after-comments';

/**
 * Review state and bounded event replay. The replay and its cursors are process-local and change
 * after a server restart; `restore` supplies review state an earlier server saved.
 */
export class Conversation {
  private readonly streamId = randomUUID();
  private sequence = 0;
  private readonly reviews = new Map<string, Review>();
  private readonly events: ConversationStreamEvent[] = [];
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly onEvent?: (event: ConversationStreamEvent) => void,
    private readonly capacity = 256,
    private readonly restore?: (selection: DiffSelection) => SavedReviewState | undefined,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error('Conversation capacity must be a positive integer');
  }

  private emit(event: ConversationStreamEvent): void {
    this.events.push(structuredClone(event));
    if (this.events.length > this.capacity) this.events.shift();
    for (const listener of this.listeners) listener();
    this.onEvent?.(event);
  }

  read(after?: string): ConversationBatch {
    let sequence = 0;
    if (after !== undefined) {
      const [streamId, number, extra] = after.split(':');
      sequence = Number(number);
      if (
        streamId !== this.streamId ||
        extra !== undefined ||
        !number ||
        !/^\d+$/.test(number) ||
        !Number.isSafeInteger(sequence) ||
        sequence > this.sequence
      ) {
        throw new ConversationCursorError(
          'Invalid conversation cursor or server restarted; reconcile with comment snapshot',
        );
      }
    }
    if (sequence < this.sequence - this.events.length)
      throw new ConversationCursorError(
        'Conversation cursor expired; reconcile with comment snapshot',
      );
    return {
      events: structuredClone(this.events.slice(sequence - (this.sequence - this.events.length))),
      cursor: this.cursor,
    };
  }

  async wait(after: string, milliseconds: number, signal: AbortSignal): Promise<ConversationBatch> {
    const batch = this.read(after);
    if (batch.events.length || milliseconds === 0 || signal.aborted) return batch;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.listeners.delete(finish);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      this.listeners.add(finish);
      signal.addEventListener('abort', finish, { once: true });
    });
    return this.read(after);
  }

  private getReview(selection: DiffSelection): Review {
    const key = getDiffSelectionKey(selection);
    let review = this.reviews.get(key);
    if (!review) {
      const saved = this.restore?.(selection);
      review = {
        id: randomUUID(),
        selection: { ...selection },
        threads: saved?.threads ?? [],
        progress: new Map<string, CommentProgress>(saved?.progress ?? []),
        approval: saved?.approval ?? { approved: false },
        summary: saved?.summary ?? { commitMessage: '', rationale: '', version: 0 },
        ...(saved?.capture ? { capture: saved.capture } : {}),
      };
      this.reviews.set(key, review);
    }
    return review;
  }

  getThreads(selection: DiffSelection): DiffCommentThread[] {
    return structuredClone(this.getReview(selection).threads);
  }

  /** The state a restarted server needs to restore this review. */
  exportReview(id: string): SavedReviewState & { selection: DiffSelection } {
    const review = this.findReview(id);
    if (!review) throw new Error(`Review ${id} does not exist`);
    return structuredClone({
      selection: review.selection,
      ...(review.capture ? { capture: review.capture } : {}),
      threads: review.threads,
      progress: [...review.progress.entries()],
      approval: review.approval,
      summary: review.summary,
    });
  }

  getApproval(selection: DiffSelection): ReviewApproval {
    return { ...structuredClone(this.getReview(selection).approval), conditionalSupported: true };
  }

  setCapture(selection: DiffSelection, capture: NamedReviewMetadata): void {
    const review = this.getReview(selection);
    // A review restored with this same capture keeps its approval.
    const unchanged =
      review.capture?.version === capture.version &&
      review.capture.patchDigest === capture.patchDigest;
    review.selection = { ...selection };
    review.capture = { ...capture };
    if (!unchanged && isAfterComments(review.approval))
      this.recordApproval(
        review,
        { ...review.approval, captureVersion: capture.version, patchDigest: capture.patchDigest },
        'agent',
      );
    else if (!unchanged && (review.approval.approved || review.approval.notYet))
      this.setApproval(selection, false, 'agent');
    this.sequence += 1;
    this.emit({
      type: 'review.capture',
      origin: 'agent',
      cursor: this.cursor,
      reviewId: review.id,
      selection: { ...selection },
      capture: { ...capture },
      timestamp: new Date().toISOString(),
    });
  }

  getSummary(selection: DiffSelection): ReviewSummary {
    return { ...this.getReview(selection).summary };
  }

  setSummary(selection: DiffSelection, summary: ReviewSummary, origin: 'user' | 'agent'): void {
    const review = this.getReview(selection);
    review.summary = { ...summary };
    this.sequence += 1;
    this.emit({
      type: 'review.summary',
      origin,
      cursor: this.cursor,
      reviewId: review.id,
      selection: { ...selection },
      summary: { ...summary },
      ...(review.capture ? { capture: { ...review.capture } } : {}),
      timestamp: new Date().toISOString(),
    });
    if (isAfterComments(review.approval))
      this.recordApproval(review, { ...review.approval, summaryVersion: summary.version }, origin);
    else if (review.approval.approved || review.approval.requested || review.approval.notYet)
      this.setApproval(selection, false, origin);
  }

  /** Records the reviewer's verdict that the displayed capture is not ready, replacing any approval. */
  setNotYet(selection: DiffSelection, diffDigest?: string): ReviewApproval {
    const review = this.getReview(selection);
    if (review.approval.notYet) return this.getApproval(selection);
    return this.recordApproval(
      review,
      {
        approved: false,
        notYet: true,
        ...(diffDigest !== undefined ? { diffDigest } : {}),
        ...(review.capture
          ? {
              captureVersion: review.capture.version,
              patchDigest: review.capture.patchDigest,
              summaryVersion: review.summary.version,
            }
          : {}),
      },
      'user',
    );
  }

  setApproval(
    selection: DiffSelection,
    approved: boolean,
    origin: 'user' | 'agent' = 'user',
    mode: ApprovalMode = 'as-is',
    diffDigest?: string,
  ): ReviewApproval {
    const review = this.getReview(selection);
    if (
      !approved &&
      !review.approval.approved &&
      !review.approval.requested &&
      !review.approval.notYet
    )
      return this.getApproval(selection);
    if (approved && review.approval.requested && review.approval.mode === mode)
      return this.getApproval(selection);
    return this.recordApproval(
      review,
      {
        approved,
        ...(approved ? { mode, requested: true, summaryVersion: review.summary.version } : {}),
        ...(approved && diffDigest !== undefined ? { diffDigest } : {}),
        ...(review.capture
          ? {
              captureVersion: review.capture.version,
              patchDigest: review.capture.patchDigest,
              summaryVersion: review.summary.version,
            }
          : {}),
      },
      origin,
    );
  }

  private recordApproval(
    review: Review,
    approval: ReviewApproval,
    origin: 'user' | 'agent',
  ): ReviewApproval {
    this.sequence += 1;
    const timestamp = new Date().toISOString();
    review.approval = {
      ...approval,
      cursor: this.cursor,
      updatedAt: timestamp,
    };
    this.emit({
      type: 'review.approval',
      origin,
      cursor: this.cursor,
      reviewId: review.id,
      selection: { ...review.selection },
      approved: review.approval.approved,
      approval: structuredClone(review.approval),
      ...(review.capture ? { summaryVersion: review.summary.version } : {}),
      ...(review.capture ? { capture: { ...review.capture } } : {}),
      timestamp,
    });
    return this.getApproval(review.selection);
  }

  update(
    selection: DiffSelection,
    previous: DiffCommentThread[],
    next: DiffCommentThread[],
    origin: ConversationEvent['origin'],
  ): void {
    const review = this.getReview(selection);
    review.threads = next;
    const liveKeys = new Set(
      next.flatMap((thread) =>
        thread.messages.map((message) => JSON.stringify([thread.id, message.id])),
      ),
    );
    for (const key of review.progress.keys()) {
      if (!liveKeys.has(key)) review.progress.delete(key);
    }
    const pending: ConversationStreamEvent[] = [];
    for (const thread of next) {
      const oldThread = previous.find((candidate) => candidate.id === thread.id);
      for (const message of thread.messages) {
        const oldMessage = oldThread?.messages.find((candidate) => candidate.id === message.id);
        if (oldMessage?.body === message.body && oldMessage.intent === message.intent) continue;
        this.sequence += 1;
        const progressKey = JSON.stringify([thread.id, message.id]);
        if ((message.origin ?? origin) === 'user') {
          review.progress.set(progressKey, {
            status: 'queued',
            cursor: this.cursor,
            updatedAt: new Date().toISOString(),
          });
        } else {
          review.progress.delete(progressKey);
        }
        pending.push({
          type: oldMessage ? 'comment.updated' : 'comment.created',
          cursor: this.cursor,
          origin: message.origin ?? origin,
          reviewId: review.id,
          selection: { ...selection },
          threadId: thread.id,
          messageId: message.id,
          scope: thread.scope,
          intent: message.intent,
          file: thread.filePath,
          side: thread.position?.side,
          line: thread.position ? structuredClone(thread.position.line) : undefined,
          body: message.body,
          author: message.author,
          codeSnapshot: thread.codeSnapshot ? { ...thread.codeSnapshot } : undefined,
          ...(review.capture ? { capture: { ...review.capture } } : {}),
          ...(thread.capture ? { anchorCapture: { ...thread.capture } } : {}),
          timestamp: new Date().toISOString(),
        });
      }
    }
    for (const thread of next) {
      const oldThread = previous.find((candidate) => candidate.id === thread.id);
      for (const message of oldThread?.messages ?? []) {
        if (thread.messages.some((candidate) => candidate.id === message.id)) continue;
        this.sequence += 1;
        pending.push({
          type: 'comment.deleted',
          cursor: this.cursor,
          origin,
          reviewId: review.id,
          selection: { ...selection },
          threadId: thread.id,
          messageId: message.id,
          timestamp: new Date().toISOString(),
        });
      }
    }
    for (const thread of next) {
      const oldThread = previous.find((candidate) => candidate.id === thread.id);
      if (Boolean(oldThread?.resolution?.resolved) === Boolean(thread.resolution?.resolved))
        continue;
      this.sequence += 1;
      pending.push({
        type: thread.resolution?.resolved ? 'thread.resolved' : 'thread.reopened',
        origin,
        cursor: this.cursor,
        reviewId: review.id,
        selection: { ...selection },
        threadId: thread.id,
        timestamp: new Date().toISOString(),
      });
    }
    for (const oldThread of previous) {
      if (!next.some((thread) => thread.id === oldThread.id)) {
        this.sequence += 1;
        pending.push({
          type: 'thread.deleted',
          origin,
          cursor: this.cursor,
          reviewId: review.id,
          selection: { ...selection },
          threadId: oldThread.id,
          timestamp: new Date().toISOString(),
        });
      }
    }
    for (const event of pending) this.emit(event);
    if (
      (review.approval.approved || review.approval.requested) &&
      !isAfterComments(review.approval) &&
      pending.some((event) => event.origin === 'user' && event.type !== 'thread.resolved')
    )
      this.setApproval(selection, false, 'user');
  }

  get cursor(): string {
    return `${this.streamId}:${this.sequence}`;
  }

  findReview(id: string): Review | undefined {
    return [...this.reviews.values()].find((review) => review.id === id);
  }

  snapshot(): ConversationSnapshot {
    return {
      cursor: this.cursor,
      reviews: [...this.reviews.values()].map((review) => ({
        id: review.id,
        selection: { ...review.selection },
        threads: structuredClone(this.withProgress(review.selection, review.threads)),
        approval: this.getApproval(review.selection),
        summary: { ...review.summary },
        ...(review.capture ? { capture: { ...review.capture } } : {}),
      })),
    };
  }

  withProgress(selection: DiffSelection, threads: DiffCommentThread[]): DiffCommentThread[] {
    const review = this.reviews.get(getDiffSelectionKey(selection));
    return threads.map((thread) => ({
      ...thread,
      messages: thread.messages.map((message) => {
        const progress = review?.progress.get(JSON.stringify([thread.id, message.id]));
        return { ...message, progress: progress ? { ...progress } : undefined };
      }),
    }));
  }

  setProgress(
    reviewId: string,
    threadId: string,
    messageId: string,
    cursor: string,
    status: CommentProgress['status'],
  ): DiffSelection | undefined {
    const review = this.findReview(reviewId);
    const progress = review?.progress.get(JSON.stringify([threadId, messageId]));
    if (!review || !progress) throw new ProgressError(404, 'User comment no longer exists');
    if (progress.cursor !== cursor)
      throw new ProgressError(409, 'Comment changed; read its latest event or snapshot');
    const order: CommentProgress['status'][] = [
      'queued',
      'delivered',
      'read',
      'thinking',
      'replying',
      'noted',
      'replied',
    ];
    // Replayed deliveries and delayed status requests must not move progress backwards.
    if (order.indexOf(status) <= order.indexOf(progress.status)) return undefined;
    const updated = { status, cursor, updatedAt: new Date().toISOString() };
    review.progress.set(JSON.stringify([threadId, messageId]), updated);
    this.sequence += 1;
    this.emit({
      type: 'comment.progress',
      origin: 'agent',
      cursor: this.cursor,
      reviewId,
      selection: { ...review.selection },
      threadId,
      messageId,
      progress: { ...updated },
      timestamp: updated.updatedAt,
    });
    return review.selection;
  }
}

class ConversationCursorError extends Error {}

class ProgressError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function registerConversationRoutes(
  app: Express,
  conversation: Conversation,
  update: (selection: DiffSelection, threads: DiffCommentThread[]) => void,
  progressChanged: (selection: DiffSelection) => void,
  presence?: ReviewPresence,
  beforeSnapshot?: () => Promise<void>,
  storeStatus?: () => ReviewStoreStatus | undefined,
): void {
  app.get('/api/conversation/snapshot', async (_req, res) => {
    await beforeSnapshot?.();
    const store = storeStatus?.();
    res.json({
      ...conversation.snapshot(),
      ...(presence ? { presence: presence.snapshot() } : {}),
      ...(store ? { store } : {}),
    });
  });

  app.get('/api/conversation/events', async (req, res) => {
    const after = req.query.after;
    const wait = req.query.wait ?? '25000';
    const listener = req.query.listener;
    if (
      (after !== undefined && typeof after !== 'string') ||
      typeof wait !== 'string' ||
      !/^\d+$/.test(wait) ||
      Number(wait) > 25000 ||
      (listener !== undefined && (typeof listener !== 'string' || !/^[\w-]{1,100}$/.test(listener)))
    ) {
      res
        .status(400)
        .json({ error: 'Expected an optional after cursor and wait from 0 to 25000 milliseconds' });
      return;
    }
    const abort = new AbortController();
    const disconnect = () => abort.abort();
    res.on('close', disconnect);
    let releaseListener: (() => void) | undefined;
    try {
      const batch = conversation.read(after);
      if (!batch.events.length && Number(wait) > 0 && typeof listener === 'string')
        releaseListener = presence?.connectListener(listener);
      const result = batch.events.length
        ? batch
        : await conversation.wait(batch.cursor, Number(wait), abort.signal);
      if (!abort.signal.aborted)
        res.json({ ...result, ...(presence ? { presence: presence.snapshot() } : {}) });
    } catch (error) {
      if (!(error instanceof ConversationCursorError)) throw error;
      if (!abort.signal.aborted) res.status(409).json({ error: error.message });
    } finally {
      releaseListener?.();
      res.off('close', disconnect);
    }
  });

  app.post('/api/conversation/status', (req, res) => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Status updates require application/json' });
      return;
    }
    const input = req.body as Record<string, unknown> | null;
    if (
      !input ||
      typeof input.reviewId !== 'string' ||
      typeof input.threadId !== 'string' ||
      typeof input.messageId !== 'string' ||
      typeof input.cursor !== 'string' ||
      typeof input.status !== 'string' ||
      !['delivered', 'read', 'thinking', 'replying', 'noted'].includes(input.status)
    ) {
      res.status(400).json({
        error:
          'Expected reviewId, threadId, messageId, cursor, and status (delivered, read, thinking, replying, noted)',
      });
      return;
    }
    try {
      const selection = conversation.setProgress(
        input.reviewId,
        input.threadId,
        input.messageId,
        input.cursor,
        input.status as CommentProgress['status'],
      );
      if (selection) progressChanged(selection);
      res.json({ success: true });
    } catch (error) {
      if (!(error instanceof ProgressError)) throw error;
      res.status(error.status).json({ error: error.message });
    }
  });

  app.post('/api/conversation/reply', (req, res) => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Replies require application/json' });
      return;
    }
    const input = req.body as Record<string, unknown> | null;
    if (
      !input ||
      typeof input !== 'object' ||
      typeof input.reviewId !== 'string' ||
      typeof input.threadId !== 'string' ||
      typeof input.inReplyTo !== 'string' ||
      typeof input.body !== 'string' ||
      !input.body.trim() ||
      (input.cursor !== undefined && typeof input.cursor !== 'string') ||
      (input.author !== undefined && (typeof input.author !== 'string' || !input.author.trim()))
    ) {
      res.status(400).json({
        error: 'Expected reviewId, threadId, inReplyTo, body, and optional cursor and author',
      });
      return;
    }
    const review = conversation.findReview(input.reviewId);
    const thread = review?.threads.find((candidate) => candidate.id === input.threadId);
    if (!review || !thread || !thread.messages.some((message) => message.id === input.inReplyTo)) {
      res.status(404).json({ error: 'Review, thread, or parent message no longer exists' });
      return;
    }
    const progress = review.progress.get(JSON.stringify([thread.id, input.inReplyTo]));
    if (input.cursor !== undefined && progress?.cursor !== input.cursor) {
      res.status(409).json({ error: 'Comment changed; read its latest event or snapshot' });
      return;
    }
    // Retrying a reply after a lost HTTP response must not duplicate the answer.
    const author = typeof input.author === 'string' ? input.author.trim() : 'Agent';
    const id = createHash('sha256')
      .update(
        JSON.stringify([
          review.id,
          thread.id,
          input.inReplyTo,
          input.body,
          author,
          ...(input.cursor ? [input.cursor] : []),
        ]),
      )
      .digest('hex');
    if (!thread.messages.some((message) => message.id === id)) {
      const now = new Date().toISOString();
      const message = {
        id,
        body: input.body,
        origin: 'agent' as const,
        author,
        createdAt: now,
        updatedAt: now,
      };
      update(
        review.selection,
        review.threads.map((candidate) =>
          candidate.id === thread.id
            ? { ...candidate, updatedAt: now, messages: [...candidate.messages, message] }
            : candidate,
        ),
      );
    }
    // Only revision-aware replies can attest that the current wording was answered.
    if (
      progress &&
      input.cursor === progress.cursor &&
      conversation.setProgress(review.id, thread.id, input.inReplyTo, progress.cursor, 'replied')
    )
      progressChanged(review.selection);
    res.json({ success: true, reviewId: review.id, threadId: thread.id, messageId: id });
  });
}
