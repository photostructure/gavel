import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, isIP } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import type { ConversationSnapshot, ConversationStreamEvent } from '../types/conversation.js';
import type { DiffSelection } from '../types/diff.js';
import type { InboxDelivery } from '../types/presence.js';

import {
  codexTargetFromEnv,
  parseCodexTarget,
  sendToCodex,
  type CodexQueueTarget,
  type QueueReceipt,
} from './codex-queue.js';

/** A Claude Code session's cross-session inbox, from the environment of a process it started. */
interface ClaudeInboxTarget {
  kind?: 'claude';
  sessionId: string;
  socket: string;
  token?: string;
}

export type InboxTarget = ClaudeInboxTarget | CodexQueueTarget;

// A verdict waits this long so verdicts clicked in quick succession arrive as one message.
export const INBOX_SETTLE_MS = 2_000;
// Comments alone wait this long after the reviewer's last one, so a post and a quick edit, or
// comments typed back to back, wake the agent once. Comments closer together than this keep
// delaying the message.
export const INBOX_QUIET_MS = 5_000;
// Above this, the message names the snapshot command instead of carrying the events.
const MAX_EVENTS_CHARS = 50_000;
const SEND_TIMEOUT_MS = 5_000;
const SESSION_ID = /^[\w-]{1,100}$/;

export function inboxTargetFromEnv(env: NodeJS.ProcessEnv): InboxTarget | undefined {
  const sessionId = env.CLAUDE_CODE_SESSION_ID;
  const socket = env.CLAUDE_CODE_MESSAGING_SOCKET;
  if (!sessionId || !socket || !SESSION_ID.test(sessionId)) return codexTargetFromEnv(env);
  const token = env.CLAUDE_CODE_MESSAGING_TOKEN;
  return { sessionId, socket, ...(token ? { token } : {}) };
}

/**
 * The user's runtime directory, under which servers list the sessions they deliver to. Without
 * XDG_RUNTIME_DIR it is a per-user directory in the shared temporary directory.
 */
export function inboxRuntimeDir(env: NodeJS.ProcessEnv): string {
  return env.XDG_RUNTIME_DIR || join(tmpdir(), `gavel-${process.getuid?.() ?? 'user'}`);
}

export function registryRoot(runtimeDir: string): string {
  return join(runtimeDir, 'gavel');
}

/**
 * Checks that only this user can change a directory, creating it if asked. Another user who
 * could write the registry could point gavel pending, and the inbox token it sends, at a server
 * of theirs. Returns false when the directory is absent and was not to be created.
 */
export function privateDirectory(dir: string, create: boolean): boolean {
  if (create) mkdirSync(dir, { recursive: true, mode: 0o700 });
  let stat;
  try {
    stat = lstatSync(dir);
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  const uid = process.getuid?.();
  if (!stat.isDirectory() || (uid !== undefined && (stat.uid !== uid || stat.mode & 0o022)))
    throw new Error(`${dir} must be a directory you own that other users cannot write (chmod 700)`);
  return true;
}

/** An inbox named in a request body: undefined when it is malformed. */
export function parseInboxTarget(input: unknown): InboxTarget | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  if (record.kind === 'codex') return parseCodexTarget(record);
  const { kind, sessionId, socket, token } = record;
  if (kind !== undefined && kind !== 'claude') return undefined;
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return undefined;
  if (typeof socket !== 'string' || !isAbsolute(socket)) return undefined;
  if (token !== undefined && typeof token !== 'string') return undefined;
  return { sessionId, socket, ...(token ? { token } : {}) };
}

/**
 * Whether a request came from this machine. An inbox is a local socket, and only a process on
 * this machine can name a session's real one; the server may also listen on a LAN address.
 */
export function isThisHost(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (!isIP(ip)) return false;
  if (ip === '::1' || ip.startsWith('127.')) return true;
  return Object.values(networkInterfaces()).some((entries) =>
    entries?.some((entry) => entry.address === ip),
  );
}

/**
 * Queues a Codex notification, or delivers to a Claude Code inbox: an auth line, then a message whose
 * session_id makes Claude Code drop it if another session now owns the socket. Claude Code sends
 * no reply, so success means the inbox accepted the bytes, not that the model read them.
 */
