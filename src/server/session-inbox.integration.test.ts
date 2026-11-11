import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

import { fetch } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffResponse } from '../types/diff.js';
import type { InboxDelivery } from '../types/presence.js';
import { DiffMode } from '../types/watch.js';

import { captureWorkingTree } from './review-capture.js';
import { startServer } from './server.js';

describe('pushing review activity to the owning session', () => {
  let root: string;
  let runtimeDir: string;
  let inboxServer: Server | undefined;
  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  const received: string[] = [];

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

  async function call<T>(path: string, body?: unknown, status = 200, method = 'POST'): Promise<T> {
    if (!running) throw new Error('Fixture server has not started');
    const response = await fetch(new URL(path, running.url), {
      ...(body === undefined
        ? {}
        : {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    expect(response.status).toBe(status);
    return (await response.json()) as T;
  }

  // A stand-in for a Claude Code inbox that records each connection's lines.
  async function listen(socket: string): Promise<void> {
    inboxServer = createServer((connection) => {
      let data = '';
      connection.on('data', (chunk) => (data += chunk.toString()));
      connection.on('end', () => received.push(data));
    });
    await new Promise<void>((resolve) => inboxServer!.listen(socket, resolve));
  }

  async function start(socket: string): Promise<DiffResponse> {
    running = await startServer({
      repoPath: root,
      preferredPort: 0,
      openBrowser: false,
      keepAlive: true,
      conversation: true,
      shipIt: true,
      diffMode: DiffMode.SPECIFIC,
      selection: { baseCommitish: 'HEAD', targetCommitish: 'staged' },
      inbox: { sessionId: 'session-a', socket, token: 'secret-token' },
    });
    return call<DiffResponse>('/api/diff');
  }

  const approve = (diff: DiffResponse) =>
    call(
      `/api/approval?${new URLSearchParams({ base: diff.baseCommitish!, target: diff.targetCommitish! })}`,
      { verdict: 'as-is', diffDigest: diff.diffDigest },
      200,
      'PUT',
    );

  async function deliveries(): Promise<InboxDelivery[]> {
    const { reviews } = await call<{ reviews: { delivery: InboxDelivery }[] }>('/api/inbox');
    return reviews.map((review) => review.delivery);
  }

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
    }
    runtimeDir = mkdtempSync(join(tmpdir(), 'gavel-runtime-'));
    vi.stubEnv('XDG_RUNTIME_DIR', runtimeDir);
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-inbox-push-')));
    git('init', '--quiet');
    writeFileSync(join(root, 'a.txt'), 'one\n');
    git('add', 'a.txt');
    git('commit', '--quiet', '-m', 'fixture root');
    writeFileSync(join(root, 'a.txt'), 'one changed\n');
    git('add', 'a.txt');
    received.length = 0;
  });

  afterEach(async () => {
    await running?.shutdown('closed');
    running = undefined;
    await new Promise((resolve) => (inboxServer ? inboxServer.close(resolve) : resolve(undefined)));
    inboxServer = undefined;
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
    rmSync(runtimeDir, { recursive: true, force: true });
  });

  it("sends a browser approval to the launching session's inbox", async () => {
    const socket = join(runtimeDir, 'inbox.sock');
    await listen(socket);
    const diff = await start(socket);
    expect(
      existsSync(
        join(
          runtimeDir,
          'gavel',
          'sessions',
          'session-a',
          `localhost_${new URL(running!.url).port}.json`,
        ),
      ),
    ).toBe(true);
    await approve(diff);
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 5000 });
    const [auth, message] = received[0]!
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(auth).toEqual({ type: 'auth', token: 'secret-token' });
    expect(message).toMatchObject({ type: 'user', from: 'gavel', session_id: 'session-a' });
    expect(message.message.content).toContain('Approve as-is');
    expect(message.message.content).not.toContain('secret-token');
    expect(await deliveries()).toEqual([expect.objectContaining({ status: 'sent', via: 'inbox' })]);
  });

  it('records a failed send and hands the approval to the next attach', async () => {
    const diff = await start(join(runtimeDir, 'gone.sock'));
    await approve(diff);
    await vi.waitFor(
      async () =>
        expect(await deliveries()).toEqual([expect.objectContaining({ status: 'failed' })]),
      { timeout: 5000 },
    );
    const { pending } = await call<{ pending: string | null }>('/api/inbox/attach', {
      sessionId: 'session-a',
      socket: join(runtimeDir, 'restarted.sock'),
    });
    expect(pending).toContain('Approve as-is');
    expect(await deliveries()).toEqual([
      expect.objectContaining({ status: 'sent', via: 'prompt' }),
    ]);
    expect(
      (
        await call<{ pending: string | null }>('/api/inbox/attach', {
          sessionId: 'session-a',
          socket: join(runtimeDir, 'restarted.sock'),
        })
      ).pending,
    ).toBeNull();
  });

  describe('reviews another process creates', () => {
    let otherServer: Server | undefined;
    const otherReceived: string[] = [];
    afterEach(async () => {
      await new Promise((resolve) =>
        otherServer ? otherServer.close(resolve) : resolve(undefined),
      );
      otherServer = undefined;
      otherReceived.length = 0;
    });

    async function createAndApprove(name: string, inbox: unknown, status = 200) {
      const capture = await captureWorkingTree({ cwd: root, pathspecs: ['a.txt'] });
      const created = await call<{ reviewId?: string }>(
        '/api/reviews',
        { name, capture, inbox },
        status,
      );
      if (status !== 200) return created;
      await call(
        `/api/approval?review=${name}`,
        { verdict: 'as-is', captureVersion: 1, patchDigest: capture.patchDigest, summaryVersion: 0 },
        200,
        'PUT',
      );
      return created;
    }

    it('sends nothing for a review whose creator had no inbox', async () => {
      const socket = join(runtimeDir, 'inbox.sock');
      await listen(socket);
      await start(socket);
      const { reviewId } = await createAndApprove('from-codex', null);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      expect(received).toEqual([]);
      const { reviews } = await call<{ reviews: { id: string; delivery: InboxDelivery }[] }>(
        '/api/inbox',
      );
      expect(reviews.find((review) => review.id === reviewId)?.delivery).toEqual({
        status: 'unavailable',
      });
    });

    it("sends a review's activity to the session that created it", async () => {
      const socket = join(runtimeDir, 'inbox.sock');
      await listen(socket);
      const otherSocket = join(runtimeDir, 'other.sock');
      otherServer = createServer((connection) => {
        let data = '';
        connection.on('data', (chunk) => (data += chunk.toString()));
        connection.on('end', () => otherReceived.push(data));
      });
      await new Promise<void>((resolve) => otherServer!.listen(otherSocket, resolve));
      await start(socket);
      await createAndApprove('from-session-b', { sessionId: 'session-b', socket: otherSocket });
      await vi.waitFor(() => expect(otherReceived).toHaveLength(1), { timeout: 5000 });
      expect(otherReceived[0]).toContain('"session_id":"session-b"');
      expect(received).toEqual([]);
    });

    it('reports in the message that another server saves the review', async () => {
      const socket = join(runtimeDir, 'inbox.sock');
      await listen(socket);
      await start(join(runtimeDir, 'unused.sock'));
      const capture = await captureWorkingTree({ cwd: root, pathspecs: ['a.txt'] });
      // The first server saves the review; a second one opening it keeps it in memory only.
      await call('/api/reviews', { name: 'shared', capture, inbox: null });
      const first = running;
      running = await startServer({
        repoPath: root,
        preferredPort: 0,
        openBrowser: false,
        keepAlive: true,
        conversation: true,
        shipIt: true,
        diffMode: DiffMode.SPECIFIC,
        selection: { baseCommitish: 'HEAD', targetCommitish: 'staged' },
        inbox: { sessionId: 'session-a', socket },
      });
      try {
        await createAndApprove('shared', { sessionId: 'session-a', socket });
        await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 5000 });
        expect(received[0]).toContain('kept in memory only');
      } finally {
        await first?.shutdown('closed');
      }
    });

    it('rejects a malformed inbox without creating the review', async () => {
      await start(join(runtimeDir, 'inbox.sock'));
      await createAndApprove('bad-inbox', { sessionId: '../x', socket: '/s' }, 400);
      await call('/api/reviews/bad-inbox', undefined, 404);
    });
  });

  it('rejects a malformed attach', async () => {
    await start(join(runtimeDir, 'inbox.sock'));
    await call('/api/inbox/attach', { sessionId: '../x', socket: '/s' }, 400);
  });

  it('removes its session registration when it shuts down', async () => {
    await start(join(runtimeDir, 'inbox.sock'));
    const file = join(
      runtimeDir,
      'gavel',
      'sessions',
      'session-a',
      `localhost_${new URL(running!.url).port}.json`,
    );
    expect(existsSync(file)).toBe(true);
    await running!.shutdown('closed');
    running = undefined;
    expect(existsSync(file)).toBe(false);
  });
});
