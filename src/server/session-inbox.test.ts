import type { QueueReceipt } from './codex-queue';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ConversationEvent,
  ConversationSnapshot,
  ConversationStreamEvent,
} from '../types/conversation';

import {
  INBOX_QUIET_MS,
  INBOX_SETTLE_MS,
  SessionInbox,
  inboxRuntimeDir,
  inboxTargetFromEnv,
  isThisHost,
  parseInboxTarget,
  sendToInbox,
  type InboxTarget,
} from './session-inbox';

const owner: InboxTarget = { sessionId: 'session-a', socket: '/run/a.sock', token: 'secret-a' };
const other: InboxTarget = { sessionId: 'session-b', socket: '/run/b.sock' };

function review(
  id: string,
  name: string,
  approved = false,
): ConversationSnapshot['reviews'][number] {
  return {
    id,
    selection: { baseCommitish: 'HEAD', targetCommitish: 'capture', reviewName: name },
    threads: [],
    approval: approved ? { verdict: 'approve' } : {},
    summary: { commitMessage: `fix: ${name}`, rationale: '', version: 1 },
  };
}

function approvalEvent(
  reviewId: string,
  origin: 'user' | 'agent' = 'user',
): Extract<ConversationStreamEvent, { type: 'review.approval' }> {
  return {
    type: 'review.approval',
    origin,
    cursor: 's:1',
    reviewId,
    selection: { baseCommitish: 'HEAD', targetCommitish: 'capture' },
    approval: { verdict: 'approve' },
    timestamp: 't',
  };
}

function commentEvent(reviewId: string, origin: 'user' | 'agent' = 'user'): ConversationEvent {
  return {
    type: 'comment.created',
    origin,
    cursor: 's:2',
    reviewId,
    selection: { baseCommitish: 'HEAD', targetCommitish: 'capture' },
    threadId: 't1',
    messageId: 'm1',
    body: 'why?',
    timestamp: 't',
  };
}

