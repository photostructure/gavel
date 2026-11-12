import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { promises as fsPromises } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

import { fetch } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ConversationBatch,
  ConversationSnapshot,
  ReviewApproval,
} from '../types/conversation.js';
import type { DiffCommentMessage, DiffCommentThread } from '../types/diff.js';
import type { ReviewCapture } from '../types/review.js';
import type { ReviewOpsResponse } from '../types/reviewOps.js';
import { createDiffSelection } from '../utils/diffSelection.js';

import { FileWatcherService } from './file-watcher.js';
import { GitDiffParser } from './git-diff.js';
import { captureWorkingTree } from './review-capture.js';
import { ReviewStore, type SavedReview } from './review-store.js';
import { startServer } from './server.js';

const now = '2026-11-08T12:00:00.000Z';
const later = '2026-11-08T13:00:00.000Z';
const NAME = 'task';

function thread(id: string, body = 'Keep this comment.'): DiffCommentThread {
  return {
    id,
    filePath: 'first.txt',
    position: { side: 'new', line: 1 },
    codeSnapshot: { content: 'captured first' },
    createdAt: now,
    updatedAt: now,
    messages: [{ id, body, createdAt: now, updatedAt: now }],
  };
}

function reply(id: string, body = 'A reply.'): DiffCommentMessage {
  return { id, body, createdAt: later, updatedAt: later };
}

const addThread = (id: string, opId = `add-${id}`) => ({
  id: opId,
  type: 'thread.add',
  thread: thread(id),
});

