import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createCommentCommand } from './comment.js';

describe('createCommentCommand', () => {
  const command = createCommentCommand();

  it('creates a command named "comment"', () => {
    expect(command.name()).toBe('comment');
  });

  it('has "add", "get", and "resolve" subcommands', () => {
    const subcommandNames = command.commands.map((c) => c.name());
    expect(subcommandNames).toContain('add');
    expect(subcommandNames).toContain('get');
    expect(subcommandNames).toContain('resolve');
  });

  it.each(['add', 'get', 'resolve', 'reopen', 'delete'])(
    'rejects bad ports before connecting for %s',
    async (action) => {
      for (const port of ['abc', '0', '99999', '4966suffix']) {
        const command = createCommentCommand();
        command.commands
          .find((child) => child.name() === action)!
          .exitOverride()
          .configureOutput({ writeErr: vi.fn() });
        await expect(
          command.parseAsync([
            'node',
            'gavel',
            action,
            '--port',
            port,
            ...(['add', 'get'].includes(action) ? [] : ['thread']),
          ]),
        ).rejects.toThrow('Expected an integer from 1 to 65535');
      }
    },
  );

  describe('add subcommand', () => {
    const addCommand = command.commands.find((c) => c.name() === 'add')!;

    it('requires --port option', () => {
      const portOption = addCommand.options.find((o) => o.long === '--port');
      expect(portOption).toBeDefined();
      expect(portOption?.mandatory).toBe(true);
    });

    it('accepts optional json argument', () => {
      const args = addCommand.registeredArguments;
      expect(args).toHaveLength(1);
      expect(args[0].name()).toBe('json');
      expect(args[0].required).toBe(false);
    });
  });

  describe('get subcommand', () => {
    const getCommand = command.commands.find((c) => c.name() === 'get')!;

    it('requires --port option', () => {
      const portOption = getCommand.options.find((o) => o.long === '--port');
      expect(portOption).toBeDefined();
      expect(portOption?.mandatory).toBe(true);
    });

    it('has --format option with choices', () => {
      const formatOption = getCommand.options.find((o) => o.long === '--format');
      expect(formatOption).toBeDefined();
      expect(formatOption?.defaultValue).toBe('text');
      expect(formatOption?.argChoices).toEqual(['text', 'json']);
    });
  });

  describe('resolve subcommand', () => {
    const resolveCommand = command.commands.find((c) => c.name() === 'resolve')!;

    it('only offers review selection for commands that support it', () => {
      expect(
        command.commands
          .find((c) => c.name() === 'delete')!
          .options.some((o) => o.long === '--review'),
      ).toBe(false);
      expect(resolveCommand.options.some((o) => o.long === '--review')).toBe(true);
      expect(
        command.commands
          .find((c) => c.name() === 'reopen')!
          .options.some((o) => o.long === '--review'),
      ).toBe(true);
    });

    it('reserves "remove" as an alias for deletion', () => {
      expect(command.commands.find((c) => c.name() === 'delete')!.aliases()).toContain('remove');
    });

    it('requires --port option', () => {
      const portOption = resolveCommand.options.find((o) => o.long === '--port');
      expect(portOption).toBeDefined();
      expect(portOption?.mandatory).toBe(true);
    });

    it('accepts variadic threadIds argument', () => {
      const args = resolveCommand.registeredArguments;
      expect(args).toHaveLength(1);
      expect(args[0].name()).toBe('threadIds');
      expect(args[0].required).toBe(true);
      expect(args[0].variadic).toBe(true);
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}

describe('comment subcommand integration', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  let originalProcessExit: typeof process.exit;
  let consoleOutput: string[];
  let consoleErrors: string[];

  beforeEach(() => {
    mockFetch = vi.fn<typeof fetch>();
    globalThis.fetch = mockFetch;

    originalProcessExit = process.exit;
    process.exit = vi.fn() as any;

    consoleOutput = [];
    consoleErrors = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.join(' '));
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.exit = originalProcessExit;
    vi.restoreAllMocks();
  });

  it.each(['add', 'get', 'resolve', 'reopen', 'delete'])(
    'uses a selected interface for comment %s',
    async (action) => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, threads: [] }));
      const args =
        action === 'add'
          ? [
              '{"type":"thread","filePath":"test.ts","position":{"side":"new","line":1},"body":"Test"}',
            ]
          : action === 'get'
            ? []
            : ['thread'];
      await createCommentCommand().parseAsync([
        'node',
        'gavel',
        action,
        '--host',
        '10.1.1.24',
        '--port',
        '4966',
        ...args,
      ]);
      expect(mockFetch.mock.calls[0]?.[0]).toMatch(/^http:\/\/10\.1\.1\.24:4966\/api\//);
    },
  );

  describe('add', () => {
    it('sends comment imports to the server', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, importId: 'abc123', count: 1 }));

      const command = createCommentCommand();
      await command.parseAsync([
        'node',
        'gavel',
        'add',
        '--port',
        '4966',
        '{"type":"thread","filePath":"test.ts","position":{"side":"new","line":1},"body":"Test"}',
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4966/api/comment-imports',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(consoleOutput[0]).toContain('"success":true');
    });

    it('sends comment imports to the named review given by --review', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, importId: 'abc123', count: 1 }));

      await createCommentCommand().parseAsync([
        'node',
        'gavel',
        'add',
        '--port',
        '4966',
        '--review',
        'second-task',
        '{"type":"thread","filePath":"test.ts","position":{"side":"new","line":1},"body":"Test"}',
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4966/api/comment-imports?review=second-task',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('validates JSON before sending', async () => {
      const command = createCommentCommand();
      await command.parseAsync(['node', 'gavel', 'add', '--port', '4966', 'not-valid-json']);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(consoleErrors[0]).toContain('Error:');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('handles server error response', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Bad request' }, 400));

      const command = createCommentCommand();
      await command.parseAsync([
        'node',
        'gavel',
        'add',
        '--port',
        '4966',
        '{"type":"thread","filePath":"test.ts","position":{"side":"new","line":1},"body":"Test"}',
      ]);

      expect(consoleErrors[0]).toContain('Bad request');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('handles connection error', async () => {
      const fetchError = new TypeError('fetch failed');
      mockFetch.mockRejectedValue(fetchError);

      const command = createCommentCommand();
      await command.parseAsync([
        'node',
        'gavel',
        'add',
        '--port',
        '9999',
        '{"type":"thread","filePath":"test.ts","position":{"side":"new","line":1},"body":"Test"}',
      ]);

      expect(consoleErrors[0]).toContain('Cannot connect');
      expect(consoleErrors[0]).toContain('9999');
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('get', () => {
    it('fetches comments in text format by default', async () => {
      mockFetch.mockResolvedValue(textResponse('Comments output text'));

      const command = createCommentCommand();
      await command.parseAsync(['node', 'gavel', 'get', '--port', '4966']);

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4966/api/comments-output');
      expect(consoleOutput[0]).toBe('Comments output text');
    });

    it('fetches comments in json format', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ threads: [{ id: '1' }] }));

      const command = createCommentCommand();
      await command.parseAsync(['node', 'gavel', 'get', '--port', '4966', '--format', 'json']);

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4966/api/comments-json');
      expect(consoleOutput[0]).toContain('"threads"');
    });

    it('handles connection error', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      const command = createCommentCommand();
      await command.parseAsync(['node', 'gavel', 'get', '--port', '9999']);

      expect(consoleErrors[0]).toContain('Cannot connect');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('handles empty text output silently', async () => {
      mockFetch.mockResolvedValue(textResponse('  '));

      const command = createCommentCommand();
      await command.parseAsync(['node', 'gavel', 'get', '--port', '4966']);

      expect(consoleOutput).toHaveLength(0);
    });
  });

  describe('resolve', () => {
    it('preserves threads with resolution requests for each ID', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, threadId: 'abc123', version: 2 }));

      const command = createCommentCommand();
      await command.parseAsync(['node', 'gavel', 'resolve', '--port', '4966', 'abc123', 'def456']);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4966/api/comments/abc123/resolution',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolved: true }),
        },
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4966/api/comments/def456/resolution',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolved: true }),
        },
      );
      expect(consoleOutput[0]).toBe(
        JSON.stringify({
          success: true,
          resolved: ['abc123', 'def456'],
          notFound: [],
          errors: [],
        }),
      );
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('reopens the explicitly selected review without deleting messages', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true }));
      await createCommentCommand().parseAsync([
        'node',
        'gavel',
        'reopen',
        '--port',
        '4966',
        '--review',
        'review-2',
        'thread-1',
      ]);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4966/api/comments/thread-1/resolution',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolved: false, reviewId: 'review-2' }),
        },
      );
      expect(JSON.parse(consoleOutput[0]!)).toMatchObject({
        success: true,
        reopened: ['thread-1'],
      });
    });

    it('works via the remove alias', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, threadId: 'abc123', version: 2 }));

      const command = createCommentCommand();
      await command.parseAsync(['node', 'gavel', 'remove', '--port', '4966', 'abc123']);

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4966/api/comments/abc123', {
        method: 'DELETE',
      });
      expect(JSON.parse(consoleOutput[0]!)).toEqual({
        success: true,
        deleted: ['abc123'],
        notFound: [],
        errors: [],
      });
    });

    it('URL-encodes thread IDs', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true }));

      const command = createCommentCommand();
      await command.parseAsync(['node', 'gavel', 'resolve', '--port', '4966', 'a/b c']);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4966/api/comments/a%2Fb%20c/resolution',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolved: true }),
        },
      );
    });

    it('reports an expired review as an error instead of a deleted thread', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Review not found' }, 404));
      await createCommentCommand().parseAsync([
        'node',
        'gavel',
        'resolve',
        '--port',
        '4966',
        '--review',
        'expired',
        'thread-1',
      ]);
      expect(JSON.parse(consoleOutput[0]!)).toEqual({
        success: false,
        resolved: [],
        notFound: [],
        errors: [{ threadId: 'thread-1', error: 'Review not found' }],
      });
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('reports unknown thread IDs and exits with an error', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true, threadId: 'abc123', version: 2 }))
        .mockResolvedValueOnce(jsonResponse({ error: 'Thread not found: missing' }, 404));

      const command = createCommentCommand();
      await command.parseAsync(['node', 'gavel', 'resolve', '--port', '4966', 'abc123', 'missing']);

      expect(consoleOutput[0]).toBe(
        JSON.stringify({
          success: false,
          resolved: ['abc123'],
          notFound: ['missing'],
          errors: [],
        }),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('collects server errors without dropping remaining thread IDs', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ error: 'Internal error' }, 500))
        .mockResolvedValueOnce(jsonResponse({ success: true, threadId: 'def456', version: 2 }));

      const command = createCommentCommand();
      await command.parseAsync(['node', 'gavel', 'resolve', '--port', '4966', 'abc123', 'def456']);

      expect(consoleOutput[0]).toBe(
        JSON.stringify({
          success: false,
          resolved: ['def456'],
          notFound: [],
          errors: [{ threadId: 'abc123', error: 'Internal error' }],
        }),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('handles connection error', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      const command = createCommentCommand();
      await command.parseAsync(['node', 'gavel', 'resolve', '--port', '9999', 'abc123']);

      expect(consoleErrors[0]).toContain('Cannot connect');
      expect(consoleErrors[0]).toContain('9999');
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
