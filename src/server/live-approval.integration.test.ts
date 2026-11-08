import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

import { fetch } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationSnapshot, ReviewApproval } from '../types/conversation.js';
import type { DiffResponse } from '../types/diff.js';
import { DiffMode } from '../types/watch.js';

import { GitDiffParser } from './git-diff.js';
import { startServer } from './server.js';

describe('approval of a staged review', () => {
  let root: string;
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
        env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull },
        encoding: 'utf8',
      },
    );
  }

  async function call<T>(path: string, body?: unknown, status = 200): Promise<T> {
    if (!running) throw new Error('Fixture server has not started');
    const response = await fetch(new URL(path, running.url), {
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    expect(response.status).toBe(status);
    return (await response.json()) as T;
  }

  const approvalPath = (diff: DiffResponse) =>
    `/api/approval?${new URLSearchParams({
      base: diff.baseCommitish!,
      target: diff.targetCommitish!,
    })}`;

  const approvalOf = async (diff: DiffResponse) => {
    const snapshot = await call<ConversationSnapshot>('/api/conversation/snapshot');
    return snapshot.reviews.find((review) => review.selection.baseCommitish === diff.baseCommitish)
      ?.approval;
  };

  beforeEach(async () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
    }
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-live-approval-')));
    git('init', '--quiet');
    writeFileSync(join(root, 'a.txt'), 'one\n');
    writeFileSync(join(root, 'b.txt'), 'two\n');
    git('add', 'a.txt', 'b.txt');
    git('commit', '--quiet', '-m', 'fixture root');
    writeFileSync(join(root, 'a.txt'), 'one changed\n');
    git('add', 'a.txt');
  });

  // Without a file watcher the server caches each diff, so start it after staging.
  async function startDiff(): Promise<DiffResponse> {
    running = await startServer({
      repoPath: root,
      preferredPort: 0,
      openBrowser: false,
      keepAlive: true,
      conversation: true,
      shipIt: true,
      diffMode: DiffMode.SPECIFIC,
      selection: { baseCommitish: 'HEAD', targetCommitish: 'staged' },
    });
    return call<DiffResponse>('/api/diff');
  }

  afterEach(async () => {
    await running?.shutdown('closed');
    running = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('records the digest of the approved diff', async () => {
    const diff = await startDiff();
    expect(diff.diffDigest).toMatch(/^[0-9a-f]{64}$/);
    const approval = await call<ReviewApproval>(approvalPath(diff), {
      approved: true,
      diffDigest: diff.diffDigest,
    });
    expect(approval).toMatchObject({ approved: true, diffDigest: diff.diffDigest });
    expect(await approvalOf(diff)).toMatchObject({ approved: true });
  });

  it('keeps whitespace in the digest when the diff hides it', async () => {
    writeFileSync(join(root, 'b.txt'), 'two \n');
    git('add', 'b.txt');
    const diff = await startDiff();
    const hidden = await call<DiffResponse>('/api/diff?ignoreWhitespace=true');
    expect(hidden.files.map((file) => file.path)).toEqual(['a.txt']);
    expect(hidden.diffDigest).toBe(diff.diffDigest);
  });

  it('refuses an approval of a diff that has since changed', async () => {
    const diff = await startDiff();
    writeFileSync(join(root, 'b.txt'), 'two changed\n');
    git('add', 'b.txt');
    await call(approvalPath(diff), { approved: true, diffDigest: diff.diffDigest }, 409);
    await call(approvalPath(diff), { approved: true }, 409);
    expect(await approvalOf(diff)).toMatchObject({ approved: false });
  });

  it('revokes an approval when more changes are staged', async () => {
    const diff = await startDiff();
    await call(approvalPath(diff), { approved: true, diffDigest: diff.diffDigest });
    writeFileSync(join(root, 'b.txt'), 'two changed\n');
    git('add', 'b.txt');
    expect(await call<ReviewApproval>(approvalPath(diff))).toMatchObject({ approved: false });
    expect(await approvalOf(diff)).toMatchObject({ approved: false });
  });

  it('refuses not yet for a diff that has since changed', async () => {
    const diff = await startDiff();
    writeFileSync(join(root, 'b.txt'), 'two changed\n');
    git('add', 'b.txt');
    await call(
      approvalPath(diff).replace('/api/approval', '/api/approval/not-yet'),
      { approved: false, diffDigest: diff.diffDigest },
      409,
    );
    expect((await approvalOf(diff))?.notYet).toBeUndefined();
  });

  it('clears not yet when more changes are staged', async () => {
    const diff = await startDiff();
    expect(
      await call<ReviewApproval>(
        approvalPath(diff).replace('/api/approval', '/api/approval/not-yet'),
        { approved: false, diffDigest: diff.diffDigest },
      ),
    ).toMatchObject({ approved: false, notYet: true, diffDigest: diff.diffDigest });
    writeFileSync(join(root, 'b.txt'), 'two changed\n');
    git('add', 'b.txt');
    expect((await call<ReviewApproval>(approvalPath(diff))).notYet).toBeUndefined();
    expect((await approvalOf(diff))?.notYet).toBeUndefined();
  });

  it('revokes an approval when a binary staged file changes', async () => {
    writeFileSync(join(root, 'c.bin'), Buffer.from([0, 1, 2, 3]));
    git('add', 'c.bin');
    const diff = await startDiff();
    await call(approvalPath(diff), { approved: true, diffDigest: diff.diffDigest });
    writeFileSync(join(root, 'c.bin'), Buffer.from([0, 1, 2, 4]));
    git('add', 'c.bin');
    expect(await approvalOf(diff)).toMatchObject({ approved: false });
  });

  it('serves the changed diff after refusing an approval, so the reviewer can approve it', async () => {
    const diff = await startDiff();
    writeFileSync(join(root, 'b.txt'), 'two changed\n');
    git('add', 'b.txt');
    await call(approvalPath(diff), { approved: true, diffDigest: diff.diffDigest }, 409);
    const reloaded = await call<DiffResponse>('/api/diff');
    expect(reloaded.files.map((file) => file.path)).toEqual(['a.txt', 'b.txt']);
    expect(
      await call<ReviewApproval>(approvalPath(reloaded), {
        approved: true,
        diffDigest: reloaded.diffDigest,
      }),
    ).toMatchObject({ approved: true });
  });

  it('refuses an approval when the summary changes while the digest is computed', async () => {
    const diff = await startDiff();
    const original = GitDiffParser.prototype.parseDiff;
    let editSummary = true;
    vi.spyOn(GitDiffParser.prototype, 'parseDiff').mockImplementation(async function (
      this: GitDiffParser,
      ...args
    ) {
      if (editSummary) {
        editSummary = false;
        await call('/api/review-summary', {
          commitMessage: 'feat: a message the reviewer has not seen',
          rationale: '',
          baseVersion: 0,
        });
      }
      return original.apply(this, args);
    });
    await call(
      approvalPath(diff),
      { approved: true, summaryVersion: 0, diffDigest: diff.diffDigest },
      409,
    );
    expect(await approvalOf(diff)).toMatchObject({ approved: false });
  });

  it('refuses the legacy approve-and-exit route', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    await startDiff();
    await call('/api/ship-it', {}, 409);
    expect(exit).not.toHaveBeenCalled();
  });

  it('keeps an approval after comments when the agent changes the diff to address them', async () => {
    const diff = await startDiff();
    const time = '2026-11-05T00:00:00Z';
    const thread = {
      id: 'thread',
      scope: 'review',
      createdAt: time,
      updatedAt: time,
      messages: [
        {
          id: 'fix',
          origin: 'user',
          intent: 'change',
          body: 'Fix b.txt',
          createdAt: time,
          updatedAt: time,
        },
      ],
    };
    await call(
      `/api/comments?${new URLSearchParams({ base: diff.baseCommitish!, target: 'staged' })}`,
      {
        threads: [thread],
      },
    );
    const requested = await call<ReviewApproval>(
      `/api/approval/conditional?${new URLSearchParams({ base: diff.baseCommitish!, target: 'staged' })}`,
      { approved: true, mode: 'after-comments', diffDigest: diff.diffDigest },
    );
    expect(requested).toMatchObject({ approved: false, requested: true });
    expect(requested.conditions).toHaveLength(1);
    await call(
      `/api/comments?${new URLSearchParams({ base: diff.baseCommitish!, target: 'staged' })}`,
      {
        threads: [{ ...thread, resolution: { resolved: true, updatedAt: time } }],
      },
    );
    expect(await approvalOf(diff)).toMatchObject({ approved: true });

    writeFileSync(join(root, 'b.txt'), 'two fixed\n');
    git('add', 'b.txt');
    expect(await approvalOf(diff)).toMatchObject({ approved: true });
  });

  it('revokes an approval after comments with no comments when the diff changes', async () => {
    const diff = await startDiff();
    const approved = await call<ReviewApproval>(
      `/api/approval/conditional?${new URLSearchParams({ base: diff.baseCommitish!, target: 'staged' })}`,
      { approved: true, mode: 'after-comments', diffDigest: diff.diffDigest },
    );
    expect(approved).toMatchObject({ approved: true, conditions: [] });
    writeFileSync(join(root, 'b.txt'), 'two changed\n');
    git('add', 'b.txt');
    expect(await approvalOf(diff)).toMatchObject({ approved: false });
  });
});
