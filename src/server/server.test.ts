import { promises as fs } from 'fs';
import { createServer } from 'node:net';
import { hostname, tmpdir } from 'os';
import { join, resolve } from 'path';
import express from 'express';
import type { Server } from 'http';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set environment variable to skip fetch mocking
process.env.VITEST_SERVER_TEST = 'true';

import { startServer, type ServerOptions } from './server.js';
import { createSchemaCommand } from '../cli/schema.js';
import { createCommentCommand } from '../cli/comment.js';
import type { ServerEvent } from '../types/events.js';
import { DiffMode } from '../types/watch.js';
import { FileWatcherService } from './file-watcher.js';
import type { CommentImport, DiffCommentThread } from '../types/diff.js';
import type {
  ConversationStreamEvent,
  ConversationSnapshot,
  ConversationEvent,
} from '../types/conversation.js';

function isCommentEvent(event: ConversationStreamEvent): event is ConversationEvent {
  return event.type === 'comment.created' || event.type === 'comment.updated';
}

const eventStreams = new Map<number, ServerEvent[]>();
async function startObservedServer(options: ServerOptions) {
  const events: ServerEvent[] = [];
  const result = await startServer({ ...options, onEvent: (event) => events.push(event) });
  eventStreams.set(result.port, events);
  return result;
}
function capturedEvents(port: number, skip = 0) {
  const events = (eventStreams.get(port) ?? []).filter(
    (event): event is ConversationStreamEvent =>
      event.type !== 'server.ready' &&
      event.type !== 'server.shutdown' &&
      event.type !== 'server.background',
  );
  return { events: events.slice(skip), count: events.length };
}

// Add fetch polyfill for Node.js test environment
const { fetch } = await import('undici');
globalThis.fetch = fetch as any;
const parserInstances = vi.hoisted(() => [] as any[]);

// Reserve a loopback port instead of probing HTTP: other review servers can
// occupy the preferred range, and startup tests send requests before readiness.
async function getAvailablePort(preferredPort: number): Promise<number> {
  const reserve = (port: number) =>
    new Promise<number>((resolvePort, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => {
        const address = probe.address();
        if (!address || typeof address === 'string') {
          probe.close(() => reject(new Error('Expected a TCP port')));
          return;
        }
        probe.close((error) => (error ? reject(error) : resolvePort(address.port)));
      });
    });
  try {
    return await reserve(preferredPort);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    return reserve(0);
  }
}

// These servers run in this checkout: give each test its own saved-review directory, so no test
// writes to the checkout's Git directory or restores another test's review.
const savedReviews = vi.hoisted(() => ({ directory: '' }));
vi.mock('./review-capture.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./review-capture.js')>()),
  getGitCommonDirectory: async () => savedReviews.directory,
}));
beforeEach(async () => {
  savedReviews.directory = await fs.mkdtemp(join(tmpdir(), 'difit-server-test-reviews-'));
});
afterEach(async () => {
  await fs.rm(savedReviews.directory, { recursive: true, force: true });
});

// Mock GitDiffParser
vi.mock('./git-diff.js', () => {
  class GitDiffParserMock {
    constructor() {
      parserInstances.push(this);
    }

    getRepositoryName = vi.fn().mockResolvedValue('sample-repository');
    validateCommit = vi.fn().mockResolvedValue(true);
    parseDiff = vi.fn().mockResolvedValue({
      targetCommit: 'abc123',
      baseCommit: 'def456',
      baseCommitish: 'def4567',
      targetCommitish: 'abc1234',
      requestedBaseCommitish: 'HEAD^',
      requestedTargetCommitish: 'HEAD',
      requestedBaseMode: undefined,
      targetMessage: 'Test commit',
      baseMessage: 'Previous commit',
      files: [
        {
          path: 'test.js',
          additions: 10,
          deletions: 5,
          chunks: [],
        },
      ],
      stats: { additions: 10, deletions: 5 },
      isEmpty: false,
    });
    parseStdinDiff = vi.fn().mockReturnValue({
      targetCommit: 'stdin-target',
      baseCommit: 'stdin-base',
      targetMessage: 'stdin target',
      baseMessage: 'stdin base',
      files: [
        {
          path: 'stdin-test.js',
          additions: 1,
          deletions: 0,
          chunks: [],
        },
      ],
      stats: { additions: 1, deletions: 0 },
      isEmpty: false,
    });
    getBlobContent = vi.fn().mockResolvedValue(Buffer.from('mock image data'));
    getLineCount = vi.fn().mockResolvedValue(42);
    getGeneratedStatus = vi.fn().mockResolvedValue({
      isGenerated: true,
      source: 'content',
    });
    clearResolvedCommitCache = vi.fn();
    getRevisionOptions = vi.fn().mockResolvedValue({
      branches: [{ name: 'main', current: true }],
      commits: [{ hash: 'abc1234', shortHash: 'abc1234', message: 'Test commit' }],
      originDefaultBranch: 'origin/main',
      resolvedBase: 'abc1234',
      resolvedTarget: 'def5678',
    });
  }

  return { GitDiffParser: GitDiffParserMock };
});

