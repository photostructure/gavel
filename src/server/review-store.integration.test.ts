import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { devNull, hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { fetch } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationSnapshot, ReviewApproval, ReviewSummary } from '../types/conversation.js';
import type { DiffCommentThread } from '../types/diff.js';
import { DiffMode } from '../types/watch.js';
import type { ReviewCapture } from '../types/review.js';
import { createDiffSelection } from '../utils/diffSelection.js';

import { findApprovals } from '../cli/approval.js';

import { captureWorkingTree } from './review-capture.js';
import { ReviewStore, savedReviewKey, type ReviewOwner, type SavedReview } from './review-store.js';
import { startServer } from './server.js';

const now = '2026-11-07T12:00:00.000Z';
const message = 'fix: keep approvals across restarts';

function thread(id = 'question'): DiffCommentThread {
  return {
    id,
    filePath: 'first.txt',
    position: { side: 'new', line: 1 },
    codeSnapshot: { content: 'captured first' },
    createdAt: now,
    updatedAt: now,
    messages: [{ id: `${id}-message`, body: 'Keep this comment.', createdAt: now, updatedAt: now }],
  };
}

describe('saved review state across server restarts', () => {
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

  async function request<T>(
    path: string,
    body?: unknown,
    status = 200,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    if (!running) throw new Error('Fixture server has not started');
    const response = await fetch(new URL(path, running.url), {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    const result: unknown = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(status);
    return result as T;
  }

  async function startNamed(name: string, options: Parameters<typeof startServer>[0] = {}) {
    running = await startServer({
      namedReview: { name, capture },
      repoPath: root,
      preferredPort: 0,
      openBrowser: false,
      keepAlive: true,
      shipIt: true,
      conversation: true,
      ...options,
    });
  }

  async function restart(start: () => Promise<void>) {
    await running?.shutdown('closed');
    running = undefined;
    await start();
  }

  const reviewOf = async (name: string) =>
    (await request<ConversationSnapshot>('/api/conversation/snapshot')).reviews.find(
      (review) => review.selection.reviewName === name,
    );

  const proposeSummary = async (
    name: string,
    body: { commitMessage: string; rationale: string; baseVersion: number },
  ) =>
    request<ReviewSummary>('/api/conversation/summary', {
      ...body,
      reviewId: (await reviewOf(name))!.id,
    });

  async function approveNamed(name: string, summaryVersion: number) {
    const review = await request<{ version: number; patchDigest: string }>(`/api/reviews/${name}`);
    return request<ReviewApproval>(
      `/api/approval?review=${name}`,
      {
        verdict: 'approve',
        captureVersion: review.version,
        patchDigest: review.patchDigest,
        summaryVersion,
      },
      200,
      'PUT',
    );
  }

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-saved-reviews-')));
    git('init', '--quiet');
    writeFileSync(join(root, 'first.txt'), 'before first\n');
    git('add', 'first.txt');
    git('commit', '--quiet', '--no-verify', '-m', 'fixture');
    writeFileSync(join(root, 'first.txt'), 'captured first\n');
    capture = await captureWorkingTree({ cwd: root, pathspecs: ['first.txt'] });
  });

  afterEach(async () => {
    await running?.shutdown('closed');
    running = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it('restores a named review’s comments, proposal and approval after a restart', async () => {
    await startNamed('task');
    await request('/api/comments?review=task', { threads: [thread()] });
    const summary = await proposeSummary('task', {
      commitMessage: message,
      rationale: 'Approvals survive.',
      baseVersion: 0,
    });
    await approveNamed('task', summary.version);
    expect(existsSync(join(root, '.git', 'gavel', 'reviews'))).toBe(true);

    await restart(() => startNamed('task'));

    const restored = await reviewOf('task');
    expect(restored).toMatchObject({
      summary: { commitMessage: message, version: summary.version },
      approval: { verdict: 'approve', patchDigest: capture.patchDigest },
      threads: [{ id: 'question', messages: [{ body: 'Keep this comment.' }] }],
    });
    expect(await request<ReviewApproval>('/api/approval?review=task')).toMatchObject({
      verdict: 'approve',
    });
    const comments = await request<{ threads: DiffCommentThread[] }>(
      '/api/comments-json?review=task',
    );
    expect(comments.threads.map((entry) => entry.id)).toEqual(['question']);
  });

  it('keeps an approval across relaunches, moving it to a changed proposal', async () => {
    await startNamed('task', { commitMessage: message, why: 'Same TLDR.' });
    await approveNamed('task', 1);

    await restart(() => startNamed('task', { commitMessage: message, why: 'Same TLDR.' }));
    expect(await reviewOf('task')).toMatchObject({ approval: { verdict: 'approve' } });

    await restart(() => startNamed('task', { commitMessage: 'fix: something else', why: '' }));
    expect(await reviewOf('task')).toMatchObject({
      summary: { commitMessage: 'fix: something else', version: 2 },
      approval: { verdict: 'approve', summaryVersion: 2 },
    });
  });

  it('starts fresh when the same name launches a different patch', async () => {
    await startNamed('task', { commitMessage: message });
    await approveNamed('task', 1);
    await running?.shutdown('closed');
    writeFileSync(join(root, 'first.txt'), 'a different change\n');
    capture = await captureWorkingTree({ cwd: root, pathspecs: ['first.txt'] });
    running = undefined;
    await startNamed('task');
    expect(await reviewOf('task')).toMatchObject({
      approval: expect.not.objectContaining({ verdict: expect.anything() }),
      summary: { version: 0 },
      threads: [],
    });
  });

  it('restores a review added with review create on a new server', async () => {
    await startNamed('first');
    await request('/api/reviews', { name: 'second', capture });
    await request('/api/comments?review=second', { threads: [thread('later')] });
    await restart(() => startNamed('first'));
    expect(await reviewOf('second')).toBeUndefined();
    await request('/api/reviews', { name: 'second', capture });
    expect(await reviewOf('second')).toMatchObject({ threads: [{ id: 'later' }] });
  });

  it('restores a renamed review under its new name only', async () => {
    await startNamed('task');
    await request('/api/comments?review=task', { threads: [thread()] });
    await request('/api/reviews/task/rename', { name: 'renamed' });

    await restart(() => startNamed('renamed'));
    expect((await reviewOf('renamed'))?.threads.map((entry) => entry.id)).toEqual(['question']);
    await restart(() => startNamed('task'));
    expect(await reviewOf('task')).toMatchObject({ threads: [] });
  });

  it('refuses to rename onto a name an earlier server saved with the same patch', async () => {
    await startNamed('other');
    await request('/api/comments?review=other', { threads: [thread()] });
    await restart(() => startNamed('task'));
    await request('/api/reviews/task/rename', { name: 'other' }, 409);

    await restart(() => startNamed('other'));
    expect((await reviewOf('other'))?.threads.map((entry) => entry.id)).toEqual(['question']);
  });

  it('forgets a deleted review once the server stops', async () => {
    await startNamed('first');
    await request('/api/reviews', { name: 'second', capture });
    await request('/api/comments?review=second', { threads: [thread('later')] });
    await request('/api/reviews/second', undefined, 200, 'DELETE');

    await restart(() => startNamed('first'));
    await request('/api/reviews', { name: 'second', capture });
    expect(await reviewOf('second')).toMatchObject({ threads: [] });
    expect(
      (await request<ConversationSnapshot>('/api/conversation/snapshot')).deletedReviews,
    ).toBeUndefined();
  });

  it('leaves a review alone while another running server owns it', async () => {
    await startNamed('task');
    await request('/api/comments?review=task', { threads: [thread()] });
    const owner = running!;
    await startNamed('task');
    const second = running!;
    expect(await reviewOf('task')).toMatchObject({ threads: [] });
    await request('/api/comments?review=task', { threads: [thread('from-second')] });
    // The agent must learn that this server's copy of the review is not being saved.
    expect(
      (await request<ConversationSnapshot>('/api/conversation/snapshot')).store?.error,
    ).toMatch(/kept in memory only/);
    await second.shutdown('closed');
    running = owner;
    await owner.shutdown('closed');
    running = undefined;
    await startNamed('task');
    expect((await reviewOf('task'))?.threads.map((entry) => entry.id)).toEqual(['question']);
  });

  it('restores an approved commit target after a restart', async () => {
    writeFileSync(join(root, 'first.txt'), 'committed change\n');
    git('commit', '--quiet', '--no-verify', '-am', 'second');
    const start = async () => {
      running = await startServer({
        repoPath: root,
        preferredPort: 0,
        openBrowser: false,
        keepAlive: true,
        shipIt: true,
        conversation: true,
        diffMode: DiffMode.SPECIFIC,
        explicitTarget: true,
        selection: { baseCommitish: 'HEAD^', targetCommitish: 'HEAD' },
        commitMessage: message,
      });
    };
    await start();
    await request<ReviewApproval>(
      '/api/approval',
      { verdict: 'approve', summaryVersion: 1 },
      200,
      'PUT',
    );
    await restart(start);
    expect(await request<ReviewApproval>('/api/approval')).toMatchObject({ verdict: 'approve' });
    await running?.shutdown('closed');
    running = undefined;
    expect(await findApprovals(root, { commit: 'HEAD' })).toMatchObject([
      { match: 'commit', approval: { verdict: 'approve' }, commitMessage: message },
    ]);
  });

  async function startCommitTarget() {
    return startServer({
      repoPath: root,
      preferredPort: 0,
      openBrowser: false,
      keepAlive: true,
      shipIt: true,
      conversation: true,
      diffMode: DiffMode.SPECIFIC,
      explicitTarget: true,
      selection: { baseCommitish: 'HEAD^', targetCommitish: 'HEAD' },
    });
  }

  it('keeps the first saver’s comments when two servers open a review before either saves', async () => {
    writeFileSync(join(root, 'first.txt'), 'committed change\n');
    git('commit', '--quiet', '--no-verify', '-am', 'second');
    const first = await startCommitTarget();
    const second = await startCommitTarget();
    try {
      running = first;
      await request('/api/comments', { threads: [thread('first-server')] });
      running = second;
      await request('/api/comments', { threads: [thread('second-server')] });
      const saved = new ReviewStore(join(root, '.git', 'gavel')).list();
      expect(saved.flatMap((review) => review.threads.map((entry) => entry.id))).toEqual([
        'first-server',
      ]);
    } finally {
      await first.shutdown('closed');
      await second.shutdown('closed');
      running = undefined;
    }
  });

  it('never saves a changed proposal together with an approval of the earlier one', async () => {
    const save = ReviewStore.prototype.save;
    const saves: SavedReview[] = [];
    const spy = vi.spyOn(ReviewStore.prototype, 'save').mockImplementation(function (
      this: ReviewStore,
      key: string,
      review: SavedReview,
      owner: ReviewOwner,
    ) {
      saves.push(structuredClone(review));
      return save.call(this, key, review, owner);
    });
    try {
      await startNamed('task', { commitMessage: message });
      await approveNamed('task', 1);
      await proposeSummary('task', {
        commitMessage: 'fix: a different proposal',
        rationale: '',
        baseVersion: 1,
      });
      expect(
        saves.some(
          (review) => review.summary.version === 2 && review.approval.summaryVersion !== 2,
        ),
      ).toBe(false);
      expect(saves.at(-1)).toMatchObject({
        summary: { version: 2 },
        approval: { verdict: 'approve', summaryVersion: 2 },
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('restores a recaptured named review with its capture history', async () => {
    await startNamed('task');
    await request('/api/comments?review=task', { threads: [thread()] });
    writeFileSync(join(root, 'first.txt'), 'recaptured first\n');
    const next = await captureWorkingTree({ cwd: root, pathspecs: ['first.txt'] });
    await request('/api/reviews/task/capture', { expectedVersion: 1, capture: next });
    await approveNamed('task', 0);
    const original = capture;
    capture = next;

    await restart(() => startNamed('task'));

    expect(await reviewOf('task')).toMatchObject({
      capture: { version: 2, patchDigest: next.patchDigest },
      approval: { verdict: 'approve' },
      threads: [{ id: 'question', capture: { version: 1, patchDigest: original.patchDigest } }],
    });
    expect(await request<{ version: number }>('/api/reviews/task?version=1')).toMatchObject({
      version: 1,
      patchDigest: original.patchDigest,
    });
    // The record the first capture wrote was replaced, not left beside the new one.
    expect(new ReviewStore(join(root, '.git', 'gavel')).list()).toHaveLength(1);
  });

  it('keeps serving and retries the save when the store cannot be written', async () => {
    // A read-only reviews directory makes every save fail.
    const reviews = join(root, '.git', 'gavel', 'reviews');
    mkdirSync(reviews, { recursive: true });
    chmodSync(reviews, 0o500);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await startNamed('task');
      await request('/api/comments?review=task', { threads: [thread('while-broken')] });
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('could not save review'));
      // A --background server's stderr reaches nobody, so the snapshot reports the failure too.
      expect((await request<ConversationSnapshot>('/api/conversation/snapshot')).store).toEqual({
        directory: join(root, '.git', 'gavel'),
        error: expect.stringContaining('could not save review'),
      });
      chmodSync(reviews, 0o700);
      const comments = await request<{ threads: DiffCommentThread[]; version: number }>(
        '/api/comments-json?review=task',
      );
      await request('/api/comments?review=task', {
        baseVersion: comments.version,
        threads: [...comments.threads, thread('after-fix')],
      });
      const [saved] = new ReviewStore(join(root, '.git', 'gavel')).list();
      expect(saved?.threads.map((entry) => entry.id)).toEqual(['while-broken', 'after-fix']);
      expect((await request<ConversationSnapshot>('/api/conversation/snapshot')).store).toEqual({
        directory: join(root, '.git', 'gavel'),
      });
    } finally {
      errors.mockRestore();
    }
  });

  it('keeps the old record when a recaptured review cannot save its replacement', async () => {
    await startNamed('task');
    await request('/api/comments?review=task', { threads: [thread('first-patch')] });
    const first = running!;
    const original = capture;
    writeFileSync(join(root, 'first.txt'), 'second patch\n');
    capture = await captureWorkingTree({ cwd: root, pathspecs: ['first.txt'] });
    // Another running server already saves the same name with the second patch.
    await startNamed('task');
    const second = running!;
    try {
      await request('/api/comments?review=task', { threads: [thread('second-server')] });
      running = first;
      await request('/api/reviews/task/capture', { expectedVersion: 1, capture });
      const saved = new ReviewStore(join(root, '.git', 'gavel')).list();
      expect(
        saved.map((review) => [review.captures?.at(-1)?.patchDigest, review.threads[0]?.id]),
      ).toEqual(
        expect.arrayContaining([
          [original.patchDigest, 'first-patch'],
          [capture.patchDigest, 'second-server'],
        ]),
      );
    } finally {
      await second.shutdown('closed');
    }
  });

  it('retries a save whose lock another server is reclaiming, and says it is waiting', async () => {
    const key = savedReviewKey(
      capture.repositoryId,
      createDiffSelection(capture.baseCommit, '.', undefined, 'task'),
      capture,
    )!;
    const locks = join(root, '.git', 'gavel', 'locks');
    const lock = join(locks, `${createHash('sha256').update(key).digest('hex')}.json`);
    mkdirSync(locks, { recursive: true });
    writeFileSync(
      lock,
      JSON.stringify({ serverId: 'crashed', pid: 2 ** 22 + 1, hostname: hostname() }),
    );
    // Another server is in the middle of reclaiming the crashed server's lock.
    writeFileSync(`${lock}.reclaim`, '{}');
    await startNamed('task');
    await request('/api/comments?review=task', { threads: [thread('while-busy')] });
    expect(
      (await request<ConversationSnapshot>('/api/conversation/snapshot')).store?.error,
    ).toMatch(/waiting for another server/);
    rmSync(`${lock}.reclaim`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const [saved] = new ReviewStore(join(root, '.git', 'gavel')).list();
    expect(saved?.threads.map((entry) => entry.id)).toEqual(['while-busy']);
    expect((await request<ConversationSnapshot>('/api/conversation/snapshot')).store?.error).toBe(
      undefined,
    );
  });

  it('starts a saved review without its comments under --clean, and saves that', async () => {
    await startNamed('task', { commitMessage: message });
    await request('/api/comments?review=task', { threads: [thread()] });
    await restart(() => startNamed('task', { commitMessage: message, clearComments: true }));
    expect(await reviewOf('task')).toMatchObject({
      threads: [],
      summary: { commitMessage: message },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [saved] = new ReviewStore(join(root, '.git', 'gavel')).list();
    expect(saved?.threads).toEqual([]);
  });

  it('clears only the launched review under --clean', async () => {
    await startNamed('first');
    await request('/api/reviews', { name: 'second', capture });
    await request('/api/comments?review=second', { threads: [thread('keep-me')] });
    await restart(() => startNamed('first', { clearComments: true }));
    await request('/api/reviews', { name: 'second', capture });
    expect(await reviewOf('second')).toMatchObject({ threads: [{ id: 'keep-me' }] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const saved = new ReviewStore(join(root, '.git', 'gavel'))
      .list()
      .find((review) => review.selection.reviewName === 'second');
    expect(saved?.threads.map((entry) => entry.id)).toEqual(['keep-me']);
  });

  it('stops calling a review memory-only once a recapture lets this server save it', async () => {
    await startNamed('task');
    await request('/api/comments?review=task', { threads: [thread()] });
    const owner = running!;
    await startNamed('task');
    const second = running!;
    try {
      const status = async () =>
        (await request<ConversationSnapshot>('/api/conversation/snapshot')).store?.error;
      expect(await status()).toMatch(/kept in memory only/);
      writeFileSync(join(root, 'first.txt'), 'recaptured in the second server\n');
      const next = await captureWorkingTree({ cwd: root, pathspecs: ['first.txt'] });
      await request('/api/reviews/task/capture', { expectedVersion: 1, capture: next });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await status()).toBeUndefined();
    } finally {
      await second.shutdown('closed');
      running = owner;
    }
  });

  it('adopts a relaunch proposal that matches the commit message it was seeded from', async () => {
    writeFileSync(join(root, 'first.txt'), 'committed change\n');
    git('commit', '--quiet', '--no-verify', '-am', 'fix: persist review');
    running = await startCommitTarget();
    await request('/api/comments', { threads: [thread()] });
    const seeded = (await request<ConversationSnapshot>('/api/conversation/snapshot')).reviews[0]!
      .summary;
    expect(seeded).toMatchObject({ fromCommit: true, version: 1 });
    await restart(async () => {
      running = await startServer({
        repoPath: root,
        preferredPort: 0,
        openBrowser: false,
        keepAlive: true,
        shipIt: true,
        conversation: true,
        diffMode: DiffMode.SPECIFIC,
        explicitTarget: true,
        selection: { baseCommitish: 'HEAD^', targetCommitish: 'HEAD' },
        commitMessage: seeded.commitMessage,
        why: '',
      });
    });
    const summary = (await request<ConversationSnapshot>('/api/conversation/snapshot')).reviews[0]!
      .summary;
    expect(summary.fromCommit).toBeUndefined();
    expect(summary).toMatchObject({ commitMessage: seeded.commitMessage, version: 2 });
  });

  it('starts and reports it when cleanup cannot delete an expired review', async () => {
    const store = new ReviewStore(join(root, '.git', 'gavel'));
    const server = store.registerServer();
    store.save('expired', { ...savedFixture(), repositoryId: capture.repositoryId }, server.owner);
    server.release();
    const reviews = join(root, '.git', 'gavel', 'reviews');
    const old = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
    for (const name of readdirSync(reviews)) utimesSync(join(reviews, name), old, old);
    chmodSync(reviews, 0o500);
    try {
      await startNamed('task');
      expect(
        (await request<ConversationSnapshot>('/api/conversation/snapshot')).store?.error,
      ).toMatch(/could not clean up/);
    } finally {
      chmodSync(reviews, 0o700);
    }
  });
});

function savedFixture(): SavedReview {
  return {
    format: 1,
    repositoryId: 'repo',
    selection: createDiffSelection('a'.repeat(40), 'b'.repeat(40)),
    threads: [],
    progress: [],
    approval: {},
    summary: { commitMessage: '', rationale: '', version: 0 },
    updatedAt: now,
  };
}
