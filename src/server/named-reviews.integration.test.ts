import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fetch } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationSnapshot, ReviewApproval, ReviewSummary } from '../types/conversation.js';
import type { DiffCommentThread, DiffResponse, RevisionsResponse } from '../types/diff.js';
import type { ServerEvent } from '../types/events.js';
import type { CapturedFile, NamedReviewMetadata, ReviewCapture } from '../types/review.js';

import { NamedReviewStore } from './named-reviews.js';
import { capturePatch, captureWorkingTree } from './review-capture.js';
import { startServer } from './server.js';

interface ReviewResponse extends NamedReviewMetadata {
  reviewId: string;
  files: CapturedFile[];
  updated?: boolean;
}

interface CommentsResponse {
  threads: DiffCommentThread[];
  version: number;
}

const name = 'agent-task';
const query = `?review=${name}`;
const now = '2026-10-30T12:00:00.000Z';

function lineThread(id = 'question'): DiffCommentThread {
  return {
    id,
    filePath: 'first.txt',
    position: { side: 'new', line: 1 },
    codeSnapshot: { content: 'captured first' },
    createdAt: now,
    updatedAt: now,
    messages: [
      { id: `${id}-message`, body: 'Keep this discussion.', createdAt: now, updatedAt: now },
    ],
  };
}