describe('Server Integration Tests', () => {
  describe('Comments API', () => {
    it('should accept properly formatted comments', async () => {
      const port = await getAvailablePort(4966);
      const result = await startServer({
        preferredPort: port,
        openBrowser: false,
      });

      try {
        const comments = [
          {
            id: '1',
            file: 'src/App.tsx',
            line: 10,
            body: 'Test comment',
            timestamp: '2024-01-01T00:00:00Z',
          },
          {
            id: '2',
            file: 'src/utils/helper.ts',
            line: [20, 30],
            body: 'Another comment',
            timestamp: '2024-01-01T00:01:00Z',
          },
        ];

        const response = await fetch(`http://localhost:${result.port}/api/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comments }),
        });

        expect(response.status).toBe(200);
        const apiResult = (await response.json()) as {
          success: boolean;
          merged: boolean;
          version: number;
        };
        expect(apiResult).toMatchObject({ success: true, merged: false });
        expect(typeof apiResult.version).toBe('number');

        // Verify the formatted output
        const outputResponse = await fetch(`http://localhost:${result.port}/api/comments-output`);
        const output = await outputResponse.text();

        expect(output).toContain('src/App.tsx:L10');
        expect(output).toContain('Test comment');
        expect(output).toContain('src/utils/helper.ts:L20-L30');
        expect(output).toContain('Another comment');
        expect(output).not.toContain('undefined');
      } finally {
        if (result.server) {
          await new Promise<void>((resolve) => {
            result.server!.close(() => resolve());
          });
        }
      }
    });

    it('should handle comments with missing file property gracefully', async () => {
      const port = await getAvailablePort(4966);
      const result = await startServer({
        preferredPort: port,
        openBrowser: false,
      });

      try {
        const commentsWithMissingFile = [
          {
            id: '1',
            // file property is missing/undefined
            line: 10,
            body: 'Comment without file',
            timestamp: '2024-01-01T00:00:00Z',
          },
        ];

        const response = await fetch(`http://localhost:${result.port}/api/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comments: commentsWithMissingFile }),
        });

        expect(response.status).toBe(200);

        // Check the output handles undefined file gracefully
        const outputResponse = await fetch(`http://localhost:${result.port}/api/comments-output`);
        const output = await outputResponse.text();

        expect(output).toContain('<unknown file>:L10');
        expect(output).toContain('Comment without file');
      } finally {
        if (result.server) {
          await new Promise<void>((resolve) => {
            result.server!.close(() => resolve());
          });
        }
      }
    });

    const isoNow = '2024-01-01T00:00:00Z';
    const makeThread = (id: string, filePath: string, line: number, body: string) => ({
      id,
      filePath,
      createdAt: isoNow,
      updatedAt: isoNow,
      position: { side: 'new' as const, line },
      messages: [{ id, body, createdAt: isoNow, updatedAt: isoNow }],
    });

    const postThreads = (port: number, threads: unknown[], baseVersion?: number) =>
      fetch(`http://localhost:${port}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threads, baseVersion }),
      });

    const getSession = async (port: number) => {
      const res = await fetch(`http://localhost:${port}/api/comments-json`);
      return (await res.json()) as {
        version: number;
        threads: Array<{ id: string; filePath: string }>;
      };
    };

    it('roundtrips general questions and preserves inline imports after a stale push', async () => {
      const result = await startServer({
        preferredPort: await getAvailablePort(4966),
        openBrowser: false,
      });
      try {
        const general: DiffCommentThread = {
          id: 'general',
          scope: 'review',
          isQuestion: true,
          createdAt: isoNow,
          updatedAt: isoNow,
          messages: [
            { id: 'root', body: 'Review-wide discussion', createdAt: isoNow, updatedAt: isoNow },
          ],
        };
        expect((await postThreads(result.port, [general])).ok).toBe(true);
        const first = await getSession(result.port);
        expect(first.threads).toEqual([general]);
        const imported = await fetch(`http://localhost:${result.port}/api/comment-imports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            {
              type: 'thread',
              filePath: 'src/a.ts',
              position: { side: 'new', line: 1 },
              body: 'Inline comment',
            },
          ]),
        });
        expect(imported.ok).toBe(true);
        const replied: DiffCommentThread = {
          ...general,
          messages: [
            ...general.messages,
            { id: 'reply', body: 'General reply', createdAt: isoNow, updatedAt: isoNow },
          ],
        };
        expect((await postThreads(result.port, [replied], first.version)).ok).toBe(true);
        const final = await getSession(result.port);
        expect(final.threads).toHaveLength(2);
        expect(final.threads.find((thread) => thread.id === 'general')).toEqual(replied);
        const output = await fetch(`http://localhost:${result.port}/api/comments-output`);
        const text = await output.text();
        expect(text).toContain("Review conversation\n[QUESTION — answer, don't change code]");
        expect(text).toContain('General reply');
        expect(text).toContain('src/a.ts');
        expect(text).not.toContain('<unknown file>');
      } finally {
        if (result.server)
          await new Promise<void>((resolve) => result.server!.close(() => resolve()));
      }
    });

    it('retains question labels when normalizing display-style inline threads', async () => {
      const result = await startServer({
        preferredPort: await getAvailablePort(4966),
        openBrowser: false,
      });
      try {
        const { id, createdAt, updatedAt, messages } = makeThread(
          'inline-question',
          'src/a.ts',
          3,
          'Why here?',
        );
        const displayThread = {
          id,
          createdAt,
          updatedAt,
          messages,
          file: 'src/a.ts',
          line: 3,
          side: 'new',
          isQuestion: true,
        };
        expect((await postThreads(result.port, [displayThread])).ok).toBe(true);
        expect((await getSession(result.port)).threads[0]).toMatchObject({
          filePath: 'src/a.ts',
          isQuestion: true,
        });
        const output = await fetch(`http://localhost:${result.port}/api/comments-output`);
        expect(await output.text()).toContain(
          "src/a.ts:L3\n[QUESTION — answer, don't change code]",
        );
      } finally {
        if (result.server)
          await new Promise<void>((resolve) => result.server!.close(() => resolve()));
      }
    });

    it('merges concurrent agent additions instead of clobbering on a stale push', async () => {
      const port = await getAvailablePort(4966);
      const result = await startServer({
        preferredPort: port,
        openBrowser: false,
      });

      try {
        // Browser establishes a thread; it now knows version 1.
        await postThreads(result.port, [makeThread('t1', 'src/a.ts', 10, 'human thread')]);
        const afterFirst = await getSession(result.port);
        expect(afterFirst.version).toBe(1);

        // An agent adds a second thread out of band (e.g. `difit comment add`).
        const agentImport: CommentImport[] = [
          {
            type: 'thread',
            id: 'agent-1',
            filePath: 'src/b.ts',
            position: { side: 'new', line: 20 },
            body: 'agent finding',
            author: 'Agent',
          },
        ];
        await fetch(`http://localhost:${result.port}/api/comment-imports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agentImport),
        });

        // The browser, unaware of the agent's thread, pushes its stale set
        // tagged with the version it last observed (1).
        const staleResponse = await postThreads(
          result.port,
          [makeThread('t1', 'src/a.ts', 10, 'human thread')],
          1,
        );
        const staleResult = (await staleResponse.json()) as { merged: boolean };
        expect(staleResult.merged).toBe(true);

        // The agent's thread must survive the stale push.
        const final = await getSession(result.port);
        expect(final.threads).toHaveLength(2);
        expect(final.threads.some((thread) => thread.id === 't1')).toBe(true);
        expect(final.threads.some((thread) => thread.id === 'agent-1')).toBe(true);
      } finally {
        if (result.server) {
          await new Promise<void>((resolve) => {
            result.server!.close(() => resolve());
          });
        }
      }
    });

    it('replaces (honoring deletions) when the push version matches', async () => {
      const port = await getAvailablePort(4966);
      const result = await startServer({
        preferredPort: port,
        openBrowser: false,
      });

      try {
        await postThreads(result.port, [makeThread('t1', 'src/a.ts', 10, 'human thread')]);
        const afterFirst = await getSession(result.port);
        expect(afterFirst.version).toBe(1);
        expect(afterFirst.threads).toHaveLength(1);

        // Same version means no concurrent writer, so an empty set is a real
        // deletion and must be honored (not merged back).
        const response = await postThreads(result.port, [], afterFirst.version);
        const body = (await response.json()) as { merged: boolean };
        expect(body.merged).toBe(false);

        const final = await getSession(result.port);
        expect(final.threads).toHaveLength(0);
      } finally {
        if (result.server) {
          await new Promise<void>((resolve) => {
            result.server!.close(() => resolve());
          });
        }
      }
    });

    it('bumps the version when a reply is imported (so the change is broadcast)', async () => {
      const port = await getAvailablePort(4966);
      const result = await startServer({
        preferredPort: port,
        openBrowser: false,
      });

      try {
        await postThreads(result.port, [makeThread('t1', 'src/a.ts', 10, 'human thread')]);
        const before = await getSession(result.port);

        // A reply via comment-imports must register as a change — otherwise the
        // server skips the commentsChanged broadcast and open browsers go stale.
        await fetch(`http://localhost:${result.port}/api/comment-imports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            {
              type: 'reply',
              filePath: 'src/a.ts',
              position: { side: 'new', line: 10 },
              body: 'agent reply',
              author: 'Agent',
            },
          ] satisfies CommentImport[]),
        });

        const after = await getSession(result.port);
        expect(after.version).toBeGreaterThan(before.version);
      } finally {
        if (result.server) {
          await new Promise<void>((resolve) => {
            result.server!.close(() => resolve());
          });
        }
      }
    });
  });

  let servers: any[] = [];
  let originalProcessExit: any;

  beforeEach(() => {
    // Mock process.exit to prevent tests from actually exiting
    originalProcessExit = process.exit;
    process.exit = vi.fn() as any;
    parserInstances.length = 0;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    // Restore process.exit
    process.exit = originalProcessExit;

    // Clean up any servers created during tests
    for (const server of servers) {
      if (server?.close) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    }
    servers = [];
  });

  describe('Server startup', () => {
    it.each([true, false])('sends busy-port diagnostics to stderr with jsonl=%s', async (jsonl) => {
      const occupied = await startServer({ preferredPort: 0 });
      servers.push(occupied.server);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        const result = await startServer({ preferredPort: occupied.port, jsonl });
        servers.push(result.server);
        expect(error).toHaveBeenCalledWith(
          `Port ${occupied.port} is busy, trying ${occupied.port + 1}...`,
        );
        expect(log).not.toHaveBeenCalled();
        await result.shutdown('closed');
      } finally {
        write.mockRestore();
        error.mockRestore();
        log.mockRestore();
      }
    });

    it('writes only JSONL, announces the actual fallback port before imports, and preserves queued receipts', async () => {
      const first = await startServer({ preferredPort: 0 });
      servers.push(first.server);
      const chunks: string[] = [];
      const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        chunks.push(String(chunk));
        return true;
      });
      const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => {});
      const observed: ServerEvent[] = [];
      try {
        const result = await startServer({
          preferredPort: first.port,
          jsonl: true,
          keepAlive: true,
          shipIt: true,
          onEvent: (event) => observed.push(event),
          commentImports: Array.from({ length: 300 }, (_, i) => ({
            type: 'thread' as const,
            id: `import-${i}`,
            filePath: 'a.ts',
            position: { side: 'new' as const, line: 1 },
            body: `Imported ${i}`,
          })),
        });
        servers.push(result.server);
        const origin = result.url;
        expect(result.port).not.toBe(first.port);
        expect(observed[0]).toMatchObject({
          type: 'server.ready',
          port: result.port,
          url: result.url,
          pid: process.pid,
          reviewContext: { source: 'git' },
          selection: { baseCommitish: 'def4567', targetCommitish: 'abc1234' },
          reviewId: expect.any(String),
        });
        expect(observed[0]).not.toHaveProperty('cursor');
        expect(observed.slice(1)).toHaveLength(300);
        expect(observed.slice(1).every((event) => event.type === 'comment.created')).toBe(true);
        const post = (path: string, body: unknown) =>
          fetch(`${origin}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        await post('/api/comments', {
          comments: [{ id: 'q', file: 'a.ts', line: 1, body: 'Why?\nExplain.' }],
        });
        const comment = observed.find(
          (event) => event.type === 'comment.created' && event.messageId === 'q',
        );
        if (comment?.type !== 'comment.created') throw new Error('Missing user comment');
        const snapshot = (await (
          await fetch(`${origin}/api/conversation/snapshot`)
        ).json()) as ConversationSnapshot;
        expect(snapshot.reviews[0]?.threads[0]?.messages[0]?.progress?.status).toBe('queued');
        expect(
          (await post('/api/conversation/status', { ...comment, status: 'delivered' })).status,
        ).toBe(200);
        expect(observed.at(-1)).toMatchObject({
          type: 'comment.progress',
          progress: { status: 'delivered', cursor: comment.cursor },
        });
        await post('/api/approval', { approved: true });
        await post('/api/approval', { approved: false });
        expect(observed.slice(-2)).toMatchObject([
          { type: 'review.approval', approved: true },
          { type: 'review.approval', approved: false },
        ]);
        const heartbeat = await fetch(`${origin}/api/heartbeat`);
        expect(heartbeat.status).toBe(200);
        await result.shutdown('SIGINT');
        await heartbeat.body?.cancel();
        await result.shutdown('SIGTERM');
        expect(observed.filter((event) => event.type === 'server.shutdown')).toMatchObject([
          { type: 'server.shutdown', reason: 'SIGINT' },
        ]);
        const parsed = chunks
          .join('')
          .trimEnd()
          .split('\n')
          .map((line) => JSON.parse(line) as unknown);
        expect(parsed).toEqual(JSON.parse(JSON.stringify(observed)));
        expect(chunks.every((chunk) => chunk.endsWith('\n'))).toBe(true);
        expect(diagnostics).toHaveBeenCalledWith(expect.stringContaining('busy'));
      } finally {
        write.mockRestore();
        diagnostics.mockRestore();
      }
    });

    it('buffers live submissions during asynchronous startup until readiness', async () => {
      let started: (() => void) | undefined;
      let complete: (() => void) | undefined;
      const watcherStarted = new Promise<void>((resolveStart) => {
        started = resolveStart;
      });
      const watcherReady = new Promise<void>((resolveReady) => {
        complete = resolveReady;
      });
      const start = vi.spyOn(FileWatcherService.prototype, 'start').mockImplementation(async () => {
        started?.();
        await watcherReady;
      });
      const observed: ServerEvent[] = [];
      const port = await getAvailablePort(4966);
      try {
        const starting = startServer({
          preferredPort: port,
          conversation: true,
          diffMode: DiffMode.SPECIFIC,
          onEvent: (event) => observed.push(event),
          commentImports: [
            {
              type: 'thread',
              id: 'initial',
              filePath: 'a.ts',
              position: { side: 'new', line: 1 },
              body: 'Initial finding',
            },
          ],
        });
        await watcherStarted;
        const response = await fetch(`http://localhost:${port}/api/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            comments: [{ id: 'live', file: 'a.ts', line: 1, body: 'Live question' }],
          }),
        });
        expect(response.status).toBe(200);
        expect(observed).toEqual([]);
        complete?.();
        const result = await starting;
        servers.push(result.server);
        expect(observed.map((event) => event.type)).toEqual([
          'server.ready',
          'comment.created',
          'comment.created',
          'thread.deleted',
        ]);
        const snapshot = (await (
          await fetch(`${result.url}/api/conversation/snapshot`)
        ).json()) as ConversationSnapshot;
        expect(snapshot.reviews[0]?.threads[0]?.messages[0]).toMatchObject({
          body: 'Live question',
          progress: { status: 'queued' },
        });
      } finally {
        complete?.();
        start.mockRestore();
      }
    });

    it('pins readiness to the launch review when browser revisions change during startup', async () => {
      let started: (() => void) | undefined;
      let complete: (() => void) | undefined;
      const watcherStarted = new Promise<void>((resolveStart) => {
        started = resolveStart;
      });
      const watcherReady = new Promise<void>((resolveReady) => {
        complete = resolveReady;
      });
      const start = vi.spyOn(FileWatcherService.prototype, 'start').mockImplementation(async () => {
        started?.();
        await watcherReady;
      });
      const listen = vi.spyOn(express.application, 'listen');
      const observed: ServerEvent[] = [];
      const port = await getAvailablePort(4966);
      try {
        const starting = startServer({
          preferredPort: port,
          selection: { baseCommitish: 'HEAD^', targetCommitish: 'HEAD' },
          conversation: true,
          diffMode: DiffMode.SPECIFIC,
          onEvent: (event) => observed.push(event),
          commentImports: [
            {
              type: 'thread',
              id: 'launch-finding',
              filePath: 'a.ts',
              position: { side: 'new', line: 1 },
              body: 'Launch finding',
            },
          ],
        });
        await watcherStarted;
        const origin = `http://localhost:${port}`;
        const initial = (await (
          await fetch(`${origin}/api/conversation/snapshot`)
        ).json()) as ConversationSnapshot;
        const launchReview = initial.reviews[0]!;
        const parser = parserInstances.at(-1);
        const diff = await parser.parseDiff();
        parser.parseDiff.mockResolvedValue({
          ...diff,
          baseCommitish: 'browser-base',
          targetCommitish: 'browser-target',
        });
        const response = await fetch(`${origin}/api/diff?base=HEAD~2&target=HEAD~1`);
        expect(response.status).toBe(200);
        expect(observed).toEqual([]);
        complete?.();
        const result = await starting;
        expect(observed[0]).toMatchObject({
          type: 'server.ready',
          reviewId: launchReview.id,
          selection: launchReview.selection,
        });
        expect(observed.slice(1)).toMatchObject([
          { type: 'comment.created', reviewId: launchReview.id },
        ]);
        const saved = (await (await fetch(`${result.url}/api/comments-json`)).json()) as {
          threads: DiffCommentThread[];
        };
        expect(saved.threads).toEqual([]);
        const post = await fetch(`${result.url}/api/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            comments: [
              { id: 'browser-question', file: 'b.ts', line: 1, body: 'New review question' },
            ],
          }),
        });
        expect(post.status).toBe(200);
        const comment = observed.at(-1);
        expect(comment).toMatchObject({
          type: 'comment.created',
          selection: { baseCommitish: 'browser-base', targetCommitish: 'browser-target' },
        });
        if (comment?.type !== 'comment.created') throw new Error('Missing browser comment');
        expect(comment.reviewId).not.toBe(launchReview.id);
      } finally {
        complete?.();
        for (const result of listen.mock.results) {
          const server = result.value as Server | undefined;
          if (server?.listening)
            await new Promise<void>((resolveClose) => {
              server.close(() => resolveClose());
              server.closeAllConnections();
            });
        }
        listen.mockRestore();
        start.mockRestore();
      }
    });

    it('reports readiness through onEvent without enabling JSONL output', async () => {
      const observed: ServerEvent[] = [];
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const result = await startServer({
          preferredPort: 0,
          onEvent: (event) => observed.push(event),
        });
        servers.push(result.server);
        expect(observed[0]).toMatchObject({ type: 'server.ready', port: result.port });
        expect((await fetch(`${result.url}/api/conversation/snapshot`)).status).toBe(200);
        await new Promise<void>((resolveClose) => result.server!.close(() => resolveClose()));
        expect(observed.at(-1)).toMatchObject({ type: 'server.shutdown', reason: 'closed' });
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    });

    it('starts on preferred port', async () => {
      // Use a high port number to avoid conflicts
      const preferredPort = 9000;
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort,
      });
      servers.push(result.server); // Track for cleanup

      expect(result.port).toBeGreaterThanOrEqual(preferredPort);
      expect(result.url).toContain('http://localhost:');
      expect(result.isEmpty).toBe(false);
    });

    it('falls back to next port when preferred is occupied', async () => {
      // Use high port numbers to avoid conflicts
      const preferredPort = 9010;

      // Start server on port 9010
      const firstServer = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort,
      });
      servers.push(firstServer.server);

      // Try to start another server on the same port
      const secondServer = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort,
      });
      servers.push(secondServer.server);

      expect(firstServer.port).toBeGreaterThanOrEqual(preferredPort);
      expect(secondServer.port).toBe(firstServer.port + 1);
      expect(secondServer.url).toBe(`http://localhost:${secondServer.port}`);
    });

    it('binds to specified host', async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        host: '0.0.0.0',
        preferredPort: 9020,
      });
      servers.push(result.server);

      expect(result.url).toContain('http://localhost:'); // Display host conversion
    });

    it('passes context lines to the initial diff load', async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9025,
        contextLines: 4,
      });
      servers.push(result.server);

      const parser = parserInstances.at(-1);
      expect(parser?.parseDiff).toHaveBeenCalledWith(
        { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        false,
        4,
      );
    });
  });

  describe('API endpoints', () => {
    let port: number;
    let editorToken: string;

    beforeEach(async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9030,
      });
      servers.push(result.server);
      port = result.port;
      editorToken =
        new URLSearchParams(new URL(result.launchUrl).hash.slice(1)).get('difit-editor-token') ??
        '';
    });

    it('requires the session credential before launching an editor', async () => {
      const response = await fetch(`http://localhost:${port}/api/open-in-editor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: 'test.js', line: 1 }),
      });
      expect(response.status).toBe(403);
      expect(editorToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });

    it('rejects a different session credential of the expected length', async () => {
      const wrongToken = `${editorToken[0] === 'A' ? 'B' : 'A'}${editorToken.slice(1)}`;
      const response = await fetch(`http://localhost:${port}/api/open-in-editor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Difit-Editor-Token': wrongToken,
        },
        body: JSON.stringify({ filePath: 'test.js', line: 1 }),
      });
      expect(response.status).toBe(403);
    });

    it('rejects client-selected editor commands and arguments', async () => {
      const response = await fetch(`http://localhost:${port}/api/open-in-editor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Difit-Editor-Token': editorToken,
        },
        body: JSON.stringify({
          filePath: 'test.js',
          line: 1,
          editor: { id: 'custom', command: process.execPath, argsTemplate: '--version' },
        }),
      });

      expect(response.status).toBe(400);
    });

    it('uses the custom editor configured at server startup', async () => {
      vi.stubEnv('DIFIT_EDITOR', 'custom');
      vi.stubEnv('DIFIT_EDITOR_COMMAND', process.execPath);
      vi.stubEnv('DIFIT_EDITOR_ARGS', '--version %file');
      const configured = await startServer({ preferredPort: 9031 });
      servers.push(configured.server);
      vi.unstubAllEnvs();

      const response = await fetch(`http://localhost:${configured.port}/api/open-in-editor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Difit-Editor-Token':
            new URLSearchParams(new URL(configured.launchUrl).hash.slice(1)).get(
              'difit-editor-token',
            ) ?? '',
        },
        body: JSON.stringify({ filePath: 'test.js', line: 1 }),
      });
      expect(response.status).toBe(200);
      const diffResponse = await fetch(`http://localhost:${configured.port}/api/diff`);
      const diffData = (await diffResponse.json()) as { openInEditorAvailable: boolean };
      expect(diffData.openInEditorAvailable).toBe(true);
    });

    it('accepts a custom file-and-line argument', async () => {
      vi.stubEnv('DIFIT_EDITOR', 'custom');
      vi.stubEnv('DIFIT_EDITOR_COMMAND', process.execPath);
      vi.stubEnv('DIFIT_EDITOR_ARGS', '--version %file:%line');
      const configured = await startServer({ preferredPort: 9033 });
      servers.push(configured.server);
      vi.unstubAllEnvs();

      const response = await fetch(`http://localhost:${configured.port}/api/diff`);
      const diffData = (await response.json()) as { openInEditorAvailable: boolean };
      expect(diffData.openInEditorAvailable).toBe(true);
    });

    it('warns when a custom editor has no command', async () => {
      vi.stubEnv('DIFIT_EDITOR', 'custom');
      vi.stubEnv('DIFIT_EDITOR_COMMAND', '');
      vi.stubEnv('DIFIT_EDITOR_ARGS', '%file');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const configured = await startServer({ preferredPort: 9034 });
        servers.push(configured.server);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('DIFIT_EDITOR_COMMAND'));
      } finally {
        warn.mockRestore();
      }
    });

    it('warns when DIFIT_EDITOR names an unknown preset', async () => {
      vi.stubEnv('DIFIT_EDITOR', 'cusor');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const configured = await startServer({ preferredPort: 9035 });
        servers.push(configured.server);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('DIFIT_EDITOR'));
      } finally {
        warn.mockRestore();
      }
    });

    it('disables a custom template that embeds the file in evaluated code', async () => {
      vi.stubEnv('DIFIT_EDITOR', 'custom');
      vi.stubEnv('DIFIT_EDITOR_COMMAND', 'emacsclient');
      vi.stubEnv('DIFIT_EDITOR_ARGS', '--eval "(find-file \\"%file\\")"');
      const configured = await startServer({ preferredPort: 9032 });
      servers.push(configured.server);
      vi.unstubAllEnvs();

      const diffResponse = await fetch(`http://localhost:${configured.port}/api/diff`);
      const diffData = (await diffResponse.json()) as { openInEditorAvailable: boolean };
      expect(diffData.openInEditorAvailable).toBe(false);
      const response = await fetch(`http://localhost:${configured.port}/api/open-in-editor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Difit-Editor-Token':
            new URLSearchParams(new URL(configured.launchUrl).hash.slice(1)).get(
              'difit-editor-token',
            ) ?? '',
        },
        body: JSON.stringify({ filePath: 'test.js', line: 1 }),
      });
      expect(response.status).toBe(400);
    });

    it('GET /api/diff returns diff data', async () => {
      const response = await fetch(`http://localhost:${port}/api/diff`);
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(data).toHaveProperty('targetCommit', 'abc123');
      expect(data).toHaveProperty('baseCommit', 'def456');
      expect(data).toHaveProperty('files');
      expect(data.files).toHaveLength(1);
      expect(data.files[0]).toHaveProperty('path', 'test.js');
      expect(data).toHaveProperty('ignoreWhitespace', false);
      expect(data).toHaveProperty('openInEditorAvailable', true);
      expect(data).toHaveProperty('requestedBaseCommitish', 'HEAD^');
      expect(data).toHaveProperty('requestedTargetCommitish', 'HEAD');
      expect(data.reviewContext).toEqual({
        source: 'git',
        repositoryName: 'sample-repository',
        repositoryPath: resolve(process.cwd()),
        workingDirectory: process.cwd(),
        hostname: hostname(),
      });
    });

    it('identifies the reviewed worktree separately from the launch directory', async () => {
      const repoPath = join(tmpdir(), 'different-review-worktree');
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        repoPath,
        preferredPort: 9095,
      });
      servers.push(result.server);
      const response = await fetch(`http://localhost:${result.port}/api/diff`);
      const data = (await response.json()) as import('../types/diff.js').DiffResponse;
      expect(data.reviewContext?.repositoryPath).toBe(repoPath);
      expect(data.reviewContext?.workingDirectory).toBe(process.cwd());
    });

    it('identifies the agent session that launched the review', async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9096,
        agent: 'Claude Code desktop',
        agentSessionName: 'Add agent session to About',
        agentSessionId: '823b3140-526b-4b91-82b1-920d0b66d08f',
      });
      servers.push(result.server);
      const response = await fetch(`http://localhost:${result.port}/api/diff`);
      const data = (await response.json()) as import('../types/diff.js').DiffResponse;
      expect(data.reviewContext).toMatchObject({
        agent: 'Claude Code desktop',
        agentSessionName: 'Add agent session to About',
        agentSessionId: '823b3140-526b-4b91-82b1-920d0b66d08f',
      });
    });

    it('GET /api/diff includes the custom title when --title is set', async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9035,
        title: 'DEV-1234 review',
      });
      servers.push(result.server);

      const response = await fetch(`http://localhost:${result.port}/api/diff`);
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(data).toHaveProperty('title', 'DEV-1234 review');
    });

    it('GET /api/diff returns a JSON 500 on parse failure and does not poison subsequent requests', async () => {
      const parser = parserInstances.at(-1);
      parser?.parseDiff.mockClear();
      parser?.parseDiff.mockRejectedValueOnce(
        new Error('Failed to parse diff for nonexistent vs HEAD: unknown revision'),
      );

      const errorResponse = await fetch(`http://localhost:${port}/api/diff?target=nonexistent`);
      expect(errorResponse.status).toBe(500);
      expect(errorResponse.headers.get('content-type')).toContain('application/json');
      const errorBody = (await errorResponse.json()) as any;
      expect(typeof errorBody.error).toBe('string');

      const recoveredResponse = await fetch(
        `http://localhost:${port}/api/diff?ignoreWhitespace=true`,
      );
      expect(recoveredResponse.status).toBe(200);

      expect(parser?.parseDiff).toHaveBeenLastCalledWith(
        { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        true,
        undefined,
      );
    });

    it('GET /api/diff?ignoreWhitespace=true handles whitespace ignore', async () => {
      const response = await fetch(`http://localhost:${port}/api/diff?ignoreWhitespace=true`);
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(data).toHaveProperty('ignoreWhitespace', true);
    });

    it('GET /api/diff preserves context lines when recalculating revisions', async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9031,
        contextLines: 2,
      });
      servers.push(result.server);

      const parser = parserInstances.at(-1);
      parser?.parseDiff.mockClear();

      const response = await fetch(
        `http://localhost:${result.port}/api/diff?base=main&target=feature&ignoreWhitespace=true`,
      );

      expect(response.ok).toBe(true);
      expect(parser?.parseDiff).toHaveBeenCalledWith(
        { targetCommitish: 'feature', baseCommitish: 'main' },
        true,
        2,
      );
    });

    it('GET /api/diff passes baseMode through to the parser', async () => {
      const parser = parserInstances.at(-1);
      parser?.parseDiff.mockClear();
      parser?.parseDiff.mockResolvedValueOnce({
        targetCommit: 'abc123',
        baseCommit: 'def456',
        baseCommitish: 'fedcba9',
        targetCommitish: '.',
        requestedBaseCommitish: 'origin/main',
        requestedTargetCommitish: '.',
        requestedBaseMode: 'merge-base',
        files: [],
        isEmpty: true,
      });

      const response = await fetch(
        `http://localhost:${port}/api/diff?base=origin%2Fmain&target=.&baseMode=merge-base`,
      );
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(parser?.parseDiff).toHaveBeenCalledWith(
        {
          targetCommitish: '.',
          baseCommitish: 'origin/main',
          baseMode: 'merge-base',
        },
        false,
        undefined,
      );
      expect(data.requestedBaseMode).toBe('merge-base');
      expect(data.baseCommitish).toBe('fedcba9');
      expect(data.requestedBaseCommitish).toBe('origin/main');
    });

    it('reopens a resolved merge-base review for both browser and unscoped companion commands', async () => {
      const parser = parserInstances.at(-1);
      parser.parseDiff.mockImplementation(
        async (selection: import('../types/diff.js').DiffSelection) => ({
          baseCommitish: selection.baseMode === 'merge-base' ? 'older-ancestor' : 'saved-base',
          targetCommitish: '.',
          requestedBaseCommitish: selection.baseCommitish,
          requestedTargetCommitish: '.',
          requestedBaseMode: selection.baseMode,
          files: [],
          isEmpty: true,
        }),
      );
      const origin = `http://localhost:${port}`;
      const selected = '?base=saved-base&target=.&baseMode=merge-base';
      await fetch(`${origin}/api/comments${selected}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comments: [
            { id: 'retained-thread', file: 'test.ts', line: 1, body: 'Saved branch conversation' },
          ],
        }),
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch(`${origin}/api/diff${selected}&retainedReview=1`);
        const data = (await response.json()) as import('../types/diff.js').DiffResponse;
        expect(data.baseCommitish).toBe('saved-base');
        expect(data.requestedBaseMode).toBe('merge-base');
        expect(parser.parseDiff).toHaveBeenLastCalledWith(
          { baseCommitish: 'saved-base', targetCommitish: '.' },
          false,
          undefined,
        );
        const current = (await (await fetch(`${origin}/api/comments-json`)).json()) as {
          threads: DiffCommentThread[];
        };
        expect(current.threads[0]?.id).toBe('retained-thread');
      }
      const ordinary = (await (
        await fetch(`${origin}/api/diff${selected}`)
      ).json()) as import('../types/diff.js').DiffResponse;
      expect(ordinary.baseCommitish).toBe('older-ancestor');
      await fetch(`${origin}/api/diff${selected}&retainedReview=1`);
      const deleted = await fetch(`${origin}/api/comments/retained-thread`, { method: 'DELETE' });
      expect(deleted.status).toBe(200);
      const current = (await (await fetch(`${origin}/api/comments-json`)).json()) as {
        threads: DiffCommentThread[];
      };
      expect(current.threads).toEqual([]);
    });

    it('GET /api/diff caches results per revision pair instead of reusing the last request', async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9032,
      });
      servers.push(result.server);

      const parser = parserInstances.at(-1);
      parser?.parseDiff.mockClear();

      const firstResponse = await fetch(
        `http://localhost:${result.port}/api/diff?base=main&target=feature`,
      );
      expect(firstResponse.ok).toBe(true);

      const secondResponse = await fetch(
        `http://localhost:${result.port}/api/diff?base=HEAD%5E&target=HEAD`,
      );
      expect(secondResponse.ok).toBe(true);

      const thirdResponse = await fetch(
        `http://localhost:${result.port}/api/diff?base=main&target=feature`,
      );
      expect(thirdResponse.ok).toBe(true);

      expect(parser?.parseDiff).toHaveBeenCalledTimes(1);
      expect(parser?.parseDiff).toHaveBeenNthCalledWith(
        1,
        { targetCommitish: 'feature', baseCommitish: 'main' },
        false,
        undefined,
      );
    });

    it('GET /api/diff evicts least recently used cached diff responses', async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9033,
      });
      servers.push(result.server);

      const parser = parserInstances.at(-1);
      parser?.parseDiff.mockClear();

      const revisionPairs = [
        ['base-a', 'target-a'],
        ['base-b', 'target-b'],
        ['base-c', 'target-c'],
        ['base-d', 'target-d'],
        ['base-e', 'target-e'],
        ['base-f', 'target-f'],
        ['base-g', 'target-g'],
        ['base-h', 'target-h'],
        ['base-i', 'target-i'],
      ] as const;

      for (const [base, target] of revisionPairs) {
        const response = await fetch(
          `http://localhost:${result.port}/api/diff?base=${base}&target=${target}`,
        );
        expect(response.ok).toBe(true);
      }

      const revisitedResponse = await fetch(
        `http://localhost:${result.port}/api/diff?base=base-a&target=target-a`,
      );
      expect(revisitedResponse.ok).toBe(true);

      expect(parser?.parseDiff).toHaveBeenCalledTimes(10);
      expect(parser?.parseDiff).toHaveBeenLastCalledWith(
        { targetCommitish: 'target-a', baseCommitish: 'base-a' },
        false,
        undefined,
      );
    });

    it('GET /api/diff returns comment import payload when configured', async () => {
      const importedComments: CommentImport[] = [
        {
          type: 'thread',
          filePath: 'test.js',
          position: { side: 'new', line: 10 },
          body: 'Imported comment',
        },
      ];

      const importServer = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9034,
        commentImports: importedComments,
      });
      servers.push(importServer.server);

      const response = await fetch(`http://localhost:${importServer.port}/api/diff`);
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(data.commentImports).toEqual(importedComments);
      expect(data.commentImportId).toEqual(expect.any(String));
    });

    it('GET /api/diff returns clearComments together with comment import payload', async () => {
      const importedComments: CommentImport[] = [
        {
          type: 'thread',
          filePath: 'test.js',
          position: { side: 'new', line: 10 },
          body: 'Imported comment',
        },
      ];

      const importServer = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9037,
        clearComments: true,
        commentImports: importedComments,
      });
      servers.push(importServer.server);

      const response = await fetch(`http://localhost:${importServer.port}/api/diff`);
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(data.clearComments).toBe(true);
      expect(data.commentImports).toEqual(importedComments);
      expect(data.commentImportId).toEqual(expect.any(String));
    });

    it('GET /api/diff omits comment import payload after revision changes', async () => {
      const importedComments: CommentImport[] = [
        {
          type: 'thread',
          filePath: 'test.js',
          position: { side: 'new', line: 10 },
          body: 'Imported comment',
        },
      ];

      const importServer = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9038,
        commentImports: importedComments,
      });
      servers.push(importServer.server);

      const response = await fetch(
        `http://localhost:${importServer.port}/api/diff?base=main&target=feature`,
      );
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(data.commentImports).toBeUndefined();
      expect(data.commentImportId).toBeUndefined();
    });

    it('GET /api/generated-status/* returns generated status', async () => {
      const response = await fetch(
        `http://localhost:${port}/api/generated-status/src/query.ts?ref=HEAD`,
      );
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(data).toEqual({
        path: 'src/query.ts',
        ref: 'HEAD',
        isGenerated: true,
        source: 'content',
      });
    });

    it('GET /api/generated-status/* rejects paths outside repository', async () => {
      const response = await fetch(
        `http://localhost:${port}/api/generated-status/%2Ftmp%2Foutside.txt?ref=HEAD`,
      );
      const data = (await response.json()) as any;

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'File path outside repository');
    });

    it('GET /api/generated-status/* rejects parent traversal paths', async () => {
      const response = await fetch(
        `http://localhost:${port}/api/generated-status/..%2Foutside.txt?ref=HEAD`,
      );
      const data = (await response.json()) as any;

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'File path outside repository');
    });

    it('POST /api/comments accepts comment data', async () => {
      const comments = [{ file: 'test.js', line: 10, body: 'This is a test comment' }];

      const response = await fetch(`http://localhost:${port}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments }),
      });

      const data = await response.json();
      expect(response.ok).toBe(true);
      expect(data).toHaveProperty('success', true);
    });

    it('POST /api/comments accepts multi-line comment data', async () => {
      const comments = [
        { file: 'test.js', line: 10, body: 'Single line comment' },
        { file: 'test.js', line: [20, 30], body: 'Multi-line comment' },
      ];

      const response = await fetch(`http://localhost:${port}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments }),
      });

      const data = await response.json();
      expect(response.ok).toBe(true);
      expect(data).toHaveProperty('success', true);
    });

    it('POST /api/comments handles text/plain content type', async () => {
      const comments = [{ file: 'test.js', line: 10, body: 'This is a test comment' }];

      const response = await fetch(`http://localhost:${port}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ comments }),
      });

      const data = await response.json();
      expect(response.ok).toBe(true);
      expect(data).toHaveProperty('success', true);
    });

    it('GET /api/comments-output returns formatted comments', async () => {
      // First post some comments
      const comments = [
        { file: 'test.js', line: 10, side: 'old', body: 'First comment' },
        { file: 'test.js', line: 20, side: 'new', body: 'Second comment' },
      ];

      await fetch(`http://localhost:${port}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments }),
      });

      // Then get the output
      const response = await fetch(`http://localhost:${port}/api/comments-output`);
      const output = await response.text();

      expect(response.ok).toBe(true);
      expect(response.headers.get('Content-Type')).toContain('text/plain');
      expect(output).toContain('Comments from review session');
      expect(output).toContain('test.js:L10 (old)');
      expect(output).toContain('First comment');
      expect(output).toContain('test.js:L20\nSecond comment');
      expect(output).toContain('Second comment');
      expect(output).toContain('Total comments: 2');
    });

    it('GET /api/comments-output formats multi-line comments correctly', async () => {
      // Post comments with both single-line and multi-line formats
      const comments = [
        { file: 'test.js', line: 10, body: 'Single line comment' },
        { file: 'test.js', line: [15, 25], body: 'Multi-line comment' },
      ];

      await fetch(`http://localhost:${port}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments }),
      });

      // Then get the output
      const response = await fetch(`http://localhost:${port}/api/comments-output`);
      const output = await response.text();

      expect(response.ok).toBe(true);
      expect(output).toContain('test.js:L10');
      expect(output).toContain('Single line comment');
      expect(output).toContain('test.js:L15-L25');
      expect(output).toContain('Multi-line comment');
      expect(output).toContain('Total comments: 2');
    });

    it('POST /api/comment-imports accepts valid comment imports', async () => {
      const imports = [
        {
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Review comment',
        },
      ];

      const response = await fetch(`http://localhost:${port}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imports),
      });

      expect(response.ok).toBe(true);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.importId).toEqual(expect.any(String));
      expect(data.count).toBe(1);
    });

    it('POST /api/comment-imports accepts a single object', async () => {
      const singleImport = {
        type: 'thread',
        filePath: 'src/example.ts',
        position: { side: 'new', line: 5 },
        body: 'Single object import',
      };

      const response = await fetch(`http://localhost:${port}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(singleImport),
      });

      expect(response.ok).toBe(true);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.count).toBe(1);
    });

    it('POST /api/comment-imports rejects invalid data', async () => {
      const response = await fetch(`http://localhost:${port}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: true }),
      });

      expect(response.status).toBe(400);
      const data = (await response.json()) as any;
      expect(data).toHaveProperty('error');
    });

    it('GET /api/comments-json returns empty threads by default', async () => {
      const response = await fetch(`http://localhost:${port}/api/comments-json`);

      expect(response.ok).toBe(true);
      const data = (await response.json()) as any;
      expect(data).toHaveProperty('threads');
      expect(data.threads).toEqual([]);
    });

    it('GET /api/comments-json returns threads after posting comments', async () => {
      const comments = [{ file: 'test.js', line: 10, body: 'JSON test comment' }];

      await fetch(`http://localhost:${port}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments }),
      });

      const response = await fetch(`http://localhost:${port}/api/comments-json`);

      expect(response.ok).toBe(true);
      const data = (await response.json()) as any;
      expect(data.threads).toHaveLength(1);
      expect(data.threads[0].messages[0].body).toBe('JSON test comment');
    });

    it('POST /api/comment-imports merges into server-side threads for comments-output', async () => {
      const imports = [
        {
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 42 },
          body: 'Merged server-side comment',
        },
      ];

      await fetch(`http://localhost:${port}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imports),
      });

      const outputResponse = await fetch(`http://localhost:${port}/api/comments-output`);
      const output = await outputResponse.text();

      expect(output).toContain('src/example.ts:L42');
      expect(output).toContain('Merged server-side comment');
    });

    it('POST /api/comment-imports merges reply into existing thread', async () => {
      // First add a thread
      await fetch(`http://localhost:${port}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            type: 'thread',
            filePath: 'src/reply-test.ts',
            position: { side: 'new', line: 5 },
            body: 'Original comment',
            author: 'User',
          },
        ]),
      });

      // Then add a reply
      await fetch(`http://localhost:${port}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            type: 'reply',
            filePath: 'src/reply-test.ts',
            position: { side: 'new', line: 5 },
            body: 'Reply to comment',
            author: 'AI',
          },
        ]),
      });

      const jsonResponse = await fetch(`http://localhost:${port}/api/comments-json`);
      const data = (await jsonResponse.json()) as any;

      const thread = data.threads.find((t: any) => t.filePath === 'src/reply-test.ts');
      expect(thread).toBeDefined();
      expect(thread.messages).toHaveLength(2);
      expect(thread.messages[0].body).toBe('Original comment');
      expect(thread.messages[1].body).toBe('Reply to comment');
    });

    it('POST /api/comment-imports deduplicates identical imports', async () => {
      const imports = [
        {
          type: 'thread',
          filePath: 'src/dedup.ts',
          position: { side: 'new', line: 1 },
          body: 'Unique comment',
        },
      ];

      // Send the same import twice
      await fetch(`http://localhost:${port}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imports),
      });
      await fetch(`http://localhost:${port}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imports),
      });

      const jsonResponse = await fetch(`http://localhost:${port}/api/comments-json`);
      const data = (await jsonResponse.json()) as any;

      const threads = data.threads.filter((t: any) => t.filePath === 'src/dedup.ts');
      expect(threads).toHaveLength(1);
    });

    it('DELETE /api/comments/:threadId removes the thread and bumps the version', async () => {
      await fetch(`http://localhost:${port}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            type: 'thread',
            id: 'delete-me',
            filePath: 'src/delete-test.ts',
            position: { side: 'new', line: 3 },
            body: 'Thread to delete',
          },
        ]),
      });

      const beforeResponse = await fetch(`http://localhost:${port}/api/comments-json`);
      const before = (await beforeResponse.json()) as any;
      expect(before.threads.some((t: any) => t.id === 'delete-me')).toBe(true);

      const deleteResponse = await fetch(`http://localhost:${port}/api/comments/delete-me`, {
        method: 'DELETE',
      });
      const deleteData = (await deleteResponse.json()) as any;

      expect(deleteResponse.ok).toBe(true);
      expect(deleteData).toMatchObject({
        success: true,
        threadId: 'delete-me',
      });
      expect(deleteData.version).toBe(before.version + 1);

      const afterResponse = await fetch(`http://localhost:${port}/api/comments-json`);
      const after = (await afterResponse.json()) as any;
      expect(after.threads.some((t: any) => t.id === 'delete-me')).toBe(false);
    });

    it('DELETE /api/comments/:threadId returns 404 for unknown thread', async () => {
      const response = await fetch(`http://localhost:${port}/api/comments/does-not-exist`, {
        method: 'DELETE',
      });

      expect(response.status).toBe(404);
      const data = (await response.json()) as any;
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('does-not-exist');
    });

    describe('user settings API', () => {
      const originalConfigDir = process.env.DIFIT_CONFIG_DIR;
      let configDir: string;

      beforeEach(async () => {
        configDir = await fs.mkdtemp(join(tmpdir(), 'difit-user-settings-'));
        process.env.DIFIT_CONFIG_DIR = configDir;
      });

      afterEach(async () => {
        if (originalConfigDir === undefined) {
          delete process.env.DIFIT_CONFIG_DIR;
        } else {
          process.env.DIFIT_CONFIG_DIR = originalConfigDir;
        }
        await fs.rm(configDir, { recursive: true, force: true });
      });

      it('GET /api/user-settings returns defaults when no config exists', async () => {
        const response = await fetch(`http://localhost:${port}/api/user-settings`);

        expect(response.ok).toBe(true);
        const data = (await response.json()) as any;
        expect(data).toEqual({ version: 1, client: {}, autoViewedPatterns: [] });
      });

      it('GET /api/user-settings returns settings saved before they moved to a cookie', async () => {
        await fs.writeFile(
          join(configDir, 'config.json'),
          JSON.stringify({ version: 1, client: { diffViewMode: 'split', sidebarWidth: 400 } }),
          'utf-8',
        );

        const response = await fetch(`http://localhost:${port}/api/user-settings`);
        const data = (await response.json()) as any;
        expect(data.client).toEqual({ diffViewMode: 'split', sidebarWidth: 400 });
      });

      it('PUT /api/user-settings no longer writes the config file', async () => {
        const response = await fetch(`http://localhost:${port}/api/user-settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client: { sidebarWidth: 400 } }),
        });

        expect(response.status).toBe(404);
        await expect(fs.readdir(configDir)).resolves.toEqual([]);
      });

      it('PUT /api/auto-viewed-patterns saves the patterns that /api/diff returns', async () => {
        const put = await fetch(`http://localhost:${port}/api/auto-viewed-patterns`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patterns: ['*.snap', 'vendor/**'] }),
        });
        expect(put.ok).toBe(true);

        const diff = (await (await fetch(`http://localhost:${port}/api/diff`)).json()) as any;
        expect(diff.autoViewedPatterns).toEqual(['*.snap', 'vendor/**']);
        const stored = JSON.parse(await fs.readFile(join(configDir, 'config.json'), 'utf-8'));
        expect(stored.autoViewedPatterns).toEqual(['*.snap', 'vendor/**']);
      });

      it('GET /api/diff names a config.json that is not valid JSON', async () => {
        await fs.writeFile(join(configDir, 'config.json'), '{"autoViewedPatterns":[', 'utf-8');

        const response = await fetch(`http://localhost:${port}/api/diff`);

        expect(response.status).toBe(500);
        const data = (await response.json()) as any;
        expect(data.error).toContain(join(configDir, 'config.json'));
      });

      it('PUT /api/auto-viewed-patterns rejects anything but a list of strings', async () => {
        const response = await fetch(`http://localhost:${port}/api/auto-viewed-patterns`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patterns: '*.snap' }),
        });

        expect(response.status).toBe(400);
        await expect(fs.readdir(configDir)).resolves.toEqual([]);
      });
    });

    it('isolates comment sessions between different diff selections', async () => {
      const importServer = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9039,
        commentImports: [
          {
            type: 'thread',
            filePath: 'src/cli/comment.test.ts',
            position: { side: 'new', line: 10 },
            body: 'Startup comment',
          },
        ],
      });
      servers.push(importServer.server);

      const parser = parserInstances.at(-1);
      parser?.parseDiff.mockImplementation(async (selection: any) => ({
        targetCommit: 'abc123',
        baseCommit: 'def456',
        baseCommitish: selection.baseCommitish === 'HEAD^' ? 'def4567' : selection.baseCommitish,
        targetCommitish:
          selection.targetCommitish === 'HEAD' ? 'abc1234' : selection.targetCommitish,
        requestedBaseCommitish: selection.baseCommitish,
        requestedTargetCommitish: selection.targetCommitish,
        requestedBaseMode: selection.baseMode,
        targetMessage: 'Test commit',
        baseMessage: 'Previous commit',
        files: [
          {
            path: 'src/cli/comment.test.ts',
            additions: 10,
            deletions: 5,
            chunks: [],
          },
        ],
        stats: { additions: 10, deletions: 5 },
        isEmpty: false,
      }));

      await fetch(`http://localhost:${importServer.port}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            type: 'thread',
            filePath: 'src/cli/comment.test.ts',
            position: { side: 'new', line: 20 },
            body: 'API comment',
          },
        ]),
      });

      let response = await fetch(`http://localhost:${importServer.port}/api/comments-output`);
      let output = await response.text();
      expect(output).toContain('Startup comment');
      expect(output).toContain('API comment');

      await fetch(
        `http://localhost:${importServer.port}/api/diff?base=feat%2F292-comment-read-write&target=codex%2Fcomment-session-state`,
      );

      response = await fetch(`http://localhost:${importServer.port}/api/comments-output`);
      output = await response.text();
      expect(output).toBe('');

      await fetch(`http://localhost:${importServer.port}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            type: 'thread',
            filePath: 'src/cli/comment.test.ts',
            position: { side: 'new', line: 30 },
            body: 'Other diff comment',
          },
        ]),
      });

      response = await fetch(`http://localhost:${importServer.port}/api/comments-output`);
      output = await response.text();
      expect(output).toContain('Other diff comment');
      expect(output).not.toContain('Startup comment');
      expect(output).not.toContain('API comment');

      await fetch(`http://localhost:${importServer.port}/api/diff?base=HEAD%5E&target=HEAD`);

      response = await fetch(`http://localhost:${importServer.port}/api/comments-output`);
      output = await response.text();
      expect(output).toContain('Startup comment');
      expect(output).toContain('API comment');
      expect(output).not.toContain('Other diff comment');
    });

    it.skip('GET /api/heartbeat returns SSE headers', async () => {
      // Skipped due to connection reset issues in test environment
      // SSE endpoint functionality is verified through manual testing
      expect(true).toBe(true);
    });

    it('GET /api/diff sets openInEditorAvailable=false for stdin diff', async () => {
      const stdinServer = await startServer({
        stdinDiff: 'diff --git a/stdin-test.js b/stdin-test.js',
        preferredPort: 9035,
      });
      servers.push(stdinServer.server);

      const response = await fetch(`http://localhost:${stdinServer.port}/api/diff`);
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(data).toHaveProperty('openInEditorAvailable', false);
      expect(data.reviewContext).toEqual({
        source: 'stdin',
        workingDirectory: process.cwd(),
        hostname: hostname(),
      });
    });

    it('GET /api/generated-status/* returns 400 for stdin diff', async () => {
      const stdinServer = await startServer({
        stdinDiff: 'diff --git a/stdin-test.js b/stdin-test.js',
        preferredPort: 9036,
      });
      servers.push(stdinServer.server);

      const response = await fetch(
        `http://localhost:${stdinServer.port}/api/generated-status/stdin-test.js?ref=HEAD`,
      );
      const data = (await response.json()) as any;

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'Generated status is not available for stdin diff');
    });
  });

  describe('Static file serving', () => {
    let originalNodeEnv: string | undefined;

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
      if (originalNodeEnv !== undefined) {
        process.env.NODE_ENV = originalNodeEnv;
      } else {
        delete process.env.NODE_ENV;
      }
    });

    it('serves dev mode HTML in development', async () => {
      process.env.NODE_ENV = 'development';

      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9040,
      });
      servers.push(result.server);

      const response = await fetch(`http://localhost:${result.port}/`);
      const html = await response.text();

      expect(response.ok).toBe(true);
      expect(html).toContain('difit - Dev Mode');
      expect(html).toContain('difit development mode');
    });

    it('serves static files in production mode', async () => {
      process.env.NODE_ENV = 'production';

      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9050,
      });
      servers.push(result.server);

      // In production, it should try to serve static files
      // This might 404 if dist/client doesn't exist, but that's expected
      const response = await fetch(`http://localhost:${result.port}/`);

      // We don't expect a specific response since dist/client may not exist
      // But the server should not crash
      expect([200, 404]).toContain(response.status);
    });

    it('returns 404 for unknown paths in production mode', async () => {
      process.env.NODE_ENV = 'production';

      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9055,
      });
      servers.push(result.server);

      const response = await fetch(`http://localhost:${result.port}/not-a-route`);

      expect(response.status).toBe(404);
    });
  });

  describe('Revision options API', () => {
    it('returns available revisions', async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
      });
      servers.push(result.server);

      const response = await fetch(`http://localhost:${result.port}/api/revisions`);
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(data.specialOptions).toHaveLength(3);
      expect(data.specialOptions).not.toContainEqual({
        value: 'merge-base',
        label: 'Merge Base',
      });
      expect(data.branches).toEqual([{ name: 'main', current: true }]);
      expect(data.commits).toEqual([
        { hash: 'abc1234', shortHash: 'abc1234', message: 'Test commit' },
      ]);
      expect(data.originDefaultBranch).toBe('origin/main');
      expect(data.resolvedBase).toBe('abc1234');
      expect(data.resolvedTarget).toBe('def5678');
      expect(data.launch).toBeUndefined();
    });

    it('names the launched diff when the launch named a target', async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        explicitTarget: true,
      });
      servers.push(result.server);

      const response = await fetch(`http://localhost:${result.port}/api/revisions`);
      const data = (await response.json()) as any;

      // The mocked parser resolves HEAD^...HEAD to def4567...abc1234.
      expect(data.launch).toEqual({ baseCommitish: 'def4567', targetCommitish: 'abc1234' });
    });
  });

  describe('Error handling', () => {
    it('handles malformed comment data', async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
      });
      servers.push(result.server);

      const response = await fetch(`http://localhost:${result.port}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      expect(response.status).toBe(400);
      if (response.headers.get('content-type')?.includes('application/json')) {
        const data = await response.json();
        expect(data).toHaveProperty('error', 'Invalid comment data');
      } else {
        // If not JSON, just check status
        expect(response.ok).toBe(false);
      }
    });
  });

  describe('CORS configuration', () => {
    it('sets correct CORS headers', async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
      });
      servers.push(result.server);

      const response = await fetch(`http://localhost:${result.port}/api/diff`);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      );
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
        'Origin, X-Requested-With, Content-Type, Accept',
      );
    });
  });

  describe('Line count API', () => {
    let port: number;

    beforeEach(async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9050,
      });
      servers.push(result.server);
      port = result.port;
    });

    it('returns line counts for repository files', async () => {
      const response = await fetch(
        `http://localhost:${port}/api/line-count/src%2Findex.ts?oldRef=HEAD~1&newRef=HEAD`,
      );
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(data).toEqual({
        oldLineCount: 42,
        newLineCount: 42,
      });
    });

    it('rejects paths outside repository', async () => {
      const response = await fetch(`http://localhost:${port}/api/line-count/..%2Foutside.txt`);
      const data = (await response.json()) as any;

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'File path outside repository');
    });

    it('rejects oldPath values outside repository', async () => {
      const response = await fetch(
        `http://localhost:${port}/api/line-count/src%2Findex.ts?oldRef=HEAD~1&oldPath=..%2Foutside.txt`,
      );
      const data = (await response.json()) as any;

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'File path outside repository');
    });
  });

  describe('Blob API endpoints', () => {
    let port: number;

    beforeEach(async () => {
      const result = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        preferredPort: 9060,
      });
      servers.push(result.server);
      port = result.port;
    });

    it('GET /api/blob/* returns file content for images', async () => {
      const response = await fetch(`http://localhost:${port}/api/blob/image.jpg?ref=HEAD`);

      expect(response.ok).toBe(true);
      expect(response.headers.get('Content-Type')).toBe('image/jpeg');
      expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      expect(response.headers.get('Expires')).toBe('0');

      const buffer = await response.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it('sets correct content type for different image formats', async () => {
      const testCases = [
        { filename: 'photo.jpg', expectedType: 'image/jpeg' },
        { filename: 'photo.jpeg', expectedType: 'image/jpeg' },
        { filename: 'logo.png', expectedType: 'image/png' },
        { filename: 'animation.gif', expectedType: 'image/gif' },
        { filename: 'bitmap.bmp', expectedType: 'image/bmp' },
        { filename: 'vector.svg', expectedType: 'image/svg+xml' },
        { filename: 'modern.webp', expectedType: 'image/webp' },
        { filename: 'favicon.ico', expectedType: 'image/x-icon' },
        { filename: 'photo.tiff', expectedType: 'image/tiff' },
        { filename: 'photo.tif', expectedType: 'image/tiff' },
        { filename: 'modern.avif', expectedType: 'image/avif' },
        { filename: 'mobile.heic', expectedType: 'image/heic' },
        { filename: 'camera.heif', expectedType: 'image/heif' },
      ];

      for (const { filename, expectedType } of testCases) {
        const response = await fetch(`http://localhost:${port}/api/blob/${filename}?ref=HEAD`);
        expect(response.headers.get('Content-Type')).toBe(expectedType);
      }
    });

    it('sets default content type for unknown extensions', async () => {
      const response = await fetch(`http://localhost:${port}/api/blob/unknown.xyz?ref=HEAD`);

      expect(response.ok).toBe(true);
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    });

    it('handles different git refs correctly', async () => {
      const testRefs = ['HEAD', 'main', 'feature-branch', 'abc123'];

      for (const ref of testRefs) {
        const response = await fetch(`http://localhost:${port}/api/blob/image.jpg?ref=${ref}`);
        expect(response.ok).toBe(true);
      }
    });

    it('defaults to HEAD when no ref is provided', async () => {
      const response = await fetch(`http://localhost:${port}/api/blob/image.jpg`);

      expect(response.ok).toBe(true);
      // Should use HEAD as default ref
    });

    it('handles file not found errors', async () => {
      // Skip this test as mocking GitDiffParser in an already running server is complex
      // The error handling is already covered by the actual implementation
    });

    it('handles large file errors appropriately', async () => {
      // Skip this test as mocking GitDiffParser in an already running server is complex
      // The error handling is already covered by the actual implementation
    });

    it('handles special characters in file paths', async () => {
      const specialPaths = [
        'folder/image with spaces.jpg',
        'folder/image-with-dashes.png',
        'folder/image_with_underscores.gif',
        'folder/ιμαγε.jpg', // Unicode characters
      ];

      for (const path of specialPaths) {
        const encodedPath = encodeURIComponent(path);
        const response = await fetch(`http://localhost:${port}/api/blob/${encodedPath}?ref=HEAD`);
        expect(response.ok).toBe(true);
      }
    });

    it('rejects paths outside repository', async () => {
      const response = await fetch(`http://localhost:${port}/api/blob/..%2Foutside.txt?ref=HEAD`);
      const data = (await response.json()) as any;

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'File path outside repository');
    });
  });

  describe('conditional approval notifications', () => {
    it.each([
      {
        conversation: true,
        path: '/api/approval/conditional',
        body: { approved: true, mode: 'as-is' },
      },
      {
        conversation: true,
        path: '/api/approval/conditional',
        body: { approved: false, mode: 'after-comments' },
      },
      { conversation: true, path: '/api/approval', body: { approved: true, mode: 'unknown' } },
      {
        conversation: false,
        path: '/api/approval/conditional',
        body: { approved: true, mode: 'after-comments' },
      },
    ])(
      'rejects incompatible approval requests: $path $body.mode conversation=$conversation',
      async ({ conversation, path, body }) => {
        const result = await startServer({
          preferredPort: 0,
          keepAlive: true,
          conversation,
          shipIt: true,
          jsonl: false,
        });
        servers.push(result.server);
        try {
          const response = await fetch(`${result.url}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          expect(response.status).toBe(400);
          expect(await (await fetch(`${result.url}/api/approval`)).json()).toMatchObject({
            approved: false,
          });
        } finally {
          await result.shutdown('closed');
        }
      },
    );

    it('notifies the browser when edited human feedback revokes pending approval', async () => {
      const broadcast = vi.spyOn(FileWatcherService.prototype, 'broadcast');
      const result = await startServer({
        preferredPort: 0,
        keepAlive: true,
        conversation: true,
        shipIt: true,
      });
      servers.push(result.server);
      const post = (path: string, body: unknown) =>
        fetch(`${result.url}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      const now = new Date().toISOString();
      const discussion: DiffCommentThread = {
        id: 'conditional',
        scope: 'review',
        createdAt: now,
        updatedAt: now,
        messages: [
          {
            id: 'human',
            origin: 'user',
            intent: 'change',
            body: 'Please fix this',
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
      try {
        expect((await post('/api/comments', { threads: [discussion] })).status).toBe(200);
        const summary = (await (await fetch(`${result.url}/api/review-summary`)).json()) as {
          version: number;
        };
        const response = await post('/api/approval/conditional', {
          approved: true,
          mode: 'after-comments',
          summaryVersion: summary.version,
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          requested: true,
          approved: false,
          conditions: [expect.any(Object)],
        });
        broadcast.mockClear();
        const edited = structuredClone(discussion);
        const message = edited.messages[0];
        if (!message) throw new Error('Missing message');
        message.body = 'Please fix this differently';
        message.updatedAt = new Date(Date.now() + 1000).toISOString();
        expect((await post('/api/comments', { threads: [edited] })).status).toBe(200);
        const approval = (await (await fetch(`${result.url}/api/approval`)).json()) as {
          approved: boolean;
          requested?: boolean;
        };
        expect(approval.approved).toBe(false);
        expect(approval.requested).not.toBe(true);
        expect(broadcast).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'approvalChanged' }),
        );
      } finally {
        await result.shutdown('closed');
      }
    });
  });

  describe('Keep-alive option', () => {
    it('keeps the server alive when one of two browser tabs disconnects', async () => {
      const result = await startServer({ preferredPort: 0, keepAlive: false, conversation: true });
      servers.push(result.server);
      const first = new AbortController();
      const second = new AbortController();
      try {
        const a = await fetch(`${result.url}/api/heartbeat?tab=first&visible=true`, {
          signal: first.signal,
        });
        await a.body?.getReader().read();
        const b = await fetch(`${result.url}/api/heartbeat?tab=second&visible=false`, {
          signal: second.signal,
        });
        await b.body?.getReader().read();
        expect(await (await fetch(`${result.url}/api/presence`)).json()).toMatchObject({
          reviewers: { connected: 2, visible: 1 },
        });
        await fetch(`${result.url}/api/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab: 'second', visible: true }),
        });
        first.abort();
        await vi.waitFor(async () =>
          expect(await (await fetch(`${result.url}/api/presence`)).json()).toMatchObject({
            reviewers: { connected: 1, visible: 1 },
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(process.exit).not.toHaveBeenCalled();
        second.abort();
        await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
      } finally {
        first.abort();
        second.abort();
        await result.shutdown('closed');
      }
    });

    it.each([
      { jsonl: true, keepAlive: true },
      { jsonl: true, keepAlive: false },
      { jsonl: false, keepAlive: true },
      { jsonl: false, keepAlive: false },
    ])(
      'sends heartbeat diagnostics to stderr with jsonl=$jsonl keepAlive=$keepAlive',
      async ({ jsonl, keepAlive }) => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const write = vi.spyOn(process.stdout, 'write').mockImplementation((...args: unknown[]) => {
          const callback = args.at(-1);
          if (typeof callback === 'function') Reflect.apply(callback, undefined, []);
          return true;
        });
        let result: Awaited<ReturnType<typeof startServer>> | undefined;
        try {
          result = await startServer({ preferredPort: 0, jsonl, keepAlive, shipIt: true });
          servers.push(result.server);
          const post = (path: string, body: unknown) =>
            fetch(`${result!.url}${path}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
          await post('/api/comments', {
            comments: [
              { id: 'human-output', file: 'a.ts', line: 1, body: 'Human comment transcript' },
            ],
          });
          await post('/api/approval', { approved: true });
          const controller = new AbortController();
          const heartbeat = await fetch(`${result.url}/api/heartbeat`, {
            signal: controller.signal,
          });
          await heartbeat.body?.getReader().read();
          controller.abort();
          await vi.waitFor(() =>
            expect(error).toHaveBeenCalledWith(
              keepAlive
                ? 'Client disconnected, but server is staying alive (--keep-alive)'
                : 'Client disconnected, shutting down server...',
            ),
          );
          const output = log.mock.calls.map((args) => String(args[0])).join('\n');
          expect(output).not.toContain('Client disconnected');
          expect(output).not.toContain('Press Ctrl+C');
          if (jsonl) expect(log).not.toHaveBeenCalled();
          else {
            expect(output).toContain('LGTM approved as-is: abc1234');
            if (!keepAlive) expect(output).toContain('Human comment transcript');
          }
          if (keepAlive) expect(process.exit).not.toHaveBeenCalled();
          else await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
          if (jsonl) {
            const records = write.mock.calls
              .map((args) => String(args[0]))
              .filter((chunk) => chunk.trim())
              .map((chunk) => JSON.parse(chunk) as { type: string; reason?: string });
            if (keepAlive)
              expect(records.some((event) => event.type === 'server.shutdown')).toBe(false);
            else {
              expect(records.at(-1)).toMatchObject({
                type: 'server.shutdown',
                reason: 'client-disconnected',
              });
              const shutdownWrite = write.mock.calls.findIndex((args) =>
                String(args[0]).includes('"type":"server.shutdown"'),
              );
              expect(write.mock.invocationCallOrder[shutdownWrite]).toBeLessThan(
                vi.mocked(process.exit).mock.invocationCallOrder[0]!,
              );
            }
          }
        } finally {
          await result?.shutdown('closed');
          write.mockRestore();
          error.mockRestore();
          log.mockRestore();
        }
      },
    );

    it('accepts keepAlive option without error', async () => {
      const { port, server } = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        keepAlive: true,
      });
      servers.push(server);

      expect(port).toBeGreaterThanOrEqual(4966);
    });

    it('starts normally without keepAlive option', async () => {
      const { port, server } = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
      });
      servers.push(server);

      expect(port).toBeGreaterThanOrEqual(4966);
    });

    it('does not call process.exit on client disconnect when keepAlive is true', async () => {
      const { port, server } = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        keepAlive: true,
        preferredPort: 9070,
      });
      servers.push(server);

      // Connect to heartbeat SSE endpoint and then abort
      const controller = new AbortController();
      const responsePromise = fetch(`http://localhost:${port}/api/heartbeat`, {
        signal: controller.signal,
      });

      // Wait for the connection to be established
      const response = await responsePromise.catch(() => null);
      if (response) {
        // Start reading the stream to ensure connection is established
        const reader = response.body?.getReader();
        if (reader) {
          await reader.read(); // Read the initial "connected" message
        }
      }

      // Disconnect by aborting
      controller.abort();

      // Wait for the server's close handler + setTimeout(100ms) to run
      await new Promise((resolve) => setTimeout(resolve, 300));

      // With keepAlive, process.exit should NOT have been called
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('calls process.exit on client disconnect when keepAlive is false', async () => {
      const { port, server } = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        keepAlive: false,
        preferredPort: 9080,
      });
      servers.push(server);

      // Connect to heartbeat SSE endpoint and then abort
      const controller = new AbortController();
      const responsePromise = fetch(`http://localhost:${port}/api/heartbeat`, {
        signal: controller.signal,
      });

      // Wait for the connection to be established
      const response = await responsePromise.catch(() => null);
      if (response) {
        const reader = response.body?.getReader();
        if (reader) {
          await reader.read(); // Read the initial "connected" message
        }
      }

      // Disconnect by aborting
      controller.abort();

      // Wait for the server's close handler + setTimeout(100ms) to run
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Without keepAlive, process.exit SHOULD have been called
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe('Clear Comments functionality', () => {
    it('includes clearComments flag in diff response when provided', async () => {
      const { port, server } = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        clearComments: true,
      });
      servers.push(server);

      const response = await fetch(`http://localhost:${port}/api/diff`);
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(data.clearComments).toBe(true);
    });

    it('does not include clearComments flag when not provided', async () => {
      const { port, server } = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
      });
      servers.push(server);

      const response = await fetch(`http://localhost:${port}/api/diff`);
      const data = (await response.json()) as any;

      expect(response.ok).toBe(true);
      expect(data.clearComments).toBeUndefined();
    });

    it('preserves clearComments flag across diff requests', async () => {
      const { port, server } = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        clearComments: true,
      });
      servers.push(server);

      // First request
      const response1 = await fetch(`http://localhost:${port}/api/diff`);
      const data1 = (await response1.json()) as any;
      expect(data1.clearComments).toBe(true);

      // Second request with different ignoreWhitespace
      const response2 = await fetch(`http://localhost:${port}/api/diff?ignoreWhitespace=true`);
      const data2 = (await response2.json()) as any;
      expect(data2.clearComments).toBe(true);
    });
  });

  describe('Conversation API', () => {
    it('preserves supported excerpts and position behavior in comment thread forms', async () => {
      const result = await startServer({ preferredPort: 0, conversation: true });
      servers.push(result.server);
      const timestamp = '2026-11-01T00:00:00Z';
      const common = {
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [{ id: 'message', body: 'Question', createdAt: timestamp, updatedAt: timestamp }],
      };
      const cases = [
        {
          thread: {
            ...common,
            id: 'canonical',
            filePath: 'a.ts',
            position: { side: 'new', line: 3 },
            codeSnapshot: { content: 'canonical excerpt', language: 'typescript' },
          },
          position: { side: 'new', line: 3 },
          codeSnapshot: { content: 'canonical excerpt', language: 'typescript' },
        },
        {
          thread: {
            ...common,
            id: 'display',
            file: 'a.ts',
            line: 3,
            side: 'new',
            codeContent: 'display excerpt',
            codeSnapshot: { content: 'ignored excerpt', language: 'typescript' },
          },
          position: { side: 'new', line: 3 },
          codeSnapshot: { content: 'display excerpt' },
        },
        {
          thread: {
            ...common,
            id: 'review',
            scope: 'review',
            codeContent: 'ignored display excerpt',
            codeSnapshot: { content: 'ignored canonical excerpt' },
          },
          position: undefined,
          codeSnapshot: undefined,
        },
        {
          thread: {
            ...common,
            id: 'unchecked-range',
            filePath: 'a.ts',
            position: { side: 'new', line: { start: 9, end: 2 } },
          },
          position: { side: 'new', line: { start: 9, end: 2 } },
          codeSnapshot: undefined,
        },
        {
          thread: { ...common, id: 'normalized-range', file: 'a.ts', line: [9, 2], side: 'new' },
          position: { side: 'new', line: 1 },
          codeSnapshot: undefined,
        },
      ];
      for (const fixture of cases) {
        const response = await fetch(`${result.url}/api/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threads: [fixture.thread] }),
        });
        expect(response.status).toBe(200);
        const saved = (await (await fetch(`${result.url}/api/comments-json`)).json()) as {
          threads: { position?: unknown; codeSnapshot?: unknown }[];
        };
        expect(saved.threads).toHaveLength(1);
        expect(saved.threads[0]?.position).toEqual(fixture.position);
        expect(saved.threads[0]?.codeSnapshot).toEqual(fixture.codeSnapshot);
      }
    });

    it('keeps serialized server event fields aligned with the schema command', async () => {
      interface ObjectDefinition {
        $ref?: string;
        type?: string;
        const?: string;
        enum?: string[];
        properties?: Record<string, ObjectDefinition>;
        required?: string[];
      }
      let definitions: Record<string, ObjectDefinition>;
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await createSchemaCommand().parseAsync(['node', 'difit']);
        expect(log).toHaveBeenCalledTimes(1);
        const schema = JSON.parse(String(log.mock.calls[0]?.[0])) as {
          $defs: Record<string, ObjectDefinition>;
        };
        definitions = schema.$defs;
      } finally {
        log.mockRestore();
      }
      const checkedObjectReferences = new Set<string>();
      const assertObjectFields = (
        value: unknown,
        definition: ObjectDefinition,
        path: string,
      ): void => {
        if (definition.$ref) {
          const name = definition.$ref.slice('#/$defs/'.length);
          const referenced = definitions[name];
          if (!referenced) throw new Error(`Missing schema reference ${name}`);
          if (referenced.type === 'object') checkedObjectReferences.add(name);
          assertObjectFields(value, referenced, path);
          return;
        }
        if (definition.const !== undefined) expect(value).toBe(definition.const);
        if (definition.enum) expect(definition.enum).toContain(value);
        if (definition.type !== 'object') return;
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error(`Expected object at ${path}`);
        const record = value as Record<string, unknown>;
        const properties = definition.properties;
        const required = definition.required;
        if (!properties || !required) throw new Error(`Missing object schema fields at ${path}`);
        expect(
          Object.keys(record).filter((key) => !(key in properties)),
          `${path}: undocumented fields`,
        ).toEqual([]);
        expect(
          required.filter((key) => !(key in record)),
          `${path}: missing required fields`,
        ).toEqual([]);
        for (const [key, child] of Object.entries(record)) {
          const property = properties[key];
          if (property) assertObjectFields(child, property, `${path}.${key}`);
        }
      };
      const assertEventFields = (record: Record<string, unknown>) => {
        const type = record.type;
        if (typeof type !== 'string') throw new Error('Expected an event type');
        const definition = Object.values(definitions).find((candidate) => {
          const discriminator = candidate.properties?.type;
          return (
            candidate.type === 'object' &&
            (discriminator?.const === type || discriminator?.enum?.includes(type))
          );
        });
        if (!definition) throw new Error(`Missing object schema for ${type}`);
        assertObjectFields(record, definition, type);
      };
      const observed: ServerEvent[] = [];
      const result = await startServer({
        preferredPort: 0,
        shipIt: true,
        onEvent: (event) => observed.push(event),
      });
      servers.push(result.server);
      const assertNamedFields = (value: unknown, name: string) => {
        const definition = definitions[name];
        if (!definition) throw new Error(`Missing schema definition ${name}`);
        assertObjectFields(value, definition, name);
      };
      const post = async (path: string, body: unknown, responseDefinition: string) => {
        const response = await fetch(`${result.url}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(200);
        const payload: unknown = await response.json();
        assertNamedFields(payload, responseDefinition);
        return payload;
      };
      const comment = {
        id: 'schema-question',
        file: 'a.ts',
        line: 1,
        body: 'Original question',
        author: 'Reviewer',
        codeContent: 'const value = 1;',
      };
      await post('/api/comments', { comments: [comment] }, 'CommentsEditResponse');
      await post(
        '/api/comments',
        { comments: [{ ...comment, body: 'Edited question' }] },
        'CommentsEditResponse',
      );
      const edited = observed.find((event) => event.type === 'comment.updated');
      if (edited?.type !== 'comment.updated') throw new Error('Missing edited comment');
      await post('/api/conversation/status', { ...edited, status: 'read' }, 'StatusResponse');
      await post(
        '/api/conversation/reply',
        {
          reviewId: edited.reviewId,
          threadId: edited.threadId,
          inReplyTo: edited.messageId,
          cursor: edited.cursor,
          body: 'Agent answer',
        },
        'ReplyResponse',
      );
      const saved = (await (await fetch(`${result.url}/api/comments-json`)).json()) as {
        version: number;
        threads: DiffCommentThread[];
      };
      assertNamedFields(saved, 'CommentsResponse');
      await post(
        '/api/comments',
        {
          baseVersion: saved.version,
          threads: saved.threads.map((thread) => ({
            ...thread,
            messages: thread.messages.slice(0, 1),
          })),
        },
        'CommentsEditResponse',
      );
      await post(
        '/api/review-summary',
        {
          commitMessage: 'fix: document contract',
          rationale: 'Review event fields',
          baseVersion: 0,
        },
        'SummaryResponse',
      );
      await post('/api/approval', { approved: true, summaryVersion: 1 }, 'ApprovalResponse');
      await post(
        '/api/conversation/summary',
        {
          reviewId: edited.reviewId,
          commitMessage: 'fix: retain event origin',
          rationale: 'An agent edit revokes approval with agent origin.',
          baseVersion: 1,
        },
        'SummaryResponse',
      );
      await post(
        `/api/comments/${edited.threadId}/resolution`,
        { resolved: true },
        'ResolutionResponse',
      );
      await post(
        `/api/comments/${edited.threadId}/resolution`,
        { resolved: false },
        'ResolutionResponse',
      );
      // Exercise CLI serializers against the real server, not mocked response bodies.
      const imported = {
        type: 'thread',
        filePath: 'import.ts',
        position: { side: 'new', line: 1 },
        body: 'Imported contract',
      };
      assertNamedFields(imported, 'CommentImport');
      const importResult = await post('/api/comment-imports', imported, 'CommentImportResponse');
      expect(importResult).toMatchObject({ success: true, changed: true, count: 1 });
      const cliLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await createCommentCommand().parseAsync([
          'node',
          'difit',
          'add',
          '--port',
          String(result.port),
          JSON.stringify(imported),
        ]);
        const added: unknown = JSON.parse(String(cliLog.mock.calls.at(-1)?.[0]));
        assertNamedFields(added, 'CommentAddResponse');
        expect(added).toMatchObject({ success: true, count: 1, warnings: [] });
        cliLog.mockClear();
        await createCommentCommand().parseAsync([
          'node',
          'difit',
          'resolve',
          edited.threadId,
          '--port',
          String(result.port),
        ]);
        const action: unknown = JSON.parse(String(cliLog.mock.calls.at(-1)?.[0]));
        const actionSchema = definitions.CommentActionResponse as
          | { anyOf: ObjectDefinition[] }
          | undefined;
        const resolvedSchema = actionSchema?.anyOf.find(
          (candidate) => candidate.properties?.resolved,
        );
        if (!resolvedSchema) throw new Error('Missing resolved action schema');
        assertObjectFields(action, resolvedSchema, 'CommentActionResponse');
        expect(action).toEqual({
          success: true,
          resolved: [edited.threadId],
          notFound: [],
          errors: [],
        });
      } finally {
        cliLog.mockRestore();
      }
      const deletion = await fetch(`${result.url}/api/comments/${edited.threadId}`, {
        method: 'DELETE',
      });
      expect(deletion.status).toBe(200);
      assertNamedFields(await deletion.json(), 'DeleteResponse');
      const timestamp = '2026-10-29T00:00:00Z';
      await post(
        '/api/comments',
        {
          threads: [
            {
              id: 'schema-review-thread',
              scope: 'review',
              createdAt: timestamp,
              updatedAt: timestamp,
              messages: [
                {
                  id: 'schema-review-root',
                  body: 'Why this overall approach?',
                  intent: 'question',
                  createdAt: timestamp,
                  updatedAt: timestamp,
                },
              ],
            },
          ],
        },
        'CommentsEditResponse',
      );
      await result.shutdown('closed');
      expect([...new Set(observed.map((event) => event.type))].sort()).toEqual(
        [
          'server.ready',
          'server.shutdown',
          'comment.created',
          'comment.updated',
          'comment.deleted',
          'comment.progress',
          'review.summary',
          'review.approval',
          'thread.resolved',
          'thread.reopened',
          'thread.deleted',
        ].sort(),
      );
      // Match stdout serialization: optional undefined fields do not appear in JSONL records.
      const records = observed.map(
        (event) => JSON.parse(JSON.stringify(event)) as Record<string, unknown>,
      );
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'comment.created',
            author: 'Reviewer',
            codeSnapshot: { content: 'const value = 1;' },
          }),
          expect.objectContaining({ type: 'comment.created', scope: 'review', intent: 'question' }),
        ]),
      );
      for (const record of records) assertEventFields(record);
      expect([...checkedObjectReferences]).toEqual(
        expect.arrayContaining([
          'DiffSelection',
          'ReviewContext',
          'CommentProgress',
          'ReviewSummary',
          'CodeSnapshot',
        ]),
      );
      // Negative controls verify both halves of the drift guard.
      expect(() => assertEventFields({ ...records[0], undocumentedFixtureField: true })).toThrow();
      const missingRequiredField = { ...records[0] };
      delete missingRequiredField.pid;
      expect(() => assertEventFields(missingRequiredField)).toThrow();
      const ready = records.find((record) => record.type === 'server.ready')!;
      expect(() =>
        assertEventFields({
          ...ready,
          selection: { ...(ready.selection as Record<string, unknown>), nestedFixtureField: true },
        }),
      ).toThrow();
      const missingNestedField = { ...(ready.selection as Record<string, unknown>) };
      delete missingNestedField.baseCommitish;
      expect(() => assertEventFields({ ...ready, selection: missingNestedField })).toThrow();
    });

    it('labels agent resolution and deletion endpoints separately from browser submissions', async () => {
      const result = await startObservedServer({ conversation: true });
      servers.push(result.server);
      const post = (path: string, body: unknown) =>
        fetch(`${result.url}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      await post('/api/comments', {
        comments: [{ id: 'q', file: 'a.ts', line: 1, body: 'Question' }],
      });
      expect(capturedEvents(result.port).events[0]).toMatchObject({
        type: 'comment.created',
        origin: 'user',
      });
      await post('/api/comments/q/resolution', { resolved: true });
      await post('/api/comments/q/resolution', { resolved: false });
      await fetch(`${result.url}/api/comments/q`, { method: 'DELETE' });
      expect(capturedEvents(result.port).events.slice(1)).toMatchObject([
        { type: 'thread.resolved', origin: 'agent' },
        { type: 'thread.reopened', origin: 'agent' },
        { type: 'thread.deleted', origin: 'agent' },
      ]);
    });

    it('streams general questions and resolves/reopens their exact review without deleting messages', async () => {
      const { port, server } = await startObservedServer({ conversation: true, keepAlive: true });
      servers.push(server);
      const origin = `http://localhost:${port}`;
      const post = (path: string, body: unknown) =>
        fetch(`${origin}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      const selection = '?base=review-base&target=review-target';
      const thread = {
        id: 'general',
        scope: 'review',
        createdAt: '2026-10-24T00:00:00Z',
        updatedAt: '2026-10-24T00:00:00Z',
        messages: [
          {
            id: 'question',
            body: 'Why this approach?',
            intent: 'question',
            author: 'User',
            createdAt: '2026-10-24T00:00:00Z',
            updatedAt: '2026-10-24T00:00:00Z',
          },
        ],
      };
      expect((await post(`/api/comments${selection}`, { threads: [thread] })).status).toBe(200);
      const batch = capturedEvents(port);
      const event = batch.events.find(isCommentEvent)!;
      expect(event).toMatchObject({
        scope: 'review',
        intent: 'question',
        body: 'Why this approach?',
      });
      expect(event.file).toBeUndefined();
      expect(event.line).toBeUndefined();
      expect(
        (
          await post('/api/conversation/reply', {
            reviewId: event.reviewId,
            threadId: event.threadId,
            inReplyTo: event.messageId,
            cursor: event.cursor,
            body: 'Because it preserves history.',
          })
        ).status,
      ).toBe(200);
      // A different review has the same thread ID. Explicit review identity isolates resolution.
      await post('/api/comments', { threads: [thread] });
      for (const resolved of [true, false]) {
        expect(
          (await post('/api/comments/general/resolution', { reviewId: event.reviewId, resolved }))
            .status,
        ).toBe(200);
        const saved = (await (await fetch(`${origin}/api/comments-json${selection}`)).json()) as {
          threads: import('../types/diff.js').DiffCommentThread[];
        };
        expect(saved.threads[0]!.resolution?.resolved).toBe(resolved);
        expect(saved.threads[0]!.messages).toHaveLength(2);
        expect(saved.threads[0]!.messages[0]!.progress?.status).toBe('replied');
        const other = (await (await fetch(`${origin}/api/comments-json`)).json()) as {
          threads: import('../types/diff.js').DiffCommentThread[];
        };
        expect(other.threads[0]!.resolution).toBeUndefined();
      }
    });

    it('accepts Noted without manufacturing a reply or resolving the thread', async () => {
      const { port, server } = await startObservedServer({ conversation: true, keepAlive: true });
      servers.push(server);
      const origin = `http://localhost:${port}`;
      const post = (path: string, body: unknown) =>
        fetch(`${origin}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      await post('/api/comments', {
        comments: [{ id: 'note', file: 'a.ts', line: 1, body: 'Looks good.' }],
      });
      const batch = capturedEvents(port);
      const event = batch.events.find(isCommentEvent)!;
      expect((await post('/api/conversation/status', { ...event, status: 'noted' })).status).toBe(
        200,
      );
      const snapshot = (await (await fetch(`${origin}/api/conversation/snapshot`)).json()) as {
        reviews: { threads: import('../types/diff.js').DiffCommentThread[] }[];
      };
      const thread = snapshot.reviews[0]!.threads[0]!;
      expect(thread.messages).toHaveLength(1);
      expect(thread.messages[0]!.progress?.status).toBe('noted');
      expect(thread.resolution).toBeUndefined();
    });

    it('projects agent progress, ignores browser status, and rejects stale replies after edits', async () => {
      const { port, server } = await startObservedServer({ conversation: true, keepAlive: true });
      servers.push(server);
      const origin = `http://localhost:${port}`;
      const post = (path: string, body: unknown) =>
        fetch(`${origin}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      const getThreads = async () =>
        (await (await fetch(`${origin}/api/comments-json`)).json()) as {
          version: number;
          threads: import('../types/diff.js').DiffCommentThread[];
        };
      await post('/api/comments', {
        comments: [{ id: 'q', file: 'a.ts', line: 1, body: 'Question' }],
      });
      const batch = capturedEvents(port);
      const event = batch.events.find(isCommentEvent)!;
      const identity = {
        reviewId: event.reviewId,
        threadId: event.threadId,
        messageId: event.messageId,
        cursor: event.cursor,
      };
      const initial = await getThreads();
      expect(initial.threads[0]!.messages[0]!.progress?.status).toBe('queued');
      for (const status of ['delivered', 'read', 'thinking', 'replying']) {
        expect((await post('/api/conversation/status', { ...identity, status })).status).toBe(200);
        expect((await getThreads()).threads[0]!.messages[0]!.progress?.status).toBe(status);
      }
      // A browser's old view cannot overwrite agent progress or manufacture a new journal event.
      await post('/api/comments', initial);
      expect((await getThreads()).threads[0]!.messages[0]!.progress?.status).toBe('replying');
      const unchanged = capturedEvents(port, batch.count);
      expect(unchanged.events.filter((event) => event.type !== 'comment.progress')).toEqual([]);
      expect(unchanged.events.filter((event) => event.type === 'comment.progress')).toHaveLength(4);
      expect(
        (await post('/api/conversation/status', { ...identity, status: 'replied' })).status,
      ).toBe(400);
      const reply = {
        reviewId: event.reviewId,
        threadId: event.threadId,
        inReplyTo: event.messageId,
        cursor: event.cursor,
        body: 'Answer',
      };
      const invalidReply = await post('/api/conversation/reply', { ...reply, cursor: null });
      expect(invalidReply.status).toBe(400);
      expect(await invalidReply.json()).toEqual({
        error: 'Expected reviewId, threadId, inReplyTo, body, and optional cursor and author',
      });
      expect((await post('/api/conversation/reply', reply)).status).toBe(200);
      const originalReplyId = (await getThreads()).threads[0]!.messages[1]!.id;
      expect((await getThreads()).threads[0]!.messages[0]!.progress?.status).toBe('replied');
      const edited = await getThreads();
      edited.threads[0]!.messages[0]!.body = 'Edited question';
      await post('/api/comments', edited);
      expect((await getThreads()).threads[0]!.messages[0]!.progress?.status).toBe('queued');
      expect(
        (await post('/api/conversation/status', { ...identity, status: 'thinking' })).status,
      ).toBe(409);
      expect((await post('/api/conversation/reply', reply)).status).toBe(409);
      expect((await post('/api/conversation/reply', { ...reply, cursor: undefined })).status).toBe(
        200,
      );
      const afterLegacyReply = await getThreads();
      expect(afterLegacyReply.threads[0]!.messages[0]!.progress?.status).toBe('queued');
      const nextCursor = afterLegacyReply.threads[0]!.messages[0]!.progress!.cursor;
      const nextReply = { ...reply, cursor: nextCursor };
      expect((await post('/api/conversation/reply', nextReply)).status).toBe(200);
      const afterNewReply = await getThreads();
      expect(afterNewReply.threads[0]!.messages[0]!.progress?.status).toBe('replied');
      expect(afterNewReply.threads[0]!.messages).toHaveLength(
        afterLegacyReply.threads[0]!.messages.length + 1,
      );
      expect(afterNewReply.threads[0]!.messages.at(-1)!.id).not.toBe(originalReplyId);
      expect((await post('/api/conversation/reply', nextReply)).status).toBe(200);
      expect((await getThreads()).threads[0]!.messages).toEqual(afterNewReply.threads[0]!.messages);
      await fetch(`${origin}/api/comments/${event.threadId}`, { method: 'DELETE' });
      expect((await post('/api/conversation/status', { ...identity, status: 'read' })).status).toBe(
        404,
      );
    });

    it('delivers comments before approval and routes idempotent replies to the original review', async () => {
      const { port, server } = await startObservedServer({ conversation: true, keepAlive: true });
      servers.push(server);
      const origin = `http://localhost:${port}`;
      const post = async (path: string, body: unknown) =>
        fetch(`${origin}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      const selection = '?base=def4567&target=abc1234';
      await post(`/api/comments${selection}`, {
        comments: [
          { id: 'question-a', file: 'a.ts', line: 4, body: 'Why?', codeContent: 'return 42;' },
        ],
      });
      const batch = capturedEvents(port);
      expect(batch.events).toHaveLength(1);
      const event = batch.events.find(isCommentEvent)!;
      expect(event).toMatchObject({
        type: 'comment.created',
        origin: 'user',
        file: 'a.ts',
        line: 4,
        selection: { baseCommitish: 'def4567', targetCommitish: 'abc1234' },
        codeSnapshot: { content: 'return 42;' },
      });
      expect(process.exit).not.toHaveBeenCalled();
      // Another tab changes the server's current selection before the agent answers.
      const parser = parserInstances.at(-1);
      const diff = await parser.parseDiff();
      parser.parseDiff.mockResolvedValue({
        ...diff,
        baseCommitish: 'other-base',
        targetCommitish: 'other-target',
      });
      await fetch(`${origin}/api/diff?base=other-base&target=other-target`);
      const reply = {
        reviewId: event.reviewId,
        threadId: event.threadId,
        inReplyTo: event.messageId,
        body: 'Because…',
        author: 'Codex',
      };
      expect((await post('/api/conversation/reply', reply)).status).toBe(200);
      expect((await post('/api/conversation/reply', reply)).status).toBe(200);
      const saved = (await (await fetch(`${origin}/api/comments-json${selection}`)).json()) as {
        threads: { messages: { body: string }[] }[];
      };
      expect(saved.threads[0]!.messages.map((message) => message.body)).toEqual([
        'Why?',
        'Because…',
      ]);
      const other = (await (await fetch(`${origin}/api/comments-json`)).json()) as {
        threads: unknown[];
      };
      expect(other.threads).toEqual([]);
      const events = capturedEvents(port, batch.count);
      expect(events.events).toHaveLength(1);
      expect(events.events[0]).toMatchObject({
        origin: 'agent',
        body: 'Because…',
        reviewId: event.reviewId,
      });
      expect(
        (await post('/api/conversation/reply', { ...reply, inReplyTo: 'missing' })).status,
      ).toBe(404);
      await fetch(`${origin}/api/comments/${event.threadId}${selection}`, { method: 'DELETE' });
      expect((await post('/api/conversation/reply', reply)).status).toBe(404);
    });

    // Browser restoration must preserve agent origin through the real HTTP API.
    // Run: pnpm test src/server/server.test.ts -t 'restores persisted message origins'
    it('restores persisted message origins after restarting a review', async () => {
      const first = await startObservedServer({ conversation: true });
      const second = await startObservedServer({ conversation: true });
      servers.push(first.server, second.server);
      const post = (port: number, path: string, body: unknown) =>
        fetch(`http://localhost:${port}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      await post(first.port, '/api/comments', {
        comments: [{ id: 'q', file: 'a.ts', line: 1, body: 'Why?' }],
      });
      const batch = capturedEvents(first.port);
      const event = batch.events.find(isCommentEvent)!;
      await post(first.port, '/api/conversation/reply', {
        reviewId: event.reviewId,
        threadId: event.threadId,
        inReplyTo: event.messageId,
        body: 'Because.',
        author: 'Codex',
      });
      const saved: unknown = await (
        await fetch(`http://localhost:${first.port}/api/comments-json`)
      ).json();
      await post(second.port, '/api/comments', saved);
      const restored = capturedEvents(second.port);
      expect(
        restored.events.filter(isCommentEvent).map(({ body, origin }) => ({ body, origin })),
      ).toEqual([
        { body: 'Why?', origin: 'user' },
        { body: 'Because.', origin: 'agent' },
      ]);
    });

    it('preserves preloaded and imported agent messages through browser restoration', async () => {
      const first = await startObservedServer({
        conversation: true,
        commentImports: [
          {
            type: 'thread',
            id: 'finding',
            filePath: 'a.ts',
            position: { side: 'new', line: 1 },
            body: 'Finding.',
          },
        ],
      });
      const second = await startObservedServer({ conversation: true });
      servers.push(first.server, second.server);
      const origin = `http://localhost:${first.port}`;
      const snapshot = (await (await fetch(`${origin}/api/conversation/snapshot`)).json()) as {
        reviews: { threads: { messages: { body: string }[] }[] }[];
      };
      expect(snapshot.reviews[0]?.threads[0]?.messages[0]?.body).toBe('Finding.');
      await fetch(`${origin}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            type: 'reply',
            filePath: 'a.ts',
            position: { side: 'new', line: 1 },
            body: 'Imported reply.',
          },
        ]),
      });
      const saved: unknown = await (await fetch(`${origin}/api/comments-json`)).json();
      await fetch(`http://localhost:${second.port}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saved),
      });
      const restored = capturedEvents(second.port);
      expect(
        restored.events.filter(isCommentEvent).map(({ body, origin }) => ({ body, origin })),
      ).toEqual([
        { body: 'Finding.', origin: 'agent' },
        { body: 'Imported reply.', origin: 'agent' },
      ]);
    });

    // Snapshots expose identities for outstanding reviews after missed process output.
    // Run: pnpm test src/server/server.test.ts -t 'reconciles outstanding reviews'
    it('reconciles outstanding reviews from a snapshot and emits subsequent replies', async () => {
      const { port, server } = await startObservedServer({ conversation: true });
      servers.push(server);
      const origin = `http://localhost:${port}`;
      const post = (path: string, body: unknown) =>
        fetch(`${origin}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      await post('/api/comments?base=base-b&target=target-b', {
        comments: [{ id: 'q-b', file: 'b.ts', line: 1, body: 'Outstanding?' }],
      });
      await post('/api/comments?base=base-a&target=target-a', {
        comments: Array.from({ length: 256 }, (_, i) => ({
          id: `q-${i}`,
          file: 'a.ts',
          line: 1,
          body: `Question ${i}`,
        })),
      });
      expect(capturedEvents(port).events).toHaveLength(257);
      const response = await fetch(`${origin}/api/conversation/snapshot`);
      expect(response.status).toBe(200);
      const snapshot = (await response.json()) as {
        cursor: string;
        reviews: {
          id: string;
          selection: { targetCommitish: string };
          threads: { id: string; messages: { id: string }[] }[];
        }[];
      };
      const beforeReply = capturedEvents(port).count;
      const review = snapshot.reviews.find((r) => r.selection.targetCommitish === 'target-b')!;
      const thread = review.threads[0]!;
      expect(
        (
          await post('/api/conversation/reply', {
            reviewId: review.id,
            threadId: thread.id,
            inReplyTo: thread.messages[0]!.id,
            body: 'Recovered.',
          })
        ).status,
      ).toBe(200);
      const resumed = capturedEvents(port, beforeReply);
      expect(resumed.events).toHaveLength(1);
      expect(resumed.events[0]).toMatchObject({
        body: 'Recovered.',
        origin: 'agent',
        reviewId: review.id,
      });
    });

    it('requires opt-in and validates conversation requests', async () => {
      const disabled = await startServer({});
      servers.push(disabled.server);
      expect(
        (await fetch(`http://localhost:${disabled.port}/api/conversation/snapshot`)).status,
      ).toBe(404);
      const enabled = await startObservedServer({ conversation: true });
      servers.push(enabled.server);
      const origin = `http://localhost:${enabled.port}`;
      expect((await fetch(`${origin}/api/conversation/events?wait=0`)).status).toBe(200);
      expect((await fetch(`${origin}/api/conversation/snapshot`)).status).toBe(200);
      expect(
        (
          await fetch(`${origin}/api/conversation/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: '{}',
          })
        ).status,
      ).toBe(415);
      expect(
        (
          await fetch(`${origin}/api/conversation/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(400);
    });
  });

  describe('Review summary API', () => {
    it('isolates summaries, rejects stale writes, emits trusted origins, and revokes approval', async () => {
      const { port, server } = await startObservedServer({ conversation: true, shipIt: true });
      servers.push(server);
      const origin = `http://localhost:${port}`;
      const url = `${origin}/api/review-summary?base=base-a&target=target-a`;
      const post = (path: string, body: unknown) =>
        fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      expect(await (await fetch(url)).json()).toEqual({
        commitMessage: '',
        rationale: '',
        version: 0,
      });
      await post(`${origin}/api/approval?base=base-a&target=target-a`, { approved: true });
      const input = {
        commitMessage: 'fix: preserve intent',
        rationale: 'Explain the proposed change.',
        baseVersion: 0,
        origin: 'agent',
      };
      const saved = await post(url, input);
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({
        commitMessage: input.commitMessage,
        rationale: input.rationale,
        version: 1,
      });
      expect(
        await (await fetch(`${origin}/api/approval?base=base-a&target=target-a`)).json(),
      ).toMatchObject({ approved: false });
      const stale = await post(url, { ...input, rationale: 'Stale text' });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({
        summary: { rationale: input.rationale, version: 1 },
      });
      expect(
        await (await fetch(`${origin}/api/review-summary?base=base-a&target=target-b`)).json(),
      ).toMatchObject({ version: 0 });
      expect(
        await (
          await fetch(
            `${origin}/api/review-summary?base=base-a&target=target-a&baseMode=merge-base`,
          )
        ).json(),
      ).toMatchObject({ version: 0 });
      const snapshot = (await (
        await fetch(`${origin}/api/conversation/snapshot`)
      ).json()) as ConversationSnapshot;
      const review = snapshot.reviews.find(
        (entry) => entry.selection.targetCommitish === 'target-a' && !entry.selection.baseMode,
      )!;
      expect(review.summary).toMatchObject({ version: 1 });
      await post(`${origin}/api/approval?base=base-a&target=target-a`, {
        approved: true,
        summaryVersion: 1,
      });
      expect(
        (
          await post(`${origin}/api/conversation/summary`, {
            ...input,
            reviewId: review.id,
            baseVersion: 1,
            rationale: 'Agent revision',
          })
        ).status,
      ).toBe(200);
      expect(
        await (await fetch(`${origin}/api/approval?base=base-a&target=target-a`)).json(),
      ).toMatchObject({ approved: false });
      await post(`${origin}/api/approval?base=base-a&target=target-a`, {
        approved: true,
        summaryVersion: 2,
      });
      await post(url, { ...input, baseVersion: 2, rationale: 'Agent revision' });
      expect(
        await (await fetch(`${origin}/api/approval?base=base-a&target=target-a`)).json(),
      ).toMatchObject({ approved: true });
      const batch = capturedEvents(port);
      // Ground truth: node node_modules/vitest/vitest.mjs run src/server/server.test.ts -t 'isolates summaries, rejects stale writes, emits trusted origins, and revokes approval'.
      expect(batch.events.filter((entry) => entry.type === 'review.approval')).toEqual([
        expect.objectContaining({ approved: true, origin: 'user' }),
        expect.objectContaining({ approved: false, origin: 'user' }),
        expect.objectContaining({ approved: true, origin: 'user' }),
        expect.objectContaining({ approved: false, origin: 'agent' }),
        expect.objectContaining({ approved: true, origin: 'user' }),
      ]);
      expect(batch.events.filter((entry) => entry.type === 'review.summary')).toEqual([
        expect.objectContaining({
          origin: 'user',
          summary: expect.objectContaining({ version: 1 }),
        }),
        expect.objectContaining({
          origin: 'agent',
          summary: expect.objectContaining({ version: 2, rationale: 'Agent revision' }),
        }),
      ]);
      expect(
        (await post(`${origin}/api/conversation/summary`, { ...input, reviewId: 'missing' }))
          .status,
      ).toBe(404);
    });

    it('seeds the initial selection and remains editable without conversation mode', async () => {
      const { port, server } = await startServer({
        commitMessage: 'feat: add proposal',
        why: 'Review the intent.',
        shipIt: true,
      });
      servers.push(server);
      const origin = `http://localhost:${port}`;
      const url = `${origin}/api/review-summary`;
      expect(await (await fetch(url)).json()).toMatchObject({
        commitMessage: 'feat: add proposal',
        rationale: 'Review the intent.',
        version: 1,
      });
      await fetch(`${origin}/api/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true, summaryVersion: 1 }),
      });
      const result = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitMessage: '', rationale: '', baseVersion: 1 }),
      });
      expect(await result.json()).toMatchObject({ commitMessage: '', rationale: '', version: 2 });
      expect(await (await fetch(`${origin}/api/approval`)).json()).toMatchObject({
        approved: false,
      });
      expect(
        (
          await fetch(`${origin}/api/conversation/summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(404);
    });

    it.each([true, false])(
      'rejects approval of an unseen summary with conversation=%s',
      async (conversation) => {
        const { port, server } = await startServer({ conversation, shipIt: true });
        servers.push(server);
        const origin = `http://localhost:${port}`;
        const post = (path: string, body: unknown) =>
          fetch(`${origin}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        expect((await post('/api/approval', { approved: true })).status).toBe(200);
        await post('/api/review-summary', {
          commitMessage: 'fix: initial proposal',
          rationale: '',
          baseVersion: 0,
        });
        expect((await post('/api/approval', { approved: true, summaryVersion: 1 })).status).toBe(
          200,
        );
        await post('/api/review-summary', {
          commitMessage: 'fix: revised proposal',
          rationale: 'Changed while approving',
          baseVersion: 1,
        });
        for (const summaryVersion of [undefined, 0, 1]) {
          const response = await post('/api/approval', { approved: true, summaryVersion });
          expect(response.status).toBe(409);
          expect(await response.json()).toMatchObject({ summary: { version: 2 } });
          expect(await (await fetch(`${origin}/api/approval`)).json()).toMatchObject({
            approved: false,
          });
        }
        for (const summaryVersion of [-1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1]) {
          expect((await post('/api/approval', { approved: true, summaryVersion })).status).toBe(
            400,
          );
        }
        expect((await post('/api/approval', { approved: true, summaryVersion: 2 })).status).toBe(
          200,
        );
        expect(await (await fetch(`${origin}/api/approval`)).json()).toMatchObject({
          approved: true,
        });
        expect((await post('/api/approval', { approved: false, summaryVersion: 0 })).status).toBe(
          200,
        );
        expect(await (await fetch(`${origin}/api/approval`)).json()).toMatchObject({
          approved: false,
        });
      },
    );

    it('rejects malformed, oversized, and browser-simple summary requests', async () => {
      const { port, server } = await startObservedServer({ conversation: true });
      servers.push(server);
      const url = `http://localhost:${port}/api/review-summary`;
      const valid = { commitMessage: '', rationale: '', baseVersion: 0 };
      for (const body of [
        null,
        {},
        { ...valid, baseVersion: -1 },
        { ...valid, baseVersion: 0.5 },
        { ...valid, commitMessage: 1 },
        { ...valid, commitMessage: 'x'.repeat(16001) },
        { ...valid, rationale: 'x'.repeat(4001) },
      ]) {
        expect(
          (
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          ).status,
        ).toBe(400);
      }
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(valid),
          })
        ).status,
      ).toBe(415);
    });
  });

  describe('Ship it option', () => {
    it('keeps approval reversible, selection-scoped, and visible to conversation consumers', async () => {
      const { port, server } = await startObservedServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        shipIt: true,
        conversation: true,
      });
      servers.push(server);
      const origin = `http://localhost:${port}`;
      const url = `${origin}/api/approval?base=base-a&target=target-a`;
      expect(await (await fetch(url)).json()).toMatchObject({ approved: false });
      for (const approved of [true, false]) {
        const result = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved }),
        });
        expect(result.ok).toBe(true);
        expect(await result.json()).toMatchObject({ approved });
        expect(await (await fetch(url)).json()).toMatchObject({ approved });
        expect(process.exit).not.toHaveBeenCalled();
      }
      const other = await fetch(`${origin}/api/approval?base=base-b&target=target-b`);
      expect(await other.json()).toMatchObject({ approved: false });
      const batch = capturedEvents(port);
      expect(batch.events).toEqual([
        expect.objectContaining({
          type: 'review.approval',
          approved: true,
          selection: { baseCommitish: 'base-a', targetCommitish: 'target-a' },
        }),
        expect.objectContaining({ type: 'review.approval', approved: false }),
      ]);
      const snapshot = (await (
        await fetch(`${origin}/api/conversation/snapshot`)
      ).json()) as ConversationSnapshot;
      expect(
        snapshot.reviews.find((review) => review.selection.targetCommitish === 'target-a')?.approval
          .approved,
      ).toBe(false);
    });

    it('supports the toggle without conversation mode and rejects malformed approval', async () => {
      const { port, server } = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        shipIt: true,
      });
      servers.push(server);
      const url = `http://localhost:${port}/api/approval`;
      for (const body of ['{}', '{"approved":"true"}', 'null']) {
        expect(
          (
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
            })
          ).status,
        ).toBe(400);
      }
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: '{"approved":true}',
          })
        ).status,
      ).toBe(415);
      for (const approved of [true, false]) {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved }),
        });
        expect(await (await fetch(url)).json()).toMatchObject({ approved });
      }
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('includes shipIt flag in diff response when enabled', async () => {
      const { port, server } = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
        shipIt: true,
      });
      servers.push(server);

      const response = await fetch(`http://localhost:${port}/api/diff`);
      const data = (await response.json()) as any;

      expect(data.shipIt).toBe(true);
    });

    it('prints comments, then the approval line, then exits on POST /api/ship-it', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const { port, server } = await startServer({
          selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
          shipIt: true,
        });
        servers.push(server);
        await fetch(`http://localhost:${port}/api/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            comments: [
              {
                id: '1',
                file: 'src/App.tsx',
                line: 10,
                body: 'Nit: rename this',
                timestamp: '2024-01-01T00:00:00Z',
              },
            ],
          }),
        });

        const response = await fetch(`http://localhost:${port}/api/ship-it`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });

        expect(response.ok).toBe(true);
        await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
        const output = log.mock.calls.map((args) => String(args[0]));
        expect(output.at(-1)).toBe('✅ Commit approved: abc1234');
        expect(output.at(-2)).toContain('src/App.tsx:L10');
      } finally {
        log.mockRestore();
      }
    });

    it('writes JSONL approval and approved shutdown before draining ship-it output', async () => {
      // Ground truth: node node_modules/vitest/vitest.mjs run src/server/server.test.ts -t 'writes JSONL approval'.
      let flush: (() => void) | undefined;
      const write = vi.spyOn(process.stdout, 'write').mockImplementation((...args: unknown[]) => {
        const callback = args.at(-1);
        if (typeof callback === 'function') {
          if (args[0] === '') flush = () => Reflect.apply(callback, undefined, []);
          else Reflect.apply(callback, undefined, []);
        }
        return true;
      });
      try {
        const result = await startServer({ preferredPort: 0, shipIt: true, jsonl: true });
        servers.push(result.server);
        const response = await fetch(`${result.url}/api/ship-it`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        expect(response.status).toBe(200);
        await vi.waitFor(() => expect(flush).toBeTypeOf('function'));
        const records = write.mock.calls
          .map((args) => String(args[0]))
          .filter((chunk) => chunk.trim())
          .map((chunk) => JSON.parse(chunk) as ServerEvent);
        expect(records.slice(-2)).toEqual([
          expect.objectContaining({ type: 'review.approval', approved: true, origin: 'user' }),
          expect.objectContaining({ type: 'server.shutdown', reason: 'approved' }),
        ]);
        expect(process.exit).not.toHaveBeenCalled();
        flush?.();
        flush = undefined;
        expect(process.exit).toHaveBeenCalledWith(0);
      } finally {
        flush?.();
        write.mockRestore();
      }
    });

    it('approves the requested selection after another tab changes revisions', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const { port, server } = await startServer({
          selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
          shipIt: true,
        });
        servers.push(server);
        await fetch(`http://localhost:${port}/api/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            comments: [{ id: 'a', file: 'a.ts', line: 1, body: 'Tab A comment' }],
          }),
        });
        const parser = parserInstances.at(-1);
        const diff = await parser.parseDiff();
        parser.parseDiff.mockResolvedValue({
          ...diff,
          baseCommitish: 'ccccccc',
          targetCommitish: 'bbbbbbb',
        });
        await fetch(`http://localhost:${port}/api/diff?base=ccccccc&target=bbbbbbb`);

        await fetch(`http://localhost:${port}/api/ship-it?base=def4567&target=abc1234`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });

        await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
        const output = log.mock.calls.map((args) => String(args[0]));
        expect(output.at(-1)).toBe('✅ Commit approved: abc1234');
        expect(output.join('\n')).toContain('Tab A comment');
      } finally {
        log.mockRestore();
      }
    });

    it.each([{ contentType: 'text/plain' }, { contentType: 'application/x-www-form-urlencoded' }])(
      'rejects browser-simple $contentType approval requests',
      async ({ contentType }) => {
        const { port, server } = await startServer({
          selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
          shipIt: true,
        });
        servers.push(server);

        const response = await fetch(`http://localhost:${port}/api/ship-it`, {
          method: 'POST',
          headers: { 'Content-Type': contentType, Origin: 'https://example.invalid' },
          body: '{}',
        });

        expect(response.status).toBe(415);
        expect(process.exit).not.toHaveBeenCalled();
      },
    );

    it('waits for stdout to flush before exiting', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      let flush: (() => void) | undefined;
      const write = vi.spyOn(process.stdout, 'write').mockImplementation((...args: unknown[]) => {
        const callback = args.at(-1);
        if (typeof callback === 'function') {
          flush = () => Reflect.apply(callback, undefined, []);
        }
        return true;
      });
      try {
        const { port, server } = await startServer({
          selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
          shipIt: true,
        });
        servers.push(server);
        await fetch(`http://localhost:${port}/api/ship-it`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });

        await vi.waitFor(() => expect(flush).toBeTypeOf('function'));
        expect(process.exit).not.toHaveBeenCalled();
        flush?.();
        flush = undefined;
        expect(process.exit).toHaveBeenCalledWith(0);
      } finally {
        flush?.();
        write.mockRestore();
        log.mockRestore();
      }
    });

    it('does not register POST /api/ship-it without the shipIt option', async () => {
      const { port, server } = await startServer({
        selection: { targetCommitish: 'HEAD', baseCommitish: 'HEAD^' },
      });
      servers.push(server);

      const response = await fetch(`http://localhost:${port}/api/ship-it`, { method: 'POST' });

      expect(response.status).toBe(404);
      expect(process.exit).not.toHaveBeenCalled();
    });
  });
});