export function sendToInbox(target: InboxTarget, content: string): Promise<void | QueueReceipt> {
  if (target.kind === 'codex') return sendToCodex(target, content);
  return new Promise((resolve, reject) => {
    const connection = createConnection(target.socket);
    connection.setTimeout(SEND_TIMEOUT_MS, () =>
      connection.destroy(new Error(`inbox ${target.socket} did not accept the message in time`)),
    );
    connection.once('error', reject);
    connection.once('connect', () => {
      if (target.token)
        connection.write(`${JSON.stringify({ type: 'auth', token: target.token })}\n`);
      connection.end(
        `${JSON.stringify({ type: 'user', from: 'gavel', session_id: target.sessionId, message: { content } })}\n`,
      );
    });
    connection.once('close', (hadError) => {
      if (!hadError) resolve();
    });
  });
}

type SnapshotReview = ConversationSnapshot['reviews'][number];

// Queued events no message has carried, oldest first; the queue is in generation order.
function unsent(review: ReviewActivity): QueuedEvent[] {
  return review.queue.filter((queued) => queued.generation > (review.delivered?.generation ?? 0));
}

function verdictLabel(review: SnapshotReview): string {
  switch (review.approval.verdict) {
    // The receiving agent may not have the gavel skill loaded, so say what Approve asks for.
    case 'approve':
      return 'Approve: address every current comment, then commit once the required checks and reviews pass';
    case 'reject':
      return 'Reject';
    case undefined:
      return 'no verdict';
  }
}

function reviewLabel({ reviewName, baseCommitish, targetCommitish }: DiffSelection): string {
  return reviewName ?? `${baseCommitish}..${targetCommitish}`;
}

// The fields an agent acts on: IDs and the revision cursor to reply with, what the reviewer said,
// and the code they saw, which a frozen capture's working file may no longer match. Digests,
// captures, and authorship stay out; the agent reads a fresh snapshot to commit.
function agentEvent(event: ConversationStreamEvent): Record<string, unknown> {
  const review = { review: reviewLabel(event.selection), reviewId: event.reviewId };
  switch (event.type) {
    case 'review.approval':
      return { type: event.type, ...review, verdict: event.approval?.verdict ?? null };
    case 'comment.created':
    case 'comment.updated': {
      const { threadId, messageId, cursor, intent, body, file, side, line, codeSnapshot } = event;
      return {
        type: event.type,
        ...review,
        threadId,
        messageId,
        cursor,
        intent,
        body,
        file,
        side,
        line,
        code: codeSnapshot?.content,
      };
    }
    default:
      throw new Error(`gavel queued an event it does not send: ${event.type}`);
  }
}

// Messages the agent has neither answered nor marked Noted.
function awaitingAnswer(review: SnapshotReview): number {
  return review.threads
    .flatMap((thread) => thread.messages)
    .filter(
      (message) => message.progress && !['replied', 'noted'].includes(message.progress.status),
    ).length;
}

// A human event waiting for a message; comments keep their identity so a newer version, or the
// comment's deletion, replaces or removes it. A verdict has no thread.
interface QueuedEvent {
  generation: number;
  threadId?: string;
  messageId?: string;
  event: ConversationStreamEvent;
}

// One review's human activity, counted so that a send finishing late never claims newer events.
interface ReviewActivity {
  generation: number;
  // Human events no message has carried yet, in generation order. A newer verdict, or a newer
  // version of the same comment, replaces the queued one.
  queue: QueuedEvent[];
  // The newest generation a message carried, and how.
  delivered?: {
    generation: number;
    at: string;
    receipt: QueueReceipt | { status: 'sent'; via: 'inbox' | 'prompt' };
  };
  // The generation a send carrying it is still waiting on.
  inFlight?: number;
  failed?: { generation: number; at: string; error: string };
}

interface Schedule {
  timer: NodeJS.Timeout;
  due: number;
  // A verdict set the deadline; later comments must not push it back.
  verdict: boolean;
}