describe('named review HTTP integration', () => {
  let root: string;
  let initialCapture: ReviewCapture;
  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  let events: ServerEvent[];
  let indexBefore: Buffer;
  const cleanupDirectories: string[] = [];

  function git(...args: string[]): string {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
    );
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
        `core.hooksPath=${join(root, 'disabled-hooks')}`,
        ...args,
      ],
      { cwd: root, env, encoding: 'utf8' },
    );
  }

  async function request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    status = 200,
  ): Promise<T> {
    if (!running) throw new Error('Fixture server has not started');
    const response = await fetch(`${running.url}${path}`, {
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

  const get = <T>(path: string) => request<T>(path);
  const post = <T>(path: string, body: unknown, status = 200) =>
    request<T>(path, 'POST', body, status);
  const put = <T>(path: string, body: unknown, status = 200) =>
    request<T>(path, 'PUT', body, status);
  const review = () => get<ReviewResponse>(`/api/reviews/${name}`);
  const approval = () => get<ReviewApproval>(`/api/approval${query}`);
  const snapshot = () => get<ConversationSnapshot>('/api/conversation/snapshot');
  const proposeSummary = async (body: {
    commitMessage: string;
    rationale: string;
    baseVersion: number;
  }) =>
    post<ReviewSummary>('/api/conversation/summary', {
      ...body,
      reviewId: (await review()).reviewId,
    });
  const binding = (capture: ReviewCapture, version: number, summaryVersion = 0) => ({
    verdict: 'as-is',
    captureVersion: version,
    patchDigest: capture.patchDigest,
    summaryVersion,
  });
  const changedCapture = async (content = 'updated first\n') => {
    writeFileSync(join(root, 'first.txt'), content);
    return captureWorkingTree({ cwd: root, pathspecs: ['first.txt'] });
  };

  beforeEach(async () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
    }
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-named-http-')));
    cleanupDirectories.push(root);
    git('init', '--quiet');
    writeFileSync(join(root, 'first.txt'), 'before first\n');
    writeFileSync(join(root, 'second.txt'), 'before second\n');
    git('add', 'first.txt', 'second.txt');
    git('commit', '--quiet', '--no-verify', '-m', 'fixture');
    writeFileSync(join(root, 'first.txt'), 'captured first\n');
    writeFileSync(join(root, 'second.txt'), 'another task\n');
    initialCapture = await captureWorkingTree({ cwd: root, pathspecs: ['first.txt'] });
    indexBefore = readFileSync(join(root, '.git', 'index'));
    events = [];
    running = await startServer({
      namedReview: { name, capture: initialCapture },
      repoPath: root,
      preferredPort: 0,
      openBrowser: false,
      keepAlive: true,
      shipIt: true,
      conversation: true,
      onEvent: (event) => events.push(event),
    });
  });

  afterEach(async () => {
    await running?.shutdown('closed');
    running = undefined;
    vi.unstubAllEnvs();
    for (const directory of cleanupDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('serves the frozen capture across refreshes without recapturing or writing the index', async () => {
    const first = await get<DiffResponse>(`/api/diff${query}`);
    const metadata = await review();
    expect(first.capture).toMatchObject({
      name,
      version: 1,
      patchDigest: initialCapture.patchDigest,
    });
    expect(first.files.map((file) => file.path)).toEqual(['first.txt']);
    expect(first.files[0]?.chunks.flatMap((chunk) => chunk.lines)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'add', content: 'captured first' })]),
    );
    expect(metadata).toMatchObject({
      name,
      version: 1,
      patchDigest: initialCapture.patchDigest,
      repositoryId: initialCapture.repositoryId,
      files: JSON.parse(JSON.stringify(initialCapture.files)) as CapturedFile[],
      reviewId: expect.any(String),
    });
    writeFileSync(join(root, 'first.txt'), 'later shared edit\n');
    writeFileSync(join(root, 'untracked.txt'), 'untracked after capture\n');

    expect(await get<DiffResponse>(`/api/diff${query}`)).toEqual(first);
    expect(await get<DiffResponse>(`/api/diff${query}`)).toEqual(first);
    expect(await review()).toEqual(metadata);
    expect(readFileSync(join(root, '.git', 'index'))).toEqual(indexBefore);
    expect(readFileSync(join(root, 'first.txt'), 'utf8')).toBe('later shared edit\n');
    expect(readFileSync(join(root, 'second.txt'), 'utf8')).toBe('another task\n');
    expect(readFileSync(join(root, 'untracked.txt'), 'utf8')).toBe('untracked after capture\n');
  });

  it('names the launched review as the diff the revision menu offers', async () => {
    const revisions = await get<RevisionsResponse>('/api/revisions');
    expect(revisions.launch).toMatchObject({ reviewName: name });
  });

  it('accepts a task capture on a stdin server launched from a repository subdirectory', async () => {
    await running?.shutdown('closed');
    const subdirectory = join(root, 'nested');
    mkdirSync(subdirectory);
    running = await startServer({
      stdinDiff: initialCapture.patch,
      repoPath: subdirectory,
      preferredPort: 0,
      openBrowser: false,
      keepAlive: true,
      conversation: true,
    });
    const result = await post<ReviewResponse>('/api/reviews', {
      name: 'from-subdirectory',
      capture: initialCapture,
    });
    expect(result).toMatchObject({
      name: 'from-subdirectory',
      version: 1,
      repositoryId: initialCapture.repositoryId,
      updated: true,
    });
    const namedDiff = await get<DiffResponse>('/api/diff?review=from-subdirectory');
    expect(namedDiff.files.map((file) => file.path)).toEqual(['first.txt']);
    // A named review's drafts are keyed by its name, not by the server's stdin patch.
    expect(namedDiff.stdinDiffDigest).toBeUndefined();
  });

  it('retains the conversation, proposal and original comment anchor while replacing a capture', async () => {
    const before = await review();
    const saved = await post<CommentsResponse>(`/api/comments${query}`, {
      threads: [lineThread()],
    });
    const anchor = { version: 1, patchDigest: initialCapture.patchDigest };
    expect(saved.threads[0]?.capture).toEqual(anchor);
    const summary = await proposeSummary({
      commitMessage: 'fix: preserve captured task discussion',
      rationale: 'Carry the discussion through requested fixes.',
      baseVersion: 0,
    });
    await put<ReviewApproval>(`/api/approval${query}`, binding(initialCapture, 1, summary.version));
    const next = await changedCapture();
    const eventStart = events.length;
    const updated = await post<ReviewResponse>(`/api/reviews/${name}/capture`, {
      expectedVersion: 1,
      capture: next,
    });

    expect(updated).toMatchObject({
      reviewId: before.reviewId,
      name,
      version: 2,
      patchDigest: next.patchDigest,
      updated: true,
    });
    expect(await get<ReviewSummary>(`/api/review-summary${query}`)).toEqual(summary);
    expect((await approval()).verdict).toBeUndefined();
    const comments = await get<CommentsResponse>(`/api/comments-json${query}`);
    expect(comments.threads).toHaveLength(1);
    expect(comments.threads[0]).toMatchObject({
      id: 'question',
      capture: anchor,
      codeSnapshot: { content: 'captured first' },
      messages: [{ id: 'question-message', body: 'Keep this discussion.' }],
    });
    const retained = (await snapshot()).reviews.find((entry) => entry.id === before.reviewId);
    expect(retained).toMatchObject({
      selection: { reviewName: name },
      summary,
      capture: { version: 2, patchDigest: next.patchDigest },
      approval: expect.not.objectContaining({ verdict: expect.anything() }),
      threads: [{ capture: anchor }],
    });
    expect(events.slice(eventStart)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'review.capture',
          reviewId: before.reviewId,
          capture: expect.objectContaining({ version: 2, patchDigest: next.patchDigest }),
        }),
        expect.objectContaining({
          type: 'review.approval',
          reviewId: before.reviewId,
          approval: expect.not.objectContaining({ verdict: expect.anything() }),
        }),
      ]),
    );
    const historical = await get<ReviewResponse>(`/api/reviews/${name}?version=1`);
    expect(historical).toMatchObject({
      reviewId: before.reviewId,
      version: 1,
      patchDigest: initialCapture.patchDigest,
      files: JSON.parse(JSON.stringify(initialCapture.files)) as CapturedFile[],
    });

    const oldThread = comments.threads[0]!;
    const reply = {
      id: 'reply',
      body: 'Fixed in the next capture.',
      createdAt: now,
      updatedAt: now,
    };
    const replied = await post<CommentsResponse>(`/api/comments${query}`, {
      baseVersion: comments.version,
      threads: [{ ...oldThread, messages: [...oldThread.messages, reply] }],
    });
    expect(replied.threads[0]?.capture).toEqual(anchor);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'comment.created',
          messageId: 'reply',
          reviewId: before.reviewId,
          anchorCapture: anchor,
          capture: expect.objectContaining({ version: 2, patchDigest: next.patchDigest }),
        }),
      ]),
    );
    expect(readFileSync(join(root, '.git', 'index'))).toEqual(indexBefore);
    expect(readFileSync(join(root, 'first.txt'), 'utf8')).toBe('updated first\n');
  });

  it('leaves approval and capture events unchanged for an identical capture', async () => {
    const before = await review();
    const approved = await put<ReviewApproval>(`/api/approval${query}`, binding(initialCapture, 1));
    const eventStart = events.length;
    const updated = await post<ReviewResponse>(`/api/reviews/${name}/capture`, {
      expectedVersion: 1,
      capture: initialCapture,
    });

    expect(approved).toMatchObject(binding(initialCapture, 1));
    expect(updated).toMatchObject({
      reviewId: before.reviewId,
      version: 1,
      patchDigest: initialCapture.patchDigest,
      updated: false,
    });
    expect(await approval()).toEqual(approved);
    expect(
      events
        .slice(eventStart)
        .filter((event) => event.type === 'review.capture' || event.type === 'review.approval'),
    ).toEqual([]);
  });

  it('rejects stale captures, repeated stale digests and approval of an older capture or proposal', async () => {
    const next = await changedCapture();
    await post<ReviewResponse>(`/api/reviews/${name}/capture`, {
      expectedVersion: 1,
      capture: next,
    });
    const current = await review();
    const eventStart = events.length;
    for (const suppliedCapture of [initialCapture, next]) {
      await post(
        `/api/reviews/${name}/capture`,
        { expectedVersion: 1, capture: suppliedCapture },
        409,
      );
    }
    await put(`/api/approval${query}`, binding(initialCapture, 1), 409);
    await put(
      `/api/approval${query}`,
      { ...binding(next, 2), patchDigest: initialCapture.patchDigest },
      409,
    );
    expect((await approval()).verdict).toBeUndefined();
    expect(await review()).toEqual(current);
    expect(events.slice(eventStart)).toEqual([]);

    const summary = await proposeSummary({
      commitMessage: 'fix: update the proposed change',
      rationale: 'A revised proposal.',
      baseVersion: 0,
    });
    await put(`/api/approval${query}`, binding(next, 2, 0), 409);
    expect((await approval()).verdict).toBeUndefined();
    expect(
      await put<ReviewApproval>(`/api/approval${query}`, binding(next, 2, summary.version)),
    ).toMatchObject(binding(next, 2, summary.version));
  });

  it('records reject for the displayed capture only, and keeps it on recapture', async () => {
    const rejectBinding = {
      verdict: 'reject',
      captureVersion: 1,
      patchDigest: initialCapture.patchDigest,
    };
    await put(`/api/approval${query}`, { ...rejectBinding, captureVersion: 2 }, 409);
    expect((await approval()).verdict).toBeUndefined();
    const verdict = await put<ReviewApproval>(`/api/approval${query}`, rejectBinding);
    expect(verdict).toMatchObject({ verdict: 'reject', captureVersion: 1 });

    // A rejected change is done with, so only the reviewer ends the verdict.
    const next = await changedCapture();
    await post(`/api/reviews/${name}/capture`, { expectedVersion: 1, capture: next });
    expect(await approval()).toMatchObject({ verdict: 'reject', captureVersion: 1 });
  });

  it('files comment imports under the named review that ?review= selects', async () => {
    const otherName = 'other-agent';
    await post('/api/reviews', { name: otherName, capture: initialCapture });
    await post(`/api/comment-imports?review=${otherName}`, {
      type: 'thread',
      filePath: 'first.txt',
      position: { side: 'new', line: 1 },
      body: 'Guide for the other task.',
    });

    const bodies = async (reviewQuery: string) =>
      (await get<CommentsResponse>(`/api/comments-json${reviewQuery}`)).threads.flatMap((thread) =>
        thread.messages.map((message) => message.body),
      );
    expect(await bodies(`?review=${otherName}`)).toEqual(['Guide for the other task.']);
    expect(await bodies(query)).toEqual([]);
  });

  it('keeps two named tasks independent even when their patch digests match', async () => {
    const first = await review();
    const otherName = 'other-agent';
    const otherQuery = `?review=${otherName}`;
    const other = await post<ReviewResponse>('/api/reviews', {
      name: otherName,
      capture: initialCapture,
    });
    expect(other).toMatchObject({
      name: otherName,
      version: 1,
      patchDigest: initialCapture.patchDigest,
    });
    expect(other.reviewId).not.toBe(first.reviewId);
    await post(`/api/comments${query}`, { threads: [lineThread('first-question')] });
    await post(`/api/comments${otherQuery}`, { threads: [lineThread('other-question')] });
    const summary = await proposeSummary({
      commitMessage: 'fix: first task',
      rationale: 'First task only.',
      baseVersion: 0,
    });
    await put(`/api/approval${query}`, binding(initialCapture, 1, summary.version));
    await put(`/api/approval${otherQuery}`, binding(initialCapture, 1));
    const next = await changedCapture();
    await post(`/api/reviews/${name}/capture`, { expectedVersion: 1, capture: next });

    expect(
      (await get<CommentsResponse>(`/api/comments-json${query}`)).threads.map(
        (thread) => thread.id,
      ),
    ).toEqual(['first-question']);
    expect(
      (await get<CommentsResponse>(`/api/comments-json${otherQuery}`)).threads.map(
        (thread) => thread.id,
      ),
    ).toEqual(['other-question']);
    expect(await get<ReviewSummary>(`/api/review-summary${otherQuery}`)).toMatchObject({
      commitMessage: '',
      rationale: '',
      version: 0,
    });
    expect(await get<ReviewApproval>(`/api/approval${otherQuery}`)).toMatchObject({
      verdict: 'as-is',
      captureVersion: 1,
    });
    expect((await approval()).verdict).toBeUndefined();
    expect(await get<ReviewResponse>(`/api/reviews/${otherName}`)).toMatchObject({
      reviewId: other.reviewId,
      version: 1,
      patchDigest: initialCapture.patchDigest,
    });
    const retained = (await snapshot()).reviews.filter((entry) => entry.selection.reviewName);
    expect(retained.map((entry) => entry.id).sort()).toEqual(
      [first.reviewId, other.reviewId].sort(),
    );
  });

  it('renames a review with its conversation, proposal and verdict, and saves under the new name', async () => {
    const before = await review();
    await post(`/api/comments${query}`, { threads: [lineThread()] });
    const summary = await proposeSummary({
      commitMessage: 'fix: renamed task',
      rationale: 'Follows the rename.',
      baseVersion: 0,
    });
    await put(`/api/approval${query}`, binding(initialCapture, 1, summary.version));
    await post('/api/reviews', { name: 'taken', capture: initialCapture });
    await post(`/api/reviews/${name}/rename`, { name: 'taken' }, 409);
    await post('/api/reviews/missing/rename', { name: 'fresh' }, 404);
    await post(`/api/reviews/${name}/rename`, { name: 'not a name' }, 400);
    const eventStart = events.length;

    const renamed = await post<ReviewResponse>(`/api/reviews/${name}/rename`, {
      name: 'renamed-task',
    });

    expect(renamed).toMatchObject({ reviewId: before.reviewId, name: 'renamed-task', version: 1 });
    await request(`/api/reviews/${name}`, 'GET', undefined, 404);
    const renamedQuery = '?review=renamed-task';
    expect(
      (await get<CommentsResponse>(`/api/comments-json${renamedQuery}`)).threads.map(
        (thread) => thread.id,
      ),
    ).toEqual(['question']);
    expect(await get<ReviewSummary>(`/api/review-summary${renamedQuery}`)).toEqual(summary);
    expect(await get<ReviewApproval>(`/api/approval${renamedQuery}`)).toMatchObject({
      verdict: 'as-is',
    });
    // The launched review was the current one, so the default diff and revisions follow it.
    expect((await get<DiffResponse>('/api/diff')).capture?.name).toBe('renamed-task');
    expect((await get<RevisionsResponse>('/api/revisions')).launch?.reviewName).toBe(
      'renamed-task',
    );
    expect(events.slice(eventStart)).toEqual([
      expect.objectContaining({
        type: 'review.renamed',
        reviewId: before.reviewId,
        previousName: name,
        capture: expect.objectContaining({ name: 'renamed-task' }),
      }),
    ]);
    const names = (await snapshot()).reviews.map((entry) => entry.selection.reviewName);
    expect(names).toHaveLength(2);
    expect(names).toEqual(expect.arrayContaining(['renamed-task', 'taken']));
  });

  it('deletes a review, keeps its threads in deletedReviews, and frees its name', async () => {
    const before = await review();
    await post(`/api/comments${query}`, { threads: [lineThread()] });
    await request('/api/reviews/missing', 'DELETE', undefined, 404);
    const eventStart = events.length;

    expect(await request(`/api/reviews/${name}`, 'DELETE')).toEqual({
      reviewId: before.reviewId,
      name,
      deleted: true,
    });

    await request(`/api/reviews/${name}`, 'GET', undefined, 404);
    await request(`/api/comments-json${query}`, 'GET', undefined, 404);
    // The default diff no longer names the deleted review, and reading it recreates nothing.
    expect((await get<DiffResponse>('/api/diff')).capture).toBeUndefined();
    const after = await snapshot();
    expect(after.reviews.some((entry) => entry.selection.reviewName === name)).toBe(false);
    expect(after.deletedReviews).toEqual([
      expect.objectContaining({
        id: before.reviewId,
        selection: expect.objectContaining({ reviewName: name }),
        threads: [expect.objectContaining({ id: 'question' })],
      }),
    ]);
    expect((await get<RevisionsResponse>('/api/revisions')).launch).toBeUndefined();
    expect(events.slice(eventStart)).toEqual([
      expect.objectContaining({ type: 'review.deleted', reviewId: before.reviewId }),
    ]);
    await post(
      '/api/conversation/reply',
      { reviewId: before.reviewId, threadId: 'question', inReplyTo: 'question-message', body: 'x' },
      404,
    );

    const recreated = await post<ReviewResponse>('/api/reviews', {
      name,
      capture: initialCapture,
    });
    expect(recreated.reviewId).not.toBe(before.reviewId);
    expect((await get<CommentsResponse>(`/api/comments-json${query}`)).threads).toEqual([]);
  });

  it('files a default-selection comment after a delete under the diff the default view shows', async () => {
    await request(`/api/reviews/${name}`, 'DELETE');
    await post('/api/comments', { threads: [lineThread()] });
    await get<DiffResponse>('/api/diff');
    expect(
      (await get<CommentsResponse>('/api/comments-json')).threads.map((thread) => thread.id),
    ).toEqual(['question']);
  });

  it('deletes the shown review in a repository with no commits yet', async () => {
    await running?.shutdown('closed');
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-named-unborn-')));
    cleanupDirectories.push(root);
    git('init', '--quiet');
    writeFileSync(join(root, 'first.txt'), 'first\n');
    git('add', 'first.txt');
    const capture = await captureWorkingTree({ cwd: root, pathspecs: ['first.txt'] });
    expect(capture.baseCommit).toBe('unborn');
    running = await startServer({
      namedReview: { name, capture },
      repoPath: root,
      preferredPort: 0,
      openBrowser: false,
      keepAlive: true,
      conversation: true,
    });

    expect(await request(`/api/reviews/${name}`, 'DELETE')).toMatchObject({ deleted: true });
  });

  it('rejects foreign and tampered captures without changing either review state or working files', async () => {
    const before = await review();
    const foreignRoot = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-named-foreign-')));
    cleanupDirectories.push(foreignRoot);
    const foreign = capturePatch(initialCapture.patch, {
      repositoryRoot: foreignRoot,
      baseCommit: initialCapture.baseCommit,
    });
    const tampered = {
      ...initialCapture,
      patch: initialCapture.patch.replace('+captured first', '+tampered'),
    };
    const eventStart = events.length;
    for (const invalid of [foreign, tampered]) {
      await post('/api/reviews', { name: 'invalid-task', capture: invalid }, 400);
      await post(`/api/reviews/${name}/capture`, { expectedVersion: 1, capture: invalid }, 400);
    }
    await request('/api/reviews/invalid-task', 'GET', undefined, 404);
    await post('/api/reviews', { name, capture: initialCapture }, 409);
    await post(
      '/api/reviews/unknown-task/capture',
      { expectedVersion: 1, capture: initialCapture },
      404,
    );
    expect(await review()).toEqual(before);
    expect(events.slice(eventStart)).toEqual([]);
    expect(readFileSync(join(root, '.git', 'index'))).toEqual(indexBefore);
    expect(readFileSync(join(root, 'first.txt'), 'utf8')).toBe('captured first\n');
    expect(readFileSync(join(root, 'second.txt'), 'utf8')).toBe('another task\n');
  });
  it('keeps ordinary context endpoints available after another tab opens a named review', async () => {
    await running?.shutdown('closed');
    running = await startServer({
      selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
      repoPath: root,
      preferredPort: 0,
      openBrowser: false,
      keepAlive: true,
      conversation: true,
    });
    const paths = [
      '/api/blob/first.txt?ref=.',
      '/api/line-count/first.txt?oldRef=.&newRef=.',
      '/api/generated-status/first.txt?ref=.',
    ];
    const responses = async () => {
      const values: Array<{ status: number; body: string }> = [];
      for (const path of paths) {
        const response = await fetch(`${running!.url}${path}`);
        values.push({ status: response.status, body: await response.text() });
      }
      return values;
    };
    const before = await responses();
    expect(before.map((value) => value.status)).toEqual([200, 200, 200]);
    await post('/api/reviews', { name, capture: initialCapture });
    await get<DiffResponse>(`/api/diff${query}`);
    expect(await responses()).toEqual(before);
    for (const path of paths) {
      const response = await fetch(`${running.url}${path}&review=${name}`);
      expect(response.status).toBe(404);
      await response.text();
    }
  });

  it.each([
    ['the current baseVersion', (version: number): number | undefined => version],
    // Both of these merge, which folds the two matching threads into one.
    ['no baseVersion', (): number | undefined => undefined],
    ['a stale baseVersion', (version: number): number | undefined => version + 1],
  ])(
    'rejects unretained per-thread anchors before applying any comments, with %s',
    async (_label, baseVersion) => {
      const before = await get<CommentsResponse>(`/api/comments-json${query}`);
      for (const capture of [
        { version: 99, patchDigest: 'bogus' },
        { version: 1, patchDigest: '0'.repeat(64) },
        { version: 0, patchDigest: initialCapture.patchDigest },
      ]) {
        await post(
          `/api/comments${query}`,
          {
            baseVersion: baseVersion(before.version),
            captureVersion: 1,
            patchDigest: initialCapture.patchDigest,
            threads: [lineThread('valid-first'), { ...lineThread('invalid-second'), capture }],
          },
          400,
        );
        expect(await get<CommentsResponse>(`/api/comments-json${query}`)).toEqual(before);
      }
      expect(events.some((event) => event.type === 'comment.created')).toBe(false);
    },
  );

  it('does not look up a capture for each saved thread when comments are posted', async () => {
    const threads = Array.from({ length: 20 }, (_, index) => lineThread(`saved-${index}`));
    const before = await get<CommentsResponse>(`/api/comments-json${query}`);
    const saved = await post<CommentsResponse>(`/api/comments${query}`, {
      baseVersion: before.version,
      threads,
    });
    // Each lookup deep-copies the whole capture, so its count must not grow with the threads.
    const lookups = vi.spyOn(NamedReviewStore.prototype, 'get');
    await post(`/api/comments${query}`, { baseVersion: saved.version, threads: saved.threads });
    expect(lookups.mock.calls.length).toBeLessThan(threads.length);
    lookups.mockRestore();
  });

  it('retains a valid per-thread older capture and ignores attempts to replace a saved anchor', async () => {
    const next = await changedCapture();
    await post(`/api/reviews/${name}/capture`, { expectedVersion: 1, capture: next });
    const anchor = { version: 1, patchDigest: initialCapture.patchDigest };
    const thread = { ...lineThread(), capture: { ...anchor, ignoredPayloadField: true } };
    const saved = await post<CommentsResponse>(`/api/comments${query}`, {
      captureVersion: 2,
      patchDigest: next.patchDigest,
      threads: [thread],
    });
    expect(saved.threads[0]?.capture).toEqual(anchor);
    const replay = await post<CommentsResponse>(`/api/comments${query}`, {
      threads: [{ ...thread, capture: { version: 99, patchDigest: 'bogus' } }],
    });
    expect(replay.threads[0]?.capture).toEqual(anchor);
  });

  it('keeps import validation atomic and preserves retained anchors while stamping new imports', async () => {
    await post(`/api/comments${query}`, { threads: [lineThread()] });
    const next = await changedCapture();
    await post(`/api/reviews/${name}/capture`, { expectedVersion: 1, capture: next });
    const before = await get<CommentsResponse>(`/api/comments-json${query}`);
    const imported = {
      id: 'imported',
      type: 'thread',
      filePath: 'first.txt',
      position: { side: 'new', line: 1 },
      body: 'Imported after capture update.',
      capture: { version: 99, patchDigest: 'bogus' },
    };
    await post(
      `/api/comment-imports${query}`,
      [imported, { ...imported, id: 'invalid', position: { side: 'new', line: 0 } }],
      400,
    );
    expect(await get<CommentsResponse>(`/api/comments-json${query}`)).toEqual(before);
    await post(`/api/comment-imports${query}`, [imported]);
    const saved = await get<CommentsResponse>(`/api/comments-json${query}`);
    expect(saved.threads.find((thread) => thread.id === 'question')?.capture).toEqual({
      version: 1,
      patchDigest: initialCapture.patchDigest,
    });
    expect(saved.threads.find((thread) => thread.id === 'imported')?.capture).toEqual({
      version: 2,
      patchDigest: next.patchDigest,
    });
  });

  it('drops client capture stamps from ordinary comments', async () => {
    const saved = await post<CommentsResponse>('/api/comments?base=HEAD&target=.', {
      threads: [{ ...lineThread(), capture: { version: 99, patchDigest: 'bogus' } }],
    });
    expect(saved.threads[0]?.capture).toBeUndefined();
    const ordinary = (await snapshot()).reviews.find(
      (review) => review.selection.reviewName === undefined,
    );
    expect(ordinary?.threads[0]?.capture).toBeUndefined();
  });

  it('keeps ordinary JSON body limits unchanged', async () => {
    await running?.shutdown('closed');
    running = await startServer({
      stdinDiff: initialCapture.patch,
      repoPath: root,
      preferredPort: 0,
      openBrowser: false,
      keepAlive: true,
      conversation: true,
    });
    const body = JSON.stringify({ threads: [], padding: 'x'.repeat(200 * 1024) });
    const statuses: number[] = [];
    for (const [path, method, contentType] of [
      ['/api/comments', 'POST', 'application/json'],
      ['/api/auto-viewed-patterns', 'PUT', 'application/json'],
    ] as const) {
      const response = await fetch(`${running.url}${path}`, {
        method,
        headers: { 'Content-Type': contentType },
        body,
      });
      statuses.push(response.status);
      await response.text();
    }
    expect(statuses).toEqual([413, 413]);
  });

  it('accepts named JSON bodies above the ordinary default budget', async () => {
    const patch =
      '--- a/first.txt\n+++ b/first.txt\n@@ -1 +1 @@\n-before\n+' + 'x'.repeat(200 * 1024) + '\n';
    const capture = capturePatch(patch, initialCapture);
    expect(Buffer.byteLength(JSON.stringify({ name: 'large-valid', capture }))).toBeGreaterThan(
      100 * 1024,
    );
    expect(
      await post<ReviewResponse>('/api/reviews', { name: 'large-valid', capture }),
    ).toMatchObject({
      name: 'large-valid',
      version: 1,
      patchDigest: capture.patchDigest,
    });
    expect(
      await post<ReviewResponse>(`/api/reviews/${name}/capture`, { expectedVersion: 1, capture }),
    ).toMatchObject({
      name,
      version: 2,
      patchDigest: capture.patchDigest,
    });
  });

  it('returns JSON for oversized create and update bodies without changing a review', async () => {
    const patch =
      '--- a/first.txt\n+++ b/first.txt\n@@ -1 +1 @@\n-before\n+' +
      '\u0001'.repeat(3 * 1024 * 1024) +
      '\n';
    const capture = capturePatch(patch, initialCapture);
    expect(Buffer.byteLength(patch)).toBeLessThan(8 * 1024 * 1024);
    expect(Buffer.byteLength(JSON.stringify({ capture }))).toBeGreaterThan(16 * 1024 * 1024);
    const before = await review();
    for (const [path, body] of [
      ['/api/reviews', { name: 'large-task', capture }],
      [`/api/reviews/${name}/capture`, { expectedVersion: 1, capture }],
    ] as const) {
      const result = await post<{ error: string }>(path, body, 413);
      expect(result.error).toContain('16 MiB serialized JSON limit');
    }
    expect(await review()).toEqual(before);
  });

  it('rejects programmatic named reviews with explicitly disabled conversation mode', async () => {
    // Ground truth: named review state requires conversation mode; an explicit false must not bind an API server.
    const disabled = startServer({
      namedReview: { name: 'disabled-task', capture: initialCapture },
      repoPath: root,
      preferredPort: 0,
      openBrowser: false,
      keepAlive: true,
      conversation: false,
    });
    try {
      await expect(disabled).rejects.toThrow('Named reviews require conversation mode');
    } finally {
      const unexpected = await disabled.catch(() => undefined);
      await unexpected?.shutdown('closed');
    }
  });
});