describe('SessionInbox', () => {
  let runtimeDir: string;
  let snapshot: ConversationSnapshot;
  let send: ReturnType<
    typeof vi.fn<(target: InboxTarget, content: string) => Promise<void | QueueReceipt>>
  >;
  let inbox: SessionInbox;

  beforeEach(() => {
    vi.useFakeTimers();
    runtimeDir = mkdtempSync(join(tmpdir(), 'gavel-inbox-'));
    snapshot = { cursor: 's:1', reviews: [review('r1', 'one', true), review('r2', 'two')] };
    send = vi.fn(async () => {});
    inbox = new SessionInbox({
      snapshot: () => snapshot,
      server: { host: 'localhost', port: 4966, pid: 123 },
      runtimeDir,
      send,
    });
  });

  afterEach(() => {
    inbox.dispose();
    vi.useRealTimers();
    rmSync(runtimeDir, { recursive: true, force: true });
  });

  const codex: InboxTarget = {
    kind: 'codex',
    sessionId: '01a1d14e-3f20-7a62-b380-2a1ce396a0d5',
    home: '/home/test/.codex',
  };

  it.each([{ status: 'queued' }, { status: 'uncertain', error: 'session is archived' }] as const)(
    'keeps a %s receipt without resending on drain or attach',
    async (via) => {
      send.mockResolvedValue(via);
      inbox.setOwner('r1', codex);
      expect(inbox.delivery('r1')).toEqual({ status: 'ready', transport: 'queue' });
      inbox.handle(commentEvent('r1'));
      expect(inbox.delivery('r1')).toEqual({ status: 'pending', transport: 'queue' });
      await inbox.drain();
      expect(send.mock.calls[0]?.[1]).toContain(
        'gavel comment snapshot --host localhost --port 4966',
      );
      expect(send.mock.calls[0]?.[1]).toContain('why?');
      expect(inbox.delivery('r1')).toMatchObject({ ...via, transport: 'queue' });
      expect(inbox.attach(codex)).toBeUndefined();
      await inbox.drain();
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it('includes the human text and captured code in a scoped Codex message', async () => {
    send.mockResolvedValue({ status: 'queued' });
    inbox.setOwner('r1', codex);
    const event = commentEvent('r1') as ConversationEvent & { type: 'comment.created' };
    inbox.handle({
      ...event,
      body: 'Please explain this result',
      codeSnapshot: { content: 'const result = 1;' },
    });
    await inbox.drain();
    const content = send.mock.calls[0]?.[1] ?? '';
    expect(content).toContain('Review IDs: ["r1"]');
    expect(content).toContain('"body":"Please explain this result"');
    expect(content).toContain('"code":"const result = 1;"');
    expect(content).toContain('before committing read a fresh');
  });

  it('keeps all large human context for the Codex transport to split', async () => {
    send.mockResolvedValue({ status: 'queued' });
    inbox.setOwner('r1', codex);
    const event = commentEvent('r1') as ConversationEvent & { type: 'comment.created' };
    inbox.handle({ ...event, body: '🧪'.repeat(12_000) });
    await inbox.drain();
    const content = send.mock.calls[0]?.[1] ?? '';
    expect(content).toContain('Review IDs: ["r1"]');
    expect(content).not.toContain('too large');
    expect(content).toContain('🧪'.repeat(12_000));
    expect(Buffer.byteLength(content)).toBeGreaterThan(32_000);
  });

  it('coalesces later reviews while one Codex queue command is still running', async () => {
    let finish!: () => void;
    send.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    send.mockResolvedValue({ status: 'queued' });
    inbox.setOwner('r1', codex);
    inbox.setOwner('r2', codex);
    snapshot.reviews.push(review('r3', 'three'));
    inbox.setOwner('r3', codex);
    inbox.handle(commentEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS);
    inbox.handle(approvalEvent('r2'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(send).toHaveBeenCalledTimes(1);
    inbox.handle(approvalEvent('r3'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(send).toHaveBeenCalledTimes(1);
    finish();
    await inbox.drain();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[1]).toContain('Review IDs: ["r2","r3"]');
    expect(inbox.delivery('r2')).toMatchObject({ status: 'queued', transport: 'queue' });
  });

  it('routes only human activity to its Codex owner', async () => {
    send.mockResolvedValue({ status: 'queued' });
    inbox.setOwner('r1', codex);
    inbox.setOwner('r2', other);
    inbox.handle(commentEvent('r1', 'agent'));
    inbox.handle(approvalEvent('r1', 'agent'));
    await inbox.drain();
    expect(send).not.toHaveBeenCalled();
    inbox.handle(approvalEvent('r1'));
    await inbox.drain();
    expect(send.mock.calls[0]?.[0]).toEqual(codex);
    expect(send.mock.calls[0]?.[1]).toContain('Review IDs: ["r1"]');
    expect(send.mock.calls[0]?.[1]).toContain('Do not act on other reviews');
    expect(inbox.delivery('r2')).toEqual({ status: 'ready' });
  });

  it('sends a verdict to the review owner after the settle delay', async () => {
    inbox.setOwner('r1', owner);
    inbox.handle(approvalEvent('r1'));
    expect(inbox.delivery('r1')).toEqual({ status: 'pending' });
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS - 1);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    const [target, content] = send.mock.calls[0]!;
    expect(target).toEqual(owner);
    // The agent may not have the gavel skill loaded, so the line says what Approve asks for.
    expect(content).toContain(
      '- one: Approve: address every current comment, then commit once the required checks and reviews pass\n',
    );
    expect(content).toContain('gavel comment snapshot --host localhost --port 4966');
    expect(content).toContain('"reviewId":"r1"');
    expect(content).not.toContain('"reviewId":"r2"');
    expect(content).not.toContain('secret-a');
    expect(inbox.delivery('r1')).toMatchObject({ status: 'sent' });
  });

  it('brackets an IPv6 host in the server URL', async () => {
    const v6 = new SessionInbox({
      snapshot: () => snapshot,
      server: { host: '::1', port: 4966, pid: 123 },
      runtimeDir,
      send,
    });
    v6.setOwner('r1', owner);
    v6.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(send.mock.calls[0]![1]).toContain('http://[::1]:4966');
    v6.dispose();
  });

  it('labels an unnamed review by its range and names the command when the events are too large', async () => {
    snapshot = {
      cursor: 's:1',
      reviews: [
        {
          ...review('r1', 'one', true),
          selection: { baseCommitish: 'abc1234', targetCommitish: 'staged' },
        },
      ],
    };
    inbox.setOwner('r1', owner);
    inbox.handle({ ...commentEvent('r1'), body: 'x'.repeat(60_000) });
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    const content = send.mock.calls[0]![1];
    expect(content).toContain('- abc1234..staged: Approve');
    expect(content).toContain('too large to include');
    expect(content).not.toContain('x'.repeat(100));
  });

  it('sends each event with only the fields an agent acts on', async () => {
    const capture = {
      name: 'one',
      version: 2,
      patchDigest: 'a'.repeat(64),
      baseCommit: 'b'.repeat(40),
      repositoryId: 'c'.repeat(64),
    };
    inbox.setOwner('r1', owner);
    inbox.handle({
      ...commentEvent('r1'),
      selection: { baseCommitish: 'b'.repeat(40), targetCommitish: '.', reviewName: 'one' },
      scope: 'line',
      file: 'src/a.ts',
      side: 'new',
      line: { start: 3, end: 4 },
      intent: 'question',
      author: 'User',
      codeSnapshot: { content: 'const a = 1;', language: 'typescript' },
      capture,
      anchorCapture: { version: 2, patchDigest: capture.patchDigest },
    });
    inbox.setOwner('r2', owner);
    const named = (name: string) => ({
      baseCommitish: 'HEAD',
      targetCommitish: '.',
      reviewName: name,
    });
    inbox.handle({ ...approvalEvent('r1'), selection: named('one'), capture, summaryVersion: 1 });
    inbox.handle({ ...approvalEvent('r2'), selection: named('two'), approval: {} });
    // An unnamed review is labelled by its range, as in the status lines.
    inbox.handle({ ...commentEvent('r2'), threadId: 't9', messageId: 'm9', body: 'range' });
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    const content = send.mock.calls[0]![1];
    expect(JSON.parse(content.slice(content.lastIndexOf('\n') + 1))).toEqual([
      {
        type: 'comment.created',
        review: 'one',
        reviewId: 'r1',
        threadId: 't1',
        messageId: 'm1',
        cursor: 's:2',
        intent: 'question',
        body: 'why?',
        file: 'src/a.ts',
        side: 'new',
        line: { start: 3, end: 4 },
        // feedback.md: on a frozen capture, start from the excerpt the reviewer saw.
        code: 'const a = 1;',
      },
      { type: 'review.approval', review: 'one', reviewId: 'r1', verdict: 'approve' },
      { type: 'review.approval', review: 'two', reviewId: 'r2', verdict: null },
      {
        type: 'comment.created',
        review: 'HEAD..capture',
        reviewId: 'r2',
        threadId: 't9',
        messageId: 'm9',
        cursor: 's:2',
        body: 'range',
      },
    ]);
  });

  it('sends only the events since the last message', async () => {
    inbox.setOwner('r1', owner);
    inbox.handle({ ...commentEvent('r1'), messageId: 'm1', body: 'first comment' });
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS);
    inbox.handle({ ...commentEvent('r1'), messageId: 'm2', body: 'second comment' });
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![1]).toContain('first comment');
    expect(send.mock.calls[1]![1]).toContain('second comment');
    expect(send.mock.calls[1]![1]).not.toContain('first comment');
  });

  it('drops a comment the reviewer deletes, or whose thread they delete, before it is sent', async () => {
    inbox.setOwner('r1', owner);
    inbox.handle({ ...commentEvent('r1'), messageId: 'm1', body: 'rename foo to bar' });
    inbox.handle({ ...commentEvent('r1'), type: 'comment.deleted', messageId: 'm1' } as never);
    inbox.handle({
      ...commentEvent('r1'),
      threadId: 't2',
      messageId: 'm2',
      body: 'second thought',
    });
    inbox.handle({
      type: 'thread.deleted',
      origin: 'user',
      cursor: 's:9',
      reviewId: 'r1',
      selection: { baseCommitish: 'HEAD', targetCommitish: 'capture' },
      threadId: 't2',
      timestamp: 't',
    });
    expect(inbox.delivery('r1')).toEqual({ status: 'ready' });
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps a reply on thread a:b when the reviewer deletes thread a', async () => {
    inbox.setOwner('r1', owner);
    inbox.handle({ ...commentEvent('r1'), threadId: 'a:b', messageId: 'm1', body: 'keep me' });
    inbox.handle({
      type: 'thread.deleted',
      origin: 'user',
      cursor: 's:9',
      reviewId: 'r1',
      selection: { baseCommitish: 'HEAD', targetCommitish: 'capture' },
      threadId: 'a',
      timestamp: 't',
    });
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS);
    expect(send.mock.calls[0]![1]).toContain('keep me');
  });

  it('stays sent when the reviewer deletes a comment the agent already received', async () => {
    inbox.setOwner('r1', owner);
    inbox.handle({ ...commentEvent('r1'), messageId: 'm1', body: 'old comment' });
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS);
    inbox.handle({ ...commentEvent('r1'), type: 'comment.deleted', messageId: 'm1' } as never);
    expect(inbox.delivery('r1')).toMatchObject({ status: 'sent' });
  });

  it('sends only the newest version of a comment edited before the message went out', async () => {
    inbox.setOwner('r1', owner);
    inbox.handle({ ...commentEvent('r1'), body: 'first wording' });
    inbox.handle({ ...commentEvent('r1'), type: 'comment.updated', body: 'second wording' });
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS);
    expect(send.mock.calls[0]![1]).toContain('second wording');
    expect(send.mock.calls[0]![1]).not.toContain('first wording');
  });

  it('warns in the message when review changes are not being saved', async () => {
    snapshot = { ...snapshot, store: { directory: '/repo/.git/gavel', error: 'lock held' } };
    inbox.setOwner('r1', owner);
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(send.mock.calls[0]![1]).toContain('Review changes are not being saved: lock held');
  });

  // The deleted review takes no replies or receipts, so its comments are not the agent's to answer.
  it('drops a review’s unsent activity, failed sends included, when an agent deletes it', async () => {
    inbox.setOwner('r1', owner);
    inbox.setOwner('r2', owner);
    send.mockRejectedValueOnce(new Error('connect ENOENT'));
    inbox.handle(approvalEvent('r2'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(inbox.delivery('r2').status).toBe('failed');
    inbox.handle(commentEvent('r1'));
    const deleted = { ...approvalEvent('r1', 'agent'), type: 'review.deleted' } as never;
    inbox.handle(deleted);
    inbox.handle({ ...approvalEvent('r2', 'agent'), type: 'review.deleted' } as never);
    expect(inbox.attach(owner)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS * 2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never sends for agent-origin events', async () => {
    inbox.setOwner('r1', owner);
    inbox.handle(approvalEvent('r1', 'agent'));
    inbox.handle(commentEvent('r1', 'agent'));
    inbox.handle({ ...commentEvent('r1'), type: 'comment.progress', origin: 'agent' } as never);
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing for a proposal edit; the read-only proposal change removes browser edits', async () => {
    inbox.setOwner('r1', owner);
    inbox.handle({ ...approvalEvent('r1'), type: 'review.summary' } as never);
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });

  it('waits for comments to go quiet and batches them into one message', async () => {
    inbox.setOwner('r1', owner);
    inbox.setOwner('r2', owner);
    inbox.handle(commentEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS - 1000);
    inbox.handle(commentEvent('r2'));
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS - 1);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toContain('"reviewId":"r1"');
    expect(send.mock.calls[0]![1]).toContain('"reviewId":"r2"');
  });

  it('lets a verdict send pending comments early', async () => {
    inbox.setOwner('r1', owner);
    inbox.setOwner('r2', owner);
    inbox.handle(commentEvent('r2'));
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toContain('"reviewId":"r2"');
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends to each owner separately and falls back to the default owner', async () => {
    inbox.setDefaultOwner(owner);
    inbox.setOwner('r2', other);
    inbox.handle(approvalEvent('r1'));
    inbox.handle(approvalEvent('r2'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(send.mock.calls.map(([target]) => target.sessionId).sort()).toEqual([
      'session-a',
      'session-b',
    ]);
  });

  it('reports no inbox for a review created without one, even with a default owner', async () => {
    inbox.setDefaultOwner(owner);
    inbox.setOwner('r2', null);
    inbox.handle(approvalEvent('r2'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(send).not.toHaveBeenCalled();
    expect(inbox.delivery('r2')).toEqual({ status: 'unavailable' });
  });

  it('records a failed send and hands the activity to the next attach', async () => {
    send.mockRejectedValueOnce(new Error('connect ENOENT /run/a.sock'));
    inbox.setOwner('r1', owner);
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(inbox.delivery('r1')).toMatchObject({
      status: 'failed',
      error: 'connect ENOENT /run/a.sock',
    });
    const moved = { sessionId: 'session-a', socket: '/run/a2.sock', token: 'secret-2' };
    const pending = inbox.attach(moved);
    expect(pending).toContain('one: Approve');
    expect(pending).toContain('"type":"review.approval"');
    expect(inbox.delivery('r1')).toMatchObject({ status: 'sent', via: 'prompt' });
    expect(inbox.attach(moved)).toBeUndefined();
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(send.mock.calls.at(-1)![0]).toEqual(moved);
  });

  it('ignores an attach from a session that owns no review here', () => {
    inbox.setOwner('r1', owner);
    expect(inbox.attach({ sessionId: 'stranger', socket: '/run/x.sock' })).toBeUndefined();
    expect(inbox.owns('stranger')).toBe(false);
  });

  it('registers each owning session for gavel pending and removes it on dispose', () => {
    inbox.setOwner('r1', owner);
    const file = join(runtimeDir, 'gavel', 'sessions', 'session-a', 'localhost_4966.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      host: 'localhost',
      port: 4966,
      pid: 123,
    });
    inbox.dispose();
    expect(readdirSync(join(runtimeDir, 'gavel', 'sessions', 'session-a'))).toEqual([]);
  });
});

describe('inboxTargetFromEnv', () => {
  it('reads the Claude Code session inbox', () => {
    expect(
      inboxTargetFromEnv({
        CLAUDE_CODE_SESSION_ID: 'abc-123',
        CLAUDE_CODE_MESSAGING_SOCKET: '/run/user/1000/cc-socks/9.sock',
        CLAUDE_CODE_MESSAGING_TOKEN: 'tok',
      }),
    ).toEqual({ sessionId: 'abc-123', socket: '/run/user/1000/cc-socks/9.sock', token: 'tok' });
  });

  it('needs both a session ID and a socket', () => {
    expect(inboxTargetFromEnv({ CLAUDE_CODE_MESSAGING_SOCKET: '/s.sock' })).toBeUndefined();
    expect(inboxTargetFromEnv({ CLAUDE_CODE_SESSION_ID: 'abc' })).toBeUndefined();
    expect(
      inboxTargetFromEnv({ CLAUDE_CODE_SESSION_ID: '../x', CLAUDE_CODE_MESSAGING_SOCKET: '/s' }),
    ).toBeUndefined();
  });
});

describe('sendToInbox', () => {
  let dir: string;
  let server: Server;
  afterEach(() => {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the auth line, then one user message line naming the session', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gavel-sock-'));
    const socket = join(dir, 'inbox.sock');
    const received = new Promise<string>((resolve) => {
      server = createServer((connection) => {
        let data = '';
        connection.on('data', (chunk) => (data += chunk.toString()));
        connection.on('end', () => resolve(data));
      }).listen(socket);
    });
    await new Promise((resolve) => server.once('listening', resolve));
    await sendToInbox({ sessionId: 'abc', socket, token: 'tok' }, 'hello\nworld');
    const lines = (await received).trimEnd().split('\n');
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { type: 'auth', token: 'tok' },
      { type: 'user', from: 'gavel', session_id: 'abc', message: { content: 'hello\nworld' } },
    ]);
  });

  it('rejects when nothing listens at the socket path', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gavel-sock-'));
    await expect(
      sendToInbox({ sessionId: 'abc', socket: join(dir, 'gone.sock') }, 'x'),
    ).rejects.toThrow(/ENOENT|ECONNREFUSED/);
  });
});