/**
 * Sends human review activity to the agent session that owns each review, so an idle
 * agent starts a turn without a waiter. Only human-origin verdicts and comments
 * trigger a message; agent activity never does, so agents cannot wake each other in a loop.
 */
export class SessionInbox {
  private readonly owners = new Map<string, string | null>();
  private readonly targets = new Map<string, InboxTarget>();
  private defaultOwner: string | undefined;
  private readonly activity = new Map<string, ReviewActivity>();
  private readonly schedules = new Map<string, Schedule>();
  private readonly registered = new Set<string>();
  private readonly flushing = new Set<Promise<void>>();
  private readonly codexSends = new Map<string, Promise<void>>();
  private disposed = false;

  constructor(
    private readonly options: {
      snapshot: () => ConversationSnapshot;
      server: { host: string; port: number; pid: number };
      runtimeDir: string;
      send?: (target: InboxTarget, content: string) => Promise<void | QueueReceipt>;
      // Called after any review's delivery state changes, so browsers can refresh it.
      onDeliveryChange?: () => void;
    },
  ) {}

  /** The owner of reviews nobody created with an explicit owner: the launching session. */
  setDefaultOwner(target: InboxTarget): void {
    this.defaultOwner = target.sessionId;
    this.addTarget(target);
  }

  /** null records that the review's creator had no inbox, so the default owner must not get it. */
  setOwner(reviewId: string, target: InboxTarget | null): void {
    this.owners.set(reviewId, target?.sessionId ?? null);
    if (target) this.addTarget(target);
    // An open tab showing this review learns whether it notifies a session.
    this.options.onDeliveryChange?.();
  }

  owns(sessionId: string): boolean {
    return this.targets.has(sessionId);
  }

  /**
   * Points an owning session's reviews at its current inbox, which changes when the session
   * restarts, and returns the activity whose send failed, which counts as delivered now. A send
   * still in flight to the old inbox resends to this one if it fails.
   */
  attach(target: InboxTarget): string | undefined {
    if (!this.owns(target.sessionId)) return undefined;
    this.addTarget(target);
    const failed = this.reviewsOf(target.sessionId).filter(
      ([id]) => this.delivery(id).status === 'failed',
    );
    if (!failed.length) return undefined;
    const content = this.message(failed);
    const at = new Date().toISOString();
    for (const [, review] of failed) {
      const generation = unsent(review).at(-1)?.generation ?? review.generation;
      review.delivered = { generation, at, receipt: { status: 'sent', via: 'prompt' } };
      review.queue = review.queue.filter((queued) => queued.generation > generation);
    }
    this.options.onDeliveryChange?.();
    return content;
  }

  delivery(reviewId: string): InboxDelivery {
    const owner = this.ownerOf(reviewId);
    if (!owner) return { status: 'unavailable' };
    const transport =
      this.targets.get(owner)?.kind === 'codex' ? { transport: 'queue' as const } : {};
    const ready: InboxDelivery = { status: 'ready', ...transport };
    const review = this.activity.get(reviewId);
    if (!review) return ready;
    const newest = unsent(review).at(-1)?.generation;
    if (newest === undefined)
      return review.delivered
        ? { ...review.delivered.receipt, at: review.delivered.at, ...transport }
        : ready;
    if (review.inFlight === undefined && review.failed && review.failed.generation >= newest)
      return { status: 'failed', at: review.failed.at, error: review.failed.error, ...transport };
    return { status: 'pending', ...transport };
  }

