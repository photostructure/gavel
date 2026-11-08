import type { Server } from 'node:http';

import express from 'express';
import { fetch as realFetch } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWaitCommand } from '../cli/wait.js';
import { createCommentCommand } from '../cli/comment.js';
import type { ConversationBatch, WaitResult } from '../types/conversation.js';
import type { DiffCommentThread } from '../types/diff.js';

import { Conversation, registerConversationRoutes } from './conversation.js';
import { ReviewPresence } from './review-presence.js';

const selection = { baseCommitish: 'HEAD', targetCommitish: '.' };
const thread: DiffCommentThread = {
  id: 'thread',
  scope: 'review',
  createdAt: '2026-11-03T00:00:00Z',
  updatedAt: '2026-11-03T00:00:00Z',
  messages: [
    {
      id: 'message',
      body: 'Please explain',
      createdAt: '2026-11-03T00:00:00Z',
      updatedAt: '2026-11-03T00:00:00Z',
    },
  ],
};

describe('conversation event HTTP subscription', () => {
  const servers: Server[] = [];
  beforeEach(() => vi.stubGlobal('fetch', realFetch));
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
    process.exitCode = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function start(conversation = new Conversation(), onPoll = () => {}) {
    const app = express();
    const presence = new ReviewPresence();
    presence.connectReviewer('test-browser');
    app.use(express.json());
    app.use((req, _res, next) => {
      if (req.path === '/api/conversation/events') onPoll();
      next();
    });
    registerConversationRoutes(
      app,
      conversation,
      () => {},
      () => {},
      presence,
    );
    const server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', (error?: Error) => {
        if (error) reject(error);
        else resolve(listening);
      });
      listening.on('error', reject);
    });
    servers.push(server);
    server.once('close', () => presence.dispose());
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected listening port');
    return { conversation, server, port: address.port, url: `http://127.0.0.1:${address.port}` };
  }

  it('replays JSON events and preserves queued delivery until an explicit receipt', async () => {
    const { conversation, url } = await start();
    const cursor = conversation.cursor;
    conversation.update(selection, [], [thread], 'user');
    const batch = (await (
      await fetch(`${url}/api/conversation/events?after=${encodeURIComponent(cursor)}&wait=0`)
    ).json()) as ConversationBatch;
    expect(batch.events).toHaveLength(1);
    const event = batch.events[0]!;
    expect(event).toMatchObject({ messageId: 'message', body: 'Please explain' });
    expect(conversation.snapshot().reviews[0]?.threads[0]?.messages[0]?.progress?.status).toBe(
      'queued',
    );
    const receipt = await fetch(`${url}/api/conversation/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...event, status: 'delivered' }),
    });
    expect(receipt.status).toBe(200);
    expect(conversation.snapshot().reviews[0]?.threads[0]?.messages[0]?.progress?.status).toBe(
      'delivered',
    );
  });

  it('sends a revision-aware CLI reply to an explicitly selected interface', async () => {
    const { conversation, port } = await start();
    conversation.update(selection, [], [thread], 'user');
    const review = conversation.snapshot().reviews[0]!;
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createCommentCommand().parseAsync([
      'node',
      'gavel',
      'reply',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      JSON.stringify({
        reviewId: review.id,
        threadId: 'thread',
        inReplyTo: 'message',
        cursor: review.threads[0]!.messages[0]!.progress!.cursor,
        body: 'Answer via selected host',
      }),
    ]);
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      success: true,
      threadId: 'thread',
    });
    expect(process.exitCode).not.toBe(1);
  });

  it('validates request bounds and rejects restarted or expired cursors', async () => {
    const { url, conversation } = await start(new Conversation(undefined, 1));
    for (const query of ['wait=-1', 'wait=25001', 'wait=1.5', 'wait=1&wait=2', 'after=x&after=y'])
      expect((await fetch(`${url}/api/conversation/events?${query}`)).status).toBe(400);
    const cursor = conversation.cursor;
    conversation.setApproval(selection, true);
    conversation.setApproval(selection, false);
    for (const after of [cursor, new Conversation().cursor, `${conversation.cursor}:extra`])
      expect(
        (await fetch(`${url}/api/conversation/events?wait=0&after=${encodeURIComponent(after)}`))
          .status,
      ).toBe(409);
  });

  it('returns an empty transport batch after its HTTP wait expires', async () => {
    const { conversation, url } = await start();
    const batch = await (
      await fetch(
        `${url}/api/conversation/events?wait=1&after=${encodeURIComponent(conversation.cursor)}`,
      )
    ).json();
    expect(batch).toMatchObject({
      cursor: conversation.cursor,
      events: [],
      presence: { reviewers: { connected: 1 } },
    });
  });

  it('wakes the CLI on a new message and recovers it again until it is acknowledged', async () => {
    let pollStarted = () => {};
    const polled = new Promise<void>((resolve) => {
      pollStarted = resolve;
    });
    const { port, conversation } = await start(new Conversation(), () => pollStarted());
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const waiting = createWaitCommand().parseAsync(['node', 'gavel', '--port', String(port)]);
    await polled;
    conversation.update(selection, [], [thread], 'user');
    await waiting;
    const result = JSON.parse(String(output.mock.calls[0]?.[0])) as WaitResult;
    expect(result).toMatchObject({ type: 'wait.events', port, events: [{ messageId: 'message' }] });
    await createWaitCommand().parseAsync([
      'node',
      'gavel',
      '--port',
      String(port),
      '--after',
      result.cursor,
    ]);
    expect(output).toHaveBeenCalledTimes(2);
    expect(conversation.snapshot().reviews[0]?.threads[0]?.messages[0]?.progress?.status).toBe(
      'queued',
    );
  });

  it('finishes with a connection failure when the subscribed server exits', async () => {
    let pollStarted = () => {};
    const polled = new Promise<void>((resolve) => {
      pollStarted = resolve;
    });
    const { port, server } = await start(new Conversation(), () => pollStarted());
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const waiting = createWaitCommand().parseAsync(['node', 'gavel', '--port', String(port)]);
    await polled;
    server.closeAllConnections();
    await waiting;
    expect(process.exitCode).toBe(2);
    expect(output).not.toHaveBeenCalled();
  });
});