describe('parseInboxTarget', () => {
  it('accepts an explicitly typed Codex owner without executing caller-supplied programs', () => {
    const target = {
      kind: 'codex',
      sessionId: '01a1d14e-3f20-7a62-b380-2a1ce396a0d5',
      home: '/home/test/.codex',
    };
    expect(parseInboxTarget({ ...target, executable: '/tmp/untrusted' })).toEqual(target);
    expect(parseInboxTarget({ ...target, sessionId: 'name' })).toBeUndefined();
    expect(parseInboxTarget({ kind: 'unknown', sessionId: 'a', socket: '/s' })).toBeUndefined();
  });

  it('accepts a session ID, an absolute socket path, and an optional token', () => {
    expect(parseInboxTarget({ sessionId: 'a-1', socket: '/run/s.sock', token: 't' })).toEqual({
      sessionId: 'a-1',
      socket: '/run/s.sock',
      token: 't',
    });
    expect(parseInboxTarget({ sessionId: 'a-1', socket: '/run/s.sock' })).toEqual({
      sessionId: 'a-1',
      socket: '/run/s.sock',
    });
  });

  it.each([
    null,
    'x',
    { sessionId: 'a/b', socket: '/s' },
    { sessionId: 'a', socket: 'relative.sock' },
    { sessionId: 'a', socket: '/s', token: 5 },
  ])('rejects %j', (input) => {
    expect(parseInboxTarget(input)).toBeUndefined();
  });
});