describe('POST /api/review-ops', () => {
  let root: string;
  let capture: ReviewCapture;
  let running: Awaited<ReturnType<typeof startServer>> | undefined;

  function git(...args: string[]): string {
    return execFileSync(
      'git',
      [
        '-c',
        'user.name=gavel',
        '-c',
        'user.email=gavel@example.com',
        '-c',
        'commit.gpgsign=false',
        '-c',
        `core.hooksPath=${devNull}`,
        ...args,
      ],
      {
        cwd: root,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
          ),
          GIT_CONFIG_GLOBAL: devNull,
          GIT_CONFIG_SYSTEM: devNull,
        },
        encoding: 'utf8',
      },
    );
  }

  function url(path: string): URL {
    if (!running) throw new Error('Fixture server has not started');
    return new URL(path, running.url);
  }

  async function request<T>(
    path: string,
    body?: unknown,
    status = 200,
    method = 'POST',
  ): Promise<T> {
    const response = await fetch(url(path), {
      ...(body === undefined
        ? {}
        : {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    // A route that does not exist answers with HTML, so the status is checked before parsing.
    const text = await response.text();
    expect(response.status, text).toBe(status);
    return JSON.parse(text) as T;
  }

  async function startNamed(options: Partial<Parameters<typeof startServer>[0]> = {}) {
    running = await startServer({
      namedReview: { name: NAME, capture },
      repoPath: root,
      preferredPort: 0,
      openBrowser: false,
      keepAlive: true,
      shipIt: true,
      conversation: true,
      ...options,
    });
  }

  async function restart(options: Partial<Parameters<typeof startServer>[0]> = {}) {
    await running?.shutdown('closed');
    running = undefined;
    await startNamed(options);
  }

  const repositoryId = async () =>
    (await request<{ repositoryId: string }>(`/api/diff?review=${NAME}`)).repositoryId;

  const send = async (ops: unknown[], query = `?review=${NAME}`) =>
    request<ReviewOpsResponse>(`/api/review-ops${query}`, {
      repositoryId: await repositoryId(),
      ops,
    });

  const cursor = async () =>
    (await request<ConversationSnapshot>('/api/conversation/snapshot')).cursor;

  async function eventsAfter(after: string) {
    const { events } = await request<ConversationBatch>(
      `/api/conversation/events?wait=0&after=${encodeURIComponent(after)}`,
    );
    return events;
  }

  const eventTypes = async (after: string) => (await eventsAfter(after)).map(({ type }) => type);

  const savedRecordPaths = () =>
    readdirSync(join(root, '.git', 'gavel', 'reviews'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(root, '.git', 'gavel', 'reviews', name));

  async function approve() {
    const review = await request<{ version: number; patchDigest: string }>(`/api/reviews/${NAME}`);
    return request<ReviewApproval>(
      `/api/approval?review=${NAME}`,
      {
        verdict: 'approve',
        captureVersion: review.version,
        patchDigest: review.patchDigest,
        summaryVersion: 0,
      },
      200,
      'PUT',
    );
  }

  const approval = () => request<ReviewApproval>(`/api/approval?review=${NAME}`);

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-review-ops-')));
    git('init', '--quiet');
    writeFileSync(join(root, 'first.txt'), 'before first\n');
    git('add', 'first.txt');
    git('commit', '--quiet', '--no-verify', '-m', 'fixture');
    writeFileSync(join(root, 'first.txt'), 'captured first\n');
    capture = await captureWorkingTree({ cwd: root, pathspecs: ['first.txt'] });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await running?.shutdown('closed');
    running = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  describe('operations', () => {
    it('applies each comment op in order and emits its events in that order', async () => {
      await startNamed();
      const before = await cursor();

      const response = await send([
        addThread('t1'),
        { id: 'reply', type: 'message.add', threadId: 't1', message: reply('m2') },
        {
          id: 'edit',
          type: 'message.edit',
          threadId: 't1',
          messageId: 'm2',
          body: 'Edited reply.',
          at: later,
        },
        { id: 'resolve', type: 'thread.resolve', threadId: 't1', resolved: true, at: later },
        { id: 'reopen', type: 'thread.resolve', threadId: 't1', resolved: false, at: later },
        { id: 'drop-reply', type: 'message.delete', threadId: 't1', messageId: 'm2' },
        { id: 'drop-thread', type: 'thread.delete', threadId: 't1' },
      ]);

      expect(response.results).toEqual(
        ['add-t1', 'reply', 'edit', 'resolve', 'reopen', 'drop-reply', 'drop-thread'].map((id) => ({
          id,
          status: 'applied',
        })),
      );
      expect(response.threads).toEqual([]);
      expect(await eventTypes(before)).toEqual([
        'comment.created',
        'comment.created',
        'comment.updated',
        'thread.resolved',
        'thread.reopened',
        'comment.deleted',
        'thread.deleted',
      ]);
    });

    it('returns the version and threads after the batch, with server-owned progress', async () => {
      await startNamed();
      const first = await send([addThread('t1')]);
      expect(first.version).toBe(1);

      const second = await send([
        { id: 'reply', type: 'message.add', threadId: 't1', message: reply('m2') },
        { id: 'resolve', type: 'thread.resolve', threadId: 't1', resolved: true, at: later },
      ]);

      expect(second.version).toBe(3);
      expect(second.threads).toHaveLength(1);
      expect(second.threads[0]?.messages.map((item) => item.id)).toEqual(['t1', 'm2']);
      expect(second.threads[0]?.messages[0]?.progress?.status).toBe('queued');
      expect(second.threads[0]?.resolution).toEqual({ resolved: true, updatedAt: later });
      expect(second.threads[0]?.updatedAt).toBe(later);
      expect(second.threads).toEqual(
        (await request<{ threads: DiffCommentThread[] }>(`/api/comments-json?review=${NAME}`))
          .threads,
      );
    });

    it('orders its answers and comment reads by a cursor that progress also advances', async () => {
      await startNamed();
      type Snapshot = { version: number; cursor: string; threads: DiffCommentThread[] };
      const read = () => request<Snapshot>(`/api/comments-json?review=${NAME}`);
      const sequence = ({ cursor }: Snapshot) => Number(cursor.split(':')[1]);
      const answer = (await send([addThread('t1')])) as ReviewOpsResponse & Snapshot;
      const queued = await read();
      const { reviews } = await request<ConversationSnapshot>('/api/conversation/snapshot');
      const progress = (status: string) =>
        request(`/api/conversation/status`, {
          reviewId: reviews[0]!.id,
          threadId: 't1',
          messageId: 't1',
          cursor: queued.threads[0]!.messages[0]!.progress!.cursor,
          status,
        });

      await progress('thinking');
      const thinking = await read();
      await progress('noted');
      const noted = await read();

      expect(answer.cursor).toBe(queued.cursor);
      expect([thinking, noted].map(({ version }) => version)).toEqual([
        queued.version,
        queued.version,
      ]);
      expect(thinking.cursor.split(':')[0]).toBe(queued.cursor.split(':')[0]);
      expect(sequence(thinking)).toBeGreaterThan(sequence(queued));
      expect(sequence(noted)).toBeGreaterThan(sequence(thinking));
      expect(noted.threads[0]!.messages[0]!.progress!.status).toBe('noted');
    });

    it('edits a message as the browser does, and a first-message intent sets isQuestion', async () => {
      await startNamed();
      await send([addThread('t1')]);

      const { threads } = await send([
        {
          id: 'edit',
          type: 'message.edit',
          threadId: 't1',
          messageId: 't1',
          body: 'Why?',
          intent: 'question',
          at: later,
        },
      ]);

      expect(threads[0]).toMatchObject({ isQuestion: true, updatedAt: later });
      expect(threads[0]?.messages[0]).toMatchObject({
        body: 'Why?',
        intent: 'question',
        origin: 'user',
        updatedAt: later,
      });
    });

    it('appends without placement and honors followingIds and precedingIds', async () => {
      await startNamed();
      await send([addThread('a'), addThread('c')]);

      const placedThreads = await send([
        { ...addThread('b'), followingIds: ['c'] },
        { ...addThread('d'), precedingIds: ['c'] },
        addThread('e'),
      ]);
      expect(placedThreads.threads.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd', 'e']);

      const placedMessages = await send([
        { id: 'r3', type: 'message.add', threadId: 'a', message: reply('m3') },
        {
          id: 'r2',
          type: 'message.add',
          threadId: 'a',
          message: reply('m2'),
          followingIds: ['m3'],
        },
      ]);
      expect(placedMessages.threads[0]?.messages.map(({ id }) => id)).toEqual(['a', 'm2', 'm3']);
    });

    it('deletes the whole thread when its first message is deleted, as the browser does', async () => {
      await startNamed();
      await send([
        addThread('t1'),
        { id: 'reply', type: 'message.add', threadId: 't1', message: reply('m2') },
      ]);
      const before = await cursor();

      const { threads, results } = await send([
        { id: 'drop-root', type: 'message.delete', threadId: 't1', messageId: 't1' },
      ]);

      expect(results).toEqual([{ id: 'drop-root', status: 'applied' }]);
      expect(threads).toEqual([]);
      expect(await eventTypes(before)).toEqual(['thread.deleted']);
    });

    it('stamps a new thread of a named review with its capture', async () => {
      await startNamed();
      const { threads } = await send([addThread('t1')]);
      expect(threads[0]?.capture).toEqual({ version: 1, patchDigest: capture.patchDigest });
    });

    it('rejects a new thread anchored to a capture the server does not hold', async () => {
      await startNamed();
      const before = await cursor();

      const { results, threads } = await send([
        {
          id: 'stale',
          type: 'thread.add',
          thread: { ...thread('t1'), capture: { version: 99, patchDigest: 'missing' } },
        },
      ]);

      expect(results).toEqual([
        { id: 'stale', status: 'rejected', error: 'Comment capture is unavailable' },
      ]);
      expect(threads).toEqual([]);
      expect(await eventTypes(before)).toEqual([]);
    });

    it('counts deleting something already gone as applied', async () => {
      await startNamed();
      await send([addThread('t1')]);
      const before = await cursor();

      const { results } = await send([
        { id: 'gone-thread', type: 'thread.delete', threadId: 'missing' },
        { id: 'gone-parent', type: 'message.delete', threadId: 'missing', messageId: 'm1' },
        { id: 'gone-message', type: 'message.delete', threadId: 't1', messageId: 'missing' },
      ]);

      expect(results.map(({ status }) => status)).toEqual(['applied', 'applied', 'applied']);
      expect(await eventTypes(before)).toEqual([]);
    });

    it('rejects a reply, edit or resolve against a deleted thread or message', async () => {
      await startNamed();
      await send([addThread('t1')]);
      const before = await cursor();

      const { results, threads } = await send([
        { id: 'reply', type: 'message.add', threadId: 'missing', message: reply('m2') },
        {
          id: 'edit-thread',
          type: 'message.edit',
          threadId: 'missing',
          messageId: 'm1',
          body: 'x',
          at: later,
        },
        {
          id: 'edit-message',
          type: 'message.edit',
          threadId: 't1',
          messageId: 'missing',
          body: 'x',
          at: later,
        },
        { id: 'resolve', type: 'thread.resolve', threadId: 'missing', resolved: true, at: later },
      ]);

      expect(results.map(({ status }) => status)).toEqual([
        'rejected',
        'rejected',
        'rejected',
        'rejected',
      ]);
      expect(results.every(({ error }) => typeof error === 'string' && error.length > 0)).toBe(
        true,
      );
      expect(threads.map(({ id }) => id)).toEqual(['t1']);
      expect(await eventTypes(before)).toEqual([]);
    });

    it('rejects one malformed or unknown op while the rest of the batch applies', async () => {
      await startNamed();

      const { results, threads } = await send([
        { id: 'unknown', type: 'files.viewed', records: [] },
        { id: 'no-thread', type: 'thread.add' },
        { id: 'no-body', type: 'message.edit', threadId: 't1', messageId: 't1', at: later },
        {
          id: 'no-position',
          type: 'thread.add',
          thread: { id: 'x', createdAt: now, updatedAt: now, messages: [reply('x')] },
        },
        addThread('t1'),
      ]);

      expect(results.map(({ status }) => status)).toEqual([
        'rejected',
        'rejected',
        'rejected',
        'rejected',
        'applied',
      ]);
      expect(threads.map(({ id }) => id)).toEqual(['t1']);
    });

    it('announces commentsChanged once for a batch of several changes', async () => {
      await startNamed();
      const broadcast = vi.spyOn(FileWatcherService.prototype, 'broadcast');

      const { version } = await send([addThread('a'), addThread('b'), addThread('c')]);

      expect(
        broadcast.mock.calls.filter(([event]) => event.type === 'commentsChanged').map(([e]) => e),
      ).toEqual([expect.objectContaining({ type: 'commentsChanged', version })]);
    });

    it('does not announce commentsChanged for a batch that changes nothing', async () => {
      await startNamed();
      const broadcast = vi.spyOn(FileWatcherService.prototype, 'broadcast');

      await send([{ id: 'gone', type: 'thread.delete', threadId: 'missing' }]);

      expect(broadcast.mock.calls.filter(([event]) => event.type === 'commentsChanged')).toEqual(
        [],
      );
    });

    it('keeps approval on a new user comment, which the agent addresses before committing', async () => {
      await startNamed();
      expect((await approve()).verdict).toBe('approve');

      await send([addThread('t1')]);

      expect((await approval()).verdict).toBe('approve');
    });
  });

  describe('verdicts', () => {
    async function setVerdict(verdict: string, bindings: Record<string, unknown> = {}) {
      const review = await request<{ version: number; patchDigest: string }>(
        `/api/reviews/${NAME}`,
      );
      return {
        id: randomUUID(),
        type: 'verdict.set',
        verdict,
        captureVersion: review.version,
        patchDigest: review.patchDigest,
        summaryVersion: 0,
        ...bindings,
      };
    }

    it('sets a verdict with the bindings PUT /api/approval checks', async () => {
      await startNamed();

      const { results } = await send([await setVerdict('approve')]);

      expect(results.map(({ status }) => status)).toEqual(['applied']);
      expect((await approval()).verdict).toBe('approve');
    });

    it('applies a verdict after the comments before it in the batch', async () => {
      await startNamed();

      // Ops apply in batch order, so the verdict lands after the comment.
      const { results } = await send([addThread('t1'), await setVerdict('approve')]);

      expect(results.map(({ status }) => status)).toEqual(['applied', 'applied']);
      expect((await approval()).verdict).toBe('approve');
    });

    it('rejects a verdict given on a stale capture with the endpoint error', async () => {
      await startNamed();

      const { results } = await send([await setVerdict('approve', { captureVersion: 99 })]);

      expect(results).toEqual([
        {
          id: expect.any(String),
          status: 'rejected',
          error: 'Review capture or summary changed; reload before choosing a verdict',
        },
      ]);
      expect((await approval()).verdict).toBeUndefined();
    });

    it('clears a verdict without bindings', async () => {
      await startNamed();
      await approve();

      const { results } = await send([{ id: 'clear', type: 'verdict.set', verdict: 'clear' }]);

      expect(results.map(({ status }) => status)).toEqual(['applied']);
      expect((await approval()).verdict).toBeUndefined();
    });

    it('answers a replayed verdict with duplicate', async () => {
      await startNamed();
      const op = await setVerdict('reject');
      await send([op]);
      await send([{ id: 'clear', type: 'verdict.set', verdict: 'clear' }]);

      const { results } = await send([op]);

      expect(results.map(({ status }) => status)).toEqual(['duplicate']);
      expect((await approval()).verdict).toBeUndefined();
    });

    it('applies a verdict sent in two requests at once only once', async () => {
      await startNamed();
      const query = '?base=HEAD&target=.';
      const { diffDigest } = await request<{ diffDigest: string }>(`/api/diff${query}`);
      const op = {
        id: 'twice',
        type: 'verdict.set',
        verdict: 'approve',
        summaryVersion: 0,
        diffDigest,
      };

      const answers = await Promise.all([send([op], query), send([op], query)]);

      const statuses = answers.map(({ results }) => String(results[0]?.status));
      expect(statuses.sort((a, b) => a.localeCompare(b))).toEqual(['applied', 'duplicate']);
    });

    it('saves a verdict only together with the id of its op', async () => {
      await startNamed();
      const saves: SavedReview[] = [];
      const save = ReviewStore.prototype.save;
      vi.spyOn(ReviewStore.prototype, 'save').mockImplementation(function (
        this: ReviewStore,
        ...args
      ) {
        saves.push(structuredClone(args[1]));
        return save.apply(this, args);
      });

      const op = await setVerdict('approve');
      await send([op]);

      const withVerdict = saves.filter(({ approval }) => approval.verdict === 'approve');
      expect(withVerdict.length).toBeGreaterThan(0);
      for (const saved of withVerdict) expect(saved.appliedOps).toContain(op.id);
    });

    it('saves a comment only together with the id of its op when a verdict follows it', async () => {
      await startNamed();
      const saves: SavedReview[] = [];
      const save = ReviewStore.prototype.save;
      vi.spyOn(ReviewStore.prototype, 'save').mockImplementation(function (
        this: ReviewStore,
        ...args
      ) {
        saves.push(structuredClone(args[1]));
        return save.apply(this, args);
      });

      await send([addThread('t1'), await setVerdict('approve')]);

      const withThread = saves.filter(({ threads }) => threads.length > 0);
      expect(withThread.length).toBeGreaterThan(0);
      for (const saved of withThread) expect(saved.appliedOps).toContain('add-t1');
    });

    async function sendWithFailingVerdict(ops: unknown[]) {
      const query = '?base=HEAD&target=.';
      const { diffDigest } = await request<{ diffDigest: string }>(`/api/diff${query}`);
      vi.spyOn(GitDiffParser.prototype, 'parseDiff').mockRejectedValueOnce(new Error('git failed'));
      const verdict = { id: 'verdict', type: 'verdict.set', verdict: 'approve', summaryVersion: 0 };
      const response = await fetch(url(`/api/review-ops${query}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repositoryId: await repositoryId(),
          ops: [...ops, { ...verdict, diffDigest }],
        }),
      });
      expect(response.status).toBe(500);
      return query;
    }

    it('saves the id of an op that changed nothing before a verdict whose Git read fails', async () => {
      await startNamed();
      const gone = { id: 'gone', type: 'thread.delete', threadId: 'missing' };
      const query = await sendWithFailingVerdict([gone]);

      await restart();
      const { results } = await send([gone], query);

      expect(results).toEqual([{ id: 'gone', status: 'duplicate' }]);
    });

    it('announces a comment applied before a verdict whose Git read fails', async () => {
      await startNamed();
      const broadcast = vi.spyOn(FileWatcherService.prototype, 'broadcast');

      await sendWithFailingVerdict([addThread('t1')]);

      expect(broadcast.mock.calls.map(([event]) => event.type)).toContain('commentsChanged');
    });

    it('rejects a verdict on a server started without verdicts', async () => {
      await startNamed({ shipIt: false });

      const { results } = await send([await setVerdict('approve')]);

      expect(results[0]?.status).toBe('rejected');
    });
  });

  describe('idempotency', () => {
    it('answers a replayed op with duplicate, no events and no approval revocation', async () => {
      await startNamed();
      await send([addThread('t1')]);
      expect((await approve()).verdict).toBe('approve');
      const before = await cursor();

      const { results, threads } = await send([addThread('t1')]);

      expect(results).toEqual([{ id: 'add-t1', status: 'duplicate' }]);
      expect(threads).toHaveLength(1);
      expect(await eventsAfter(before)).toEqual([]);
      expect((await approval()).verdict).toBe('approve');
    });

    it('treats the same id twice in one batch as a duplicate', async () => {
      await startNamed();

      const { results, threads } = await send([addThread('t1'), addThread('t1')]);

      expect(results.map(({ status }) => status)).toEqual(['applied', 'duplicate']);
      expect(threads).toHaveLength(1);
    });

    it('answers a replay after a restart with duplicate and no events', async () => {
      await startNamed();
      await send([
        addThread('t1'),
        { id: 'reply', type: 'message.add', threadId: 't1', message: reply('m2') },
      ]);
      expect((await approve()).verdict).toBe('approve');

      await restart();
      const before = await cursor();
      const { results, threads, version } = await send([
        addThread('t1'),
        { id: 'reply', type: 'message.add', threadId: 't1', message: reply('m2') },
      ]);

      expect(results.map(({ status }) => status)).toEqual(['duplicate', 'duplicate']);
      expect(threads[0]?.messages.map(({ id }) => id)).toEqual(['t1', 'm2']);
      expect(version).toBe(1);
      expect(await eventsAfter(before)).toEqual([]);
      expect((await approval()).verdict).toBe('approve');
    });

    it('does not bring back a deleted thread when its add is replayed', async () => {
      await startNamed();
      await send([addThread('t1')]);
      await send([{ id: 'drop', type: 'thread.delete', threadId: 't1' }]);

      const { results, threads } = await send([addThread('t1')]);

      expect(results).toEqual([{ id: 'add-t1', status: 'duplicate' }]);
      expect(threads).toEqual([]);
    });

    it('does not bring back a thread deleted before a restart', async () => {
      await startNamed();
      await send([addThread('t1')]);
      await send([{ id: 'drop', type: 'thread.delete', threadId: 't1' }]);

      await restart();
      const { results, threads } = await send([addThread('t1')]);

      expect(results).toEqual([{ id: 'add-t1', status: 'duplicate' }]);
      expect(threads).toEqual([]);
    });

    it('saves the ledger of a batch that leaves the review with no threads', async () => {
      await startNamed();
      await send([addThread('t1'), { id: 'drop', type: 'thread.delete', threadId: 't1' }]);

      await restart();
      const { results, threads } = await send([addThread('t1')]);

      expect(results).toEqual([{ id: 'add-t1', status: 'duplicate' }]);
      expect(threads).toEqual([]);
    });

    it('saves the ledger of an op that changes nothing', async () => {
      await startNamed();
      await send([{ id: 'gone', type: 'thread.delete', threadId: 'missing' }]);

      await restart();
      const { results } = await send([{ id: 'gone', type: 'thread.delete', threadId: 'missing' }]);

      expect(results).toEqual([{ id: 'gone', status: 'duplicate' }]);
    });

    it('does not ledger a rejected op, so it can apply once its thread exists', async () => {
      await startNamed();
      const op = { id: 'reply', type: 'message.add', threadId: 't1', message: reply('m2') };
      expect((await send([op])).results[0]?.status).toBe('rejected');

      await send([addThread('t1')]);

      expect((await send([op])).results[0]?.status).toBe('applied');
    });

    it('remembers an op id however many ops follow it', async () => {
      await startNamed();
      await send([addThread('t1')]);
      await send([{ id: 'drop', type: 'thread.delete', threadId: 't1' }]);
      await send(
        Array.from({ length: 1100 }, (_, index) => ({
          id: `op-${index}`,
          type: 'thread.delete',
          threadId: 'missing',
        })),
      );

      await restart();
      const { results, threads } = await send([addThread('t1')]);

      expect(results).toEqual([{ id: 'add-t1', status: 'duplicate' }]);
      expect(threads).toEqual([]);
    });

    it('keeps the ledger under --clean, so a replayed add does not bring back a cleared comment', async () => {
      await startNamed();
      await send([addThread('t1')]);

      await restart({ clearComments: true });
      const { results, threads } = await send([addThread('t1')]);

      expect(results).toEqual([{ id: 'add-t1', status: 'duplicate' }]);
      expect(threads).toEqual([]);
    });

    it('loads a saved record written before the ledger existed', async () => {
      await startNamed();
      await send([addThread('t1')]);
      await running?.shutdown('closed');
      running = undefined;
      const [path] = savedRecordPaths();
      const { appliedOps, ...oldRecord } = JSON.parse(
        readFileSync(path as string, 'utf8'),
      ) as SavedReview;
      expect(appliedOps).toEqual(['add-t1']);
      writeFileSync(path as string, JSON.stringify(oldRecord));

      await startNamed();
      const { results, threads } = await send([addThread('t2')]);

      expect(results).toEqual([{ id: 'add-t2', status: 'applied' }]);
      expect(threads.map(({ id }) => id)).toEqual(['t1', 't2']);
    });
  });

  describe('saving before the response', () => {
    const path = `/api/review-ops?review=${NAME}`;

    it('answers 503 while the record cannot be written, for every status in the batch', async () => {
      await startNamed();
      await send([addThread('t0')]);
      const reviews = join(root, '.git', 'gavel', 'reviews');
      const batch = { repositoryId: await repositoryId(), ops: [addThread('t1')] };
      vi.spyOn(console, 'error').mockImplementation(() => {});
      chmodSync(reviews, 0o500);
      try {
        const failed = await request<{ error: string }>(path, batch, 503);
        expect(failed.error).toMatch(/could not save review/);

        // The op is in the in-memory ledger now, so this retry is a batch of only duplicates.
        const retried = await request<{ error: string }>(path, batch, 503);
        expect(retried.error).toMatch(/could not save review/);

        const rejectedOnly = {
          repositoryId: batch.repositoryId,
          ops: [{ id: 'bad', type: 'thread.delete' }],
        };
        await request(path, rejectedOnly, 503);
      } finally {
        chmodSync(reviews, 0o700);
      }

      const recovered = await request<ReviewOpsResponse>(path, batch);
      expect(recovered.results).toEqual([{ id: 'add-t1', status: 'duplicate' }]);

      await restart();
      const { results, threads } = await send([addThread('t1')]);
      expect(results).toEqual([{ id: 'add-t1', status: 'duplicate' }]);
      expect(threads.map(({ id }) => id)).toEqual(['t0', 't1']);
    });

    it('answers 503 while the review lock is contended, and duplicate once it frees', async () => {
      await startNamed();
      await send([addThread('t0')]);
      const locks = join(root, '.git', 'gavel', 'locks');
      const [lockName] = readdirSync(locks).filter((name) => name.endsWith('.json'));
      const lock = join(locks, lockName as string);
      // A lock nobody running holds, which another server is in the middle of reclaiming.
      writeFileSync(
        lock,
        JSON.stringify({ serverId: randomUUID(), pid: process.pid, hostname: 'elsewhere' }),
      );
      writeFileSync(`${lock}.reclaim`, '{}');
      const batch = { repositoryId: await repositoryId(), ops: [addThread('t1')] };

      const contended = await request<{ error: string }>(path, batch, 503);
      expect(contended.error).toMatch(/waiting for another server/);

      rmSync(`${lock}.reclaim`);
      const recovered = await request<ReviewOpsResponse>(path, batch);
      expect(recovered.results).toEqual([{ id: 'add-t1', status: 'duplicate' }]);
    });

    it('still answers 200 for a review another running server saves', async () => {
      await startNamed();
      await send([addThread('t0')]);
      const owner = running;
      try {
        await startNamed();

        const { results } = await send([addThread('t1')]);

        expect(results).toEqual([{ id: 'add-t1', status: 'applied' }]);
      } finally {
        await owner?.shutdown('closed');
      }
    });
  });

  describe('message validation', () => {
    const badMessages: [string, Record<string, unknown>][] = [
      ['an object author', { author: { name: 'User' } }],
      ['a numeric author', { author: 5 }],
      ['a null author', { author: null }],
      ['an unknown origin', { origin: 'system' }],
    ];

    it.each(badMessages)('rejects a reply with %s before any change', async (_name, fields) => {
      await startNamed();
      await send([addThread('t1')]);
      const before = await cursor();
      const op = {
        id: 'reply',
        type: 'message.add',
        threadId: 't1',
        message: { ...reply('m2'), ...fields },
      };

      const { results, threads } = await send([op]);

      expect(results.map(({ status }) => status)).toEqual(['rejected']);
      expect(threads[0]?.messages.map(({ id }) => id)).toEqual(['t1']);
      expect(await eventTypes(before)).toEqual([]);
      const output = await fetch(url(`/api/comments-output?review=${NAME}`));
      expect(output.status).toBe(200);
      // Not ledgered: the same id applies once its message is well formed.
      const corrected = await send([{ ...op, message: reply('m2') }]);
      expect(corrected.results).toEqual([{ id: 'reply', status: 'applied' }]);
    });

    it.each(badMessages)('rejects a new thread with %s', async (_name, fields) => {
      await startNamed();
      const { messages, ...base } = thread('t1');

      const { results, threads } = await send([
        {
          id: 'add',
          type: 'thread.add',
          thread: { ...base, messages: messages.map((item) => ({ ...item, ...fields })) },
        },
      ]);

      expect(results.map(({ status }) => status)).toEqual(['rejected']);
      expect(threads).toEqual([]);
    });

    it('accepts the author and origin the browser and an undone agent reply send', async () => {
      await startNamed();
      await send([addThread('t1')]);

      const { results, threads } = await send([
        {
          id: 'user',
          type: 'message.add',
          threadId: 't1',
          message: { ...reply('m2'), author: 'User', origin: 'user' },
        },
        {
          id: 'agent',
          type: 'message.add',
          threadId: 't1',
          message: { ...reply('m3'), author: 'Agent', origin: 'agent' },
        },
      ]);

      expect(results.map(({ status }) => status)).toEqual(['applied', 'applied']);
      expect(threads[0]?.messages.map(({ author }) => author)).toEqual([
        undefined,
        'User',
        'Agent',
      ]);
    });
  });

  describe('request handling', () => {
    it('refuses a different repository with 409 and applies nothing', async () => {
      await startNamed();
      const before = await cursor();

      await request(
        `/api/review-ops?review=${NAME}`,
        { repositoryId: 'another-repository', ops: [addThread('t1')] },
        409,
      );

      expect(
        (await request<{ threads: DiffCommentThread[] }>(`/api/comments-json?review=${NAME}`))
          .threads,
      ).toEqual([]);
      expect(await eventTypes(before)).toEqual([]);
    });

    it('accepts a body over the default 100 KiB JSON limit', async () => {
      await startNamed();
      const body = 'x'.repeat(200 * 1024);

      const { results, threads } = await send([
        { id: 'large', type: 'thread.add', thread: thread('t1', body) },
      ]);

      expect(results).toEqual([{ id: 'large', status: 'applied' }]);
      expect(threads[0]?.messages[0]?.body).toHaveLength(body.length);
    });

    it('answers a body over 16 MiB with a JSON 413', async () => {
      await startNamed();

      const { error } = await request<{ error: string }>(
        `/api/review-ops?review=${NAME}`,
        { repositoryId: 'x', ops: [{ padding: 'x'.repeat(16 * 1024 * 1024) }] },
        413,
      );

      expect(error).toMatch(/16 MiB/);
    });

    it('refuses a body that is not JSON with 415', async () => {
      await startNamed();

      const response = await fetch(url(`/api/review-ops?review=${NAME}`), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ repositoryId: 'x', ops: [] }),
      });

      expect(response.status).toBe(415);
    });

    it.each([
      ['no repositoryId', { ops: [] }],
      ['no ops', { repositoryId: 'x' }],
      ['ops that is not a list', { repositoryId: 'x', ops: {} }],
      ['an op without an id', { repositoryId: 'x', ops: [{ type: 'thread.delete' }] }],
    ])('refuses a batch with %s with 400', async (_name, body) => {
      await startNamed();
      await request(`/api/review-ops?review=${NAME}`, body, 400);
    });

    it('answers 404 for an unknown named review', async () => {
      await startNamed();
      await request(
        '/api/review-ops?review=missing',
        { repositoryId: await repositoryId(), ops: [] },
        404,
      );
    });

    it('flags --clean only on the diff of the review it emptied', async () => {
      git('add', 'first.txt');
      git('commit', '--quiet', '--no-verify', '-m', 'second');
      writeFileSync(join(root, 'first.txt'), 'uncommitted first\n');
      running = await startServer({
        selection: createDiffSelection('HEAD^', 'HEAD'),
        repoPath: root,
        preferredPort: 0,
        openBrowser: false,
        keepAlive: true,
        clearComments: true,
      });
      const clean = async (query: string) =>
        (await request<{ clearComments?: boolean }>(`/api/diff${query}`)).clearComments;

      expect(await clean('')).toBe(true);
      expect(await clean('?base=HEAD&target=.')).toBeUndefined();
      expect(await clean('?base=HEAD^&target=HEAD')).toBe(true);
    });

    it('keeps --clean off another review whose diff overlaps one of the emptied review', async () => {
      git('add', 'first.txt');
      git('commit', '--quiet', '--no-verify', '-m', 'second');
      writeFileSync(join(root, 'first.txt'), 'uncommitted first\n');
      running = await startServer({
        selection: createDiffSelection('HEAD^', 'HEAD'),
        repoPath: root,
        preferredPort: 0,
        openBrowser: false,
        keepAlive: true,
        clearComments: true,
      });
      // The other review's diff waits while reading the user config.
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const readFile = fsPromises.readFile.bind(fsPromises);
      let held = false;
      vi.spyOn(fsPromises, 'readFile').mockImplementation(async (...args) => {
        if (!held && String(args[0]).endsWith('config.json')) {
          held = true;
          await gate;
        }
        return readFile(...(args as Parameters<typeof readFile>));
      });

      const other = request<{ clearComments?: boolean }>('/api/diff?base=HEAD&target=.');
      await vi.waitFor(() => expect(held).toBe(true));
      expect(
        (await request<{ clearComments?: boolean }>('/api/diff?base=HEAD^&target=HEAD'))
          .clearComments,
      ).toBe(true);
      release();

      expect((await other).clearComments).toBeUndefined();
    });

    it('seeds the commit message only into the review whose diff carries it, when requests arrive together', async () => {
      git('add', 'first.txt');
      git('commit', '--quiet', '--no-verify', '-m', 'second');
      writeFileSync(join(root, 'first.txt'), 'uncommitted first\n');
      running = await startServer({
        selection: createDiffSelection('HEAD^', 'HEAD'),
        repoPath: root,
        preferredPort: 0,
        openBrowser: false,
        keepAlive: true,
      });
      // Cache both diffs, so the pipelined requests below answer without reading Git.
      await request('/api/diff?base=HEAD^&target=HEAD');
      const work = await request<{ baseCommitish: string; targetCommitish: string }>(
        '/api/diff?base=HEAD&target=.',
      );
      // The summary is keyed by the selection the diff resolved to, not by HEAD.
      const summaryPath = `/api/review-summary?${new URLSearchParams({
        base: work.baseCommitish,
        target: work.targetCommitish,
      })}`;
      expect((await request<{ commitMessage: string }>(summaryPath)).commitMessage).toBe('');

      // Two requests in one write, which Node parses and starts before either handler resumes.
      const { hostname, port } = new URL(running.url);
      await new Promise<void>((resolve, reject) => {
        const socket = connect(Number(port), hostname, () => {
          socket.end(
            'GET /api/diff?base=HEAD%5E&target=HEAD HTTP/1.1\r\nHost: localhost\r\n\r\n' +
              'GET /api/diff?base=HEAD&target=. HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n',
          );
        });
        socket.on('data', () => {});
        socket.on('close', () => resolve());
        socket.on('error', reject);
      });

      expect((await request<{ commitMessage: string }>(summaryPath)).commitMessage).toBe('');
    });

    it('works without conversation mode', async () => {
      git('add', 'first.txt');
      git('commit', '--quiet', '--no-verify', '-m', 'second');
      running = await startServer({
        selection: createDiffSelection('HEAD^', 'HEAD'),
        repoPath: root,
        preferredPort: 0,
        openBrowser: false,
        keepAlive: true,
        conversation: false,
      });
      const { repositoryId: id } = await request<{ repositoryId: string }>('/api/diff');

      const first = await request<ReviewOpsResponse>('/api/review-ops', {
        repositoryId: id,
        ops: [addThread('t1')],
      });
      const replay = await request<ReviewOpsResponse>('/api/review-ops', {
        repositoryId: id,
        ops: [addThread('t1')],
      });

      expect(first.results).toEqual([{ id: 'add-t1', status: 'applied' }]);
      expect(first.threads.map(({ id: threadId }) => threadId)).toEqual(['t1']);
      expect(replay.results).toEqual([{ id: 'add-t1', status: 'duplicate' }]);
      expect(replay.threads).toHaveLength(1);
    });
  });
});