  handle(event: ConversationStreamEvent): void {
    if (this.disposed) return;
    // An agent deleted the review; its comments now take no replies or receipts.
    if (event.type === 'review.deleted') {
      if (this.activity.delete(event.reviewId)) this.options.onDeliveryChange?.();
      return;
    }
    if (event.origin !== 'user') return;
    if (event.type === 'comment.deleted' || event.type === 'thread.deleted') {
      this.withdraw(event);
      return;
    }
    const verdict = event.type === 'review.approval';
    if (!verdict && event.type !== 'comment.created' && event.type !== 'comment.updated') return;
    const owner = this.ownerOf(event.reviewId);
    if (!owner) return;
    const review = this.activity.get(event.reviewId) ?? { generation: 0, queue: [] };
    review.generation += 1;
    const comment = verdict ? undefined : { threadId: event.threadId, messageId: event.messageId };
    review.queue = review.queue.filter((queued) =>
      comment
        ? queued.threadId !== comment.threadId || queued.messageId !== comment.messageId
        : queued.threadId !== undefined,
    );
    review.queue.push({ generation: review.generation, ...comment, event });
    this.activity.set(event.reviewId, review);
    this.options.onDeliveryChange?.();
    const now = Date.now();
    const scheduled = this.schedules.get(owner);
    // A verdict never waits for the comment quiet period; a comment never delays a due verdict.
    const due = verdict
      ? Math.min(scheduled?.due ?? Infinity, now + INBOX_SETTLE_MS)
      : scheduled?.verdict
        ? scheduled.due
        : now + INBOX_QUIET_MS;
    const verdictDue = verdict || (scheduled?.verdict ?? false);
    if (scheduled?.due === due) {
      scheduled.verdict = verdictDue;
      return;
    }
    clearTimeout(scheduled?.timer);
    const timer = setTimeout(() => void this.run(owner), due - now);
    timer.unref?.();
    this.schedules.set(owner, { timer, due, verdict: verdictDue });
  }

  /**
   * Drops queued comments the reviewer deleted before any message carried them. A review left
   * with nothing unsent reads as sent if a message reached the agent before, otherwise ready.
   */
  private withdraw(event: ConversationStreamEvent & { threadId: string }): void {
    const review = this.activity.get(event.reviewId);
    if (!review) return;
    const messageId = 'messageId' in event ? event.messageId : undefined;
    review.queue = review.queue.filter(
      (queued) =>
        queued.threadId !== event.threadId ||
        (messageId !== undefined && queued.messageId !== messageId),
    );
    this.options.onDeliveryChange?.();
  }

  /**
   * Sends scheduled activity now and waits for every send, so a server about to exit does not
   * drop a verdict still in its settle delay.
   */
  async drain(): Promise<void> {
    await Promise.all([...[...this.schedules.keys()].map((id) => this.run(id)), ...this.flushing]);
  }

  dispose(): void {
    this.disposed = true;
    for (const schedule of this.schedules.values()) clearTimeout(schedule.timer);
    this.schedules.clear();
    for (const sessionId of this.registered) rmSync(this.registryFile(sessionId), { force: true });
    this.registered.clear();
  }

  private ownerOf(reviewId: string): string | undefined {
    const owner = this.owners.get(reviewId);
    return owner === null ? undefined : (owner ?? this.defaultOwner);
  }

  private reviewsOf(sessionId: string): [string, ReviewActivity][] {
    return [...this.activity].filter(([id]) => this.ownerOf(id) === sessionId);
  }