describe('isThisHost', () => {
  it('accepts loopback addresses, including IPv4-mapped ones', () => {
    expect(isThisHost('127.0.0.1')).toBe(true);
    expect(isThisHost('::1')).toBe(true);
    expect(isThisHost('::ffff:127.0.0.1')).toBe(true);
  });

  it('rejects an address no local interface has, and a missing one', () => {
    expect(isThisHost('203.0.113.7')).toBe(false);
    expect(isThisHost(undefined)).toBe(false);
  });
});

describe('SessionInbox delivery notifications', () => {
  let runtimeDir: string;
  let inbox: SessionInbox;
  afterEach(() => {
    inbox.dispose();
    vi.useRealTimers();
    rmSync(runtimeDir, { recursive: true, force: true });
  });

  it('reports a new owner, which changes a review from unknown to ready', () => {
    runtimeDir = mkdtempSync(join(tmpdir(), 'gavel-inbox-'));
    const onDeliveryChange = vi.fn();
    inbox = new SessionInbox({
      snapshot: () => ({ cursor: 's:1', reviews: [] }),
      server: { host: 'localhost', port: 4966, pid: 1 },
      runtimeDir,
      send: async () => {},
      onDeliveryChange,
    });
    inbox.setOwner('r1', owner);
    expect(onDeliveryChange).toHaveBeenCalledTimes(1);
  });

  it('reports each delivery change so browsers can refresh', async () => {
    vi.useFakeTimers();
    runtimeDir = mkdtempSync(join(tmpdir(), 'gavel-inbox-'));
    const onDeliveryChange = vi.fn();
    inbox = new SessionInbox({
      snapshot: () => ({ cursor: 's:1', reviews: [review('r1', 'one', true)] }),
      server: { host: 'localhost', port: 4966, pid: 1 },
      runtimeDir,
      send: async () => {},
      onDeliveryChange,
    });
    inbox.setOwner('r1', owner);
    onDeliveryChange.mockClear();
    inbox.handle(approvalEvent('r1'));
    expect(onDeliveryChange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(onDeliveryChange).toHaveBeenCalledTimes(2);
  });
});

describe('SessionInbox with sends that overlap or fail', () => {
  let runtimeDir: string;
  let snapshot: ConversationSnapshot;
  let inbox: SessionInbox;
  // Each send waits until the test settles it.
  let sends: {
    target: InboxTarget;
    content: string;
    resolve: () => void;
    reject: (e: Error) => void;
  }[];

  beforeEach(() => {
    vi.useFakeTimers();
    runtimeDir = mkdtempSync(join(tmpdir(), 'gavel-inbox-'));
    snapshot = { cursor: 's:1', reviews: [review('r1', 'one', true), review('r2', 'two', true)] };
    sends = [];
    inbox = new SessionInbox({
      snapshot: () => snapshot,
      server: { host: 'localhost', port: 4966, pid: 1 },
      runtimeDir,
      send: (target, content) =>
        new Promise<void>((resolve, reject) => sends.push({ target, content, resolve, reject })),
    });
    inbox.setDefaultOwner(owner);
  });

  afterEach(() => {
    inbox.dispose();
    vi.useRealTimers();
    rmSync(runtimeDir, { recursive: true, force: true });
  });

  it('never lets a comment delay a verdict that is already due', async () => {
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(1000);
    inbox.handle(commentEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS - 1000);
    expect(sends).toHaveLength(1);
  });

  it('keeps a verdict due when it lands on the deadline comments already set', async () => {
    inbox.handle(commentEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS - 1000);
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(500);
    inbox.handle(commentEvent('r1'));
    await vi.advanceTimersByTimeAsync(500);
    expect(sends).toHaveLength(1);
  });

  it('keeps activity that arrives during a send pending after that send succeeds', async () => {
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    inbox.handle(commentEvent('r1'));
    sends[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.delivery('r1')).toEqual({ status: 'pending' });
  });

  it("keeps one send's failure when an overlapping send succeeds", async () => {
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    inbox.handle(approvalEvent('r2'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(sends).toHaveLength(2);
    sends[1]!.reject(new Error('connect ECONNREFUSED'));
    await vi.advanceTimersByTimeAsync(0);
    sends[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.delivery('r1')).toMatchObject({ status: 'sent' });
    expect(inbox.delivery('r2')).toMatchObject({ status: 'failed' });
    expect(inbox.attach(owner)).toContain('- two: Approve');
  });

  it('keeps newer activity pending when a retried review was in the finished send', async () => {
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    sends[0]!.reject(new Error('connect ENOENT'));
    await vi.advanceTimersByTimeAsync(0);
    inbox.handle(approvalEvent('r2'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(sends[1]!.content).toContain('- one: Approve');
    inbox.handle(commentEvent('r1'));
    sends[1]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.delivery('r1')).toEqual({ status: 'pending' });
    expect(inbox.delivery('r2')).toMatchObject({ status: 'sent' });
  });

  it('resends to the new inbox when the session reattaches during a send that then fails', async () => {
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    const moved = { sessionId: 'session-a', socket: '/run/a2.sock' };
    expect(inbox.attach(moved)).toBeUndefined();
    sends[0]!.reject(new Error('connect ENOENT /run/a.sock'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sends).toHaveLength(2);
    expect(sends[1]!.target).toEqual(moved);
    sends[1]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.delivery('r1')).toMatchObject({ status: 'sent', via: 'inbox' });
  });

  it('drains scheduled activity at once and waits for sends in flight', async () => {
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    inbox.handle(commentEvent('r2'));
    let drained = false;
    const drain = inbox.drain().then(() => (drained = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(sends).toHaveLength(2);
    sends[1]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(drained).toBe(false);
    sends[0]!.resolve();
    await drain;
    expect(inbox.delivery('r2')).toMatchObject({ status: 'sent' });
  });

  it('sends no empty message when a comment added and deleted during a send leaves nothing', async () => {
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    inbox.handle({ ...commentEvent('r1'), messageId: 'm9', body: 'never mind' });
    inbox.handle({ ...commentEvent('r1'), type: 'comment.deleted', messageId: 'm9' } as never);
    sends[0]!.resolve();
    await vi.advanceTimersByTimeAsync(INBOX_QUIET_MS);
    expect(sends).toHaveLength(1);
    expect(inbox.delivery('r1')).toMatchObject({ status: 'sent' });
  });

  it('does not send a review twice while a send of it is in flight', async () => {
    inbox.handle(approvalEvent('r1'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    inbox.handle(approvalEvent('r2'));
    await vi.advanceTimersByTimeAsync(INBOX_SETTLE_MS);
    expect(sends[1]!.content).not.toContain('"reviewId":"r1"');
  });
});

describe('SessionInbox registry', () => {
  let runtimeDir: string;
  afterEach(() => rmSync(runtimeDir, { recursive: true, force: true }));

  function inboxOn(host: string) {
    return new SessionInbox({
      snapshot: () => ({ cursor: 's:1', reviews: [] }),
      server: { host, port: 4988, pid: 1 },
      runtimeDir,
      send: async () => {},
    });
  }

  it('registers servers on one port and different addresses separately', () => {
    runtimeDir = mkdtempSync(join(tmpdir(), 'gavel-inbox-'));
    const first = inboxOn('127.0.0.1');
    const second = inboxOn('127.0.0.2');
    first.setDefaultOwner(owner);
    second.setDefaultOwner(owner);
    const dir = join(runtimeDir, 'gavel', 'sessions', 'session-a');
    expect(readdirSync(dir).sort()).toEqual(['127.0.0.1_4988.json', '127.0.0.2_4988.json']);
    first.dispose();
    expect(readdirSync(dir)).toEqual(['127.0.0.2_4988.json']);
    second.dispose();
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a registry directory other users can write',
    () => {
      runtimeDir = mkdtempSync(join(tmpdir(), 'gavel-inbox-'));
      mkdirSync(join(runtimeDir, 'gavel'), { mode: 0o777 });
      chmodSync(join(runtimeDir, 'gavel'), 0o777);
      expect(() => inboxOn('localhost').setDefaultOwner(owner)).toThrow(/other users cannot write/);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'refuses a runtime directory other users can write',
    () => {
      runtimeDir = mkdtempSync(join(tmpdir(), 'gavel-inbox-'));
      chmodSync(runtimeDir, 0o777);
      expect(() => inboxOn('localhost').setDefaultOwner(owner)).toThrow(/other users cannot write/);
    },
  );

  it('falls back to a per-user directory under the system temporary directory', () => {
    runtimeDir = mkdtempSync(join(tmpdir(), 'gavel-inbox-'));
    expect(inboxRuntimeDir({})).toBe(join(tmpdir(), `gavel-${process.getuid?.() ?? 'user'}`));
    expect(inboxRuntimeDir({ XDG_RUNTIME_DIR: '/run/user/1000' })).toBe('/run/user/1000');
  });
});