  private addTarget(target: InboxTarget): void {
    this.targets.set(target.sessionId, target);
    if (this.registered.has(target.sessionId) || this.disposed) return;
    const { host, port, pid } = this.options.server;
    // Another user owning the runtime directory could replace the registry inside it.
    privateDirectory(this.options.runtimeDir, true);
    privateDirectory(registryRoot(this.options.runtimeDir), true);
    const file = this.registryFile(target.sessionId);
    mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ host, port, pid }), { mode: 0o600 });
    this.registered.add(target.sessionId);
  }

  private registryFile(sessionId: string): string {
    const { host, port } = this.options.server;
    // Servers may share a port on different addresses.
    return join(
      registryRoot(this.options.runtimeDir),
      'sessions',
      sessionId,
      `${host.replace(/[^\w.-]/g, '_')}_${port}.json`,
    );
  }

  private run(sessionId: string): Promise<void> {
    // Keep one queue command at a time per thread. Activity accumulating during a slow
    // write coalesces into the next notification instead of spawning concurrent CLI processes.
    const previous = this.codexSends.get(sessionId);
    const work = previous ? previous.then(() => this.flush(sessionId)) : this.flush(sessionId);
    const flushed = work.finally(() => {
      this.flushing.delete(flushed);
      if (this.codexSends.get(sessionId) === flushed) this.codexSends.delete(sessionId);
    });
    if (this.targets.get(sessionId)?.kind === 'codex') this.codexSends.set(sessionId, flushed);
    this.flushing.add(flushed);
    return flushed;
  }

  private async flush(sessionId: string): Promise<void> {
    // A resend after a reattach also carries activity a timer was waiting on.
    clearTimeout(this.schedules.get(sessionId)?.timer);
    this.schedules.delete(sessionId);
    const target = this.targets.get(sessionId);
    if (!target || this.disposed) return;
    // Every review with activity no message carried and no send is carrying, failed ones included.
    const sending = this.reviewsOf(sessionId).flatMap(([id, review]) => {
      const generation = unsent(review).at(-1)?.generation;
      return generation !== undefined && generation > (review.inFlight ?? 0)
        ? [{ id, review, generation }]
        : [];
    });
    if (!sending.length) return;
    for (const { review, generation } of sending) review.inFlight = generation;
    const content = this.message(
      sending.map(({ id, review }) => [id, review] as const),
      target.kind === 'codex',
    );
    let error: string | undefined;
    let receipt: QueueReceipt | { status: 'sent'; via: 'inbox' } = { status: 'sent', via: 'inbox' };
    try {
      receipt = (await (this.options.send ?? sendToInbox)(target, content)) ?? {
        status: 'sent',
        via: 'inbox',
      };
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const at = new Date().toISOString();
    for (const { review, generation } of sending) {
      if (review.inFlight === generation) review.inFlight = undefined;
      const delivered = review.delivered?.generation ?? 0;
      if (error === undefined) {
        if (generation > delivered) review.delivered = { generation, at, receipt };
        review.queue = review.queue.filter((queued) => queued.generation > generation);
      } else if (generation > Math.max(delivered, review.failed?.generation ?? 0)) {
        review.failed = { generation, at, error };
      }
    }
    this.options.onDeliveryChange?.();
    // The session reattached while this send used its old inbox: carry the activity to the new one.
    if (error !== undefined && this.targets.get(sessionId) !== target && !this.disposed)
      await this.flush(sessionId);
  }

  /** Each review's one-line state, then the human events no message has carried yet. */
  private message(
    entries: readonly (readonly [string, ReviewActivity])[],
    forCodex = false,
  ): string {
    const snapshot = this.options.snapshot();
    const { host, port } = this.options.server;
    const command = `gavel comment snapshot --host ${host} --port ${port}`;
    const scope = `Review IDs: ${JSON.stringify(entries.map(([id]) => id))}. Do not act on other reviews in the snapshot.`;
    const lines = entries.flatMap(([id]) => {
      const review = snapshot.reviews.find((candidate) => candidate.id === id);
      if (!review) return [];
      const awaiting = awaitingAnswer(review);
      const pending = awaiting
        ? `; ${awaiting} message${awaiting === 1 ? '' : 's'} awaiting an answer`
        : '';
      return [`- ${reviewLabel(review.selection)}: ${verdictLabel(review)}${pending}`];
    });
    const events = JSON.stringify(
      entries.flatMap(([, review]) => unsent(review).map((queued) => agentEvent(queued.event))),
    );
    const message = [
      `gavel: new review activity at http://${host.includes(':') ? `[${host}]` : host}:${port}`,
      ...(forCodex ? [scope] : []),
      ...lines,
      ...(snapshot.store?.error
        ? [`Review changes are not being saved: ${snapshot.store.error}`]
        : []),
      '',
      'This message reports activity; it is not an approval by itself. Handle it as the gavel skill directs: answer or mark Noted each pending message, and before committing read a fresh',
      `\`${command}\` (using the gavel launcher this checkout prescribes) and check its approval.`,
      '',
      forCodex || events.length <= MAX_EVENTS_CHARS
        ? `Your human events since the last message (each comment's cursor is its revision for receipts and replies; read the snapshot for a thread's earlier messages, and a fresh one before acting on a verdict):\n${events}`
        : "The new events are too large to include; read that command's output.",
    ].join('\n');
    return message;
  }
}
