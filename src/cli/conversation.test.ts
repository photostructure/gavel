import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCommentCommand } from './comment.js';
import { readStdin, detectStdinSource } from './utils.js';

vi.mock('./utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./utils.js')>()),
  readStdin: vi.fn(),
  detectStdinSource: vi.fn(),
}));

describe('conversation commands', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const log = vi.fn();
  const error = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(log);
    vi.spyOn(console, 'error').mockImplementation(error);
  });
  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it.each(['snapshot', 'reply', 'status', 'summary'])(
    'uses an explicitly selected server host for %s',
    async (action) => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true })));
      await createCommentCommand().parseAsync([
        'node',
        'gavel',
        action,
        '--host',
        '10.1.1.24',
        '--port',
        '4966',
        ...(action === 'snapshot' ? [] : ['{}']),
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        `http://10.1.1.24:4966/api/conversation/${action}`,
        expect.anything(),
      );
    },
  );

  it('identifies the attempted interface when a connection fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await createCommentCommand().parseAsync([
      'node',
      'gavel',
      'snapshot',
      '--host',
      '10.1.1.24',
      '--port',
      '4966',
    ]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('http://10.1.1.24:4966/'));
  });

  it('omits watch from the comment help and command surface', () => {
    const command = createCommentCommand();
    expect(command.commands.map((subcommand) => subcommand.name())).not.toContain('watch');
    expect(command.helpInformation()).not.toContain('watch');
    expect(
      command.commands.find((subcommand) => subcommand.name() === 'status')?.description(),
    ).toContain('delivered');
  });

  it.each([{ args: [] }, { args: ['--port', '4966', '--once'] }])(
    'rejects the removed watch command with arguments %j',
    async ({ args }) => {
      const stderr = vi.fn();
      const command = createCommentCommand().exitOverride().configureOutput({ writeErr: stderr });
      await expect(command.parseAsync(['node', 'gavel', 'watch', ...args])).rejects.toThrow(
        "unknown command 'watch'",
      );
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining("unknown command 'watch'"));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    },
  );

  it.each(['snapshot', 'reply', 'status', 'summary'])(
    'requires a valid TCP port for %s',
    async (action) => {
      for (const port of ['0', '65536', '1.5', '4966suffix']) {
        const command = createCommentCommand();
        command.commands
          .find((subcommand) => subcommand.name() === action)!
          .exitOverride()
          .configureOutput({ writeErr: vi.fn() });
        await expect(command.parseAsync(['node', 'gavel', action, '--port', port])).rejects.toThrow(
          'Expected an integer from 1 to 65535',
        );
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['reply', 'status', 'summary'])(
    'requires JSON on an interactive terminal for %s',
    async (action) => {
      vi.mocked(detectStdinSource).mockReturnValue('tty');
      await createCommentCommand().parseAsync(['node', 'gavel', action, '--port', '4966']);
      expect(error).toHaveBeenCalledWith(
        `Error: Provide ${action === 'summary' ? 'review summary' : action} JSON as an argument or via stdin`,
      );
      expect(readStdin).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    },
  );

  it.each(['reply', 'status', 'summary'])(
    'rejects malformed JSON before sending %s',
    async (action) => {
      await createCommentCommand().parseAsync([
        'node',
        'gavel',
        action,
        '--port',
        '4966',
        'invalid-json',
      ]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Error:'));
      expect(process.exitCode).toBe(1);
    },
  );

  it('sends an explicit delivered receipt using the event identity', async () => {
    const status = {
      reviewId: 'r',
      threadId: 't',
      messageId: 'm',
      cursor: 's:1',
      status: 'delivered',
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true })));
    await createCommentCommand().parseAsync([
      'node',
      'gavel',
      'status',
      '--port',
      '4966',
      JSON.stringify(status),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4966/api/conversation/status',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(status) }),
    );
    expect(log).toHaveBeenCalledWith('{"success":true}');
    expect(error).not.toHaveBeenCalled();
  });

  it('sends an explicit thinking status from stdin', async () => {
    const status = {
      reviewId: 'r',
      threadId: 't',
      messageId: 'm',
      cursor: 's:1',
      status: 'thinking',
    };
    vi.mocked(detectStdinSource).mockReturnValue('pipe');
    vi.mocked(readStdin).mockResolvedValue(JSON.stringify(status));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true })));
    await createCommentCommand().parseAsync(['node', 'gavel', 'status', '--port', '4966']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4966/api/conversation/status',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(status) }),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('sends a review summary from stdin using the exact review and version', async () => {
    const input = {
      reviewId: 'review-a',
      commitMessage: 'fix: preserve intent',
      rationale: 'Review why.',
      baseVersion: 3,
    };
    vi.mocked(detectStdinSource).mockReturnValue('pipe');
    vi.mocked(readStdin).mockResolvedValue(JSON.stringify(input));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...input, version: 4 })));
    await createCommentCommand().parseAsync(['node', 'gavel', 'summary', '--port', '4966']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4966/api/conversation/summary',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('prints a reconciliation snapshot with its state checkpoint cursor', async () => {
    const snapshot = { reviews: [{ id: 'review-a', threads: [] }], cursor: 'stream:8' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(snapshot)));
    await createCommentCommand().parseAsync(['node', 'gavel', 'snapshot', '--port', '4966']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4966/api/conversation/snapshot',
      expect.anything(),
    );
    expect(log).toHaveBeenCalledWith(JSON.stringify(snapshot));
  });

  it('sends exact reply identities and a multiline body as JSON', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true })));
    const reply = {
      reviewId: 'review-a',
      threadId: 'thread-a',
      inReplyTo: 'question-a',
      body: 'Answer\nwith context',
      author: 'Codex',
    };
    await createCommentCommand().parseAsync([
      'node',
      'gavel',
      'reply',
      '--port',
      '4966',
      JSON.stringify(reply),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4966/api/conversation/reply',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reply),
      }),
    );
    expect(log).toHaveBeenCalledWith('{"success":true}');
  });
  it('preserves a precise server error for a deleted reply target', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'Review, thread, or parent message no longer exists' }),
        { status: 404 },
      ),
    );
    await createCommentCommand().parseAsync(['node', 'gavel', 'reply', '--port', '4966', '{}']);
    expect(error).toHaveBeenCalledWith('Error: Review, thread, or parent message no longer exists');
    expect(process.exitCode).toBe(1);
  });

  it.each([
    [
      404,
      'Conversation endpoint or thread not found; start gavel with --conversation and use IDs from its events',
    ],
    [500, 'Conversation request failed (500)'],
  ])('reports HTTP %s when no JSON error is available', async (status, message) => {
    fetchMock.mockResolvedValue(new Response('Not JSON', { status }));
    await createCommentCommand().parseAsync(['node', 'gavel', 'snapshot', '--port', '4966']);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(`Error: ${message}`);
    expect(process.exitCode).toBe(1);
  });

  it.each(['snapshot', 'reply', 'status', 'summary'])(
    'identifies the unreachable server for %s',
    async (command) => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      await createCommentCommand().parseAsync([
        'node',
        'gavel',
        command,
        '--port',
        '4966',
        ...(command === 'snapshot' ? [] : ['{}']),
      ]);
      expect(error).toHaveBeenCalledWith(
        'Error: Cannot connect to gavel server at http://localhost:4966/. Check --host and --port.',
      );
      expect(process.exitCode).toBe(1);
    },
  );

  it('sends reply JSON read from stdin', async () => {
    const reply = {
      reviewId: 'review',
      threadId: 'thread',
      inReplyTo: 'question',
      body: 'Answer\nfrom stdin',
    };
    vi.mocked(detectStdinSource).mockReturnValue('pipe');
    vi.mocked(readStdin).mockResolvedValue(JSON.stringify(reply));
    fetchMock.mockResolvedValue(new Response('{}'));
    await createCommentCommand().parseAsync(['node', 'gavel', 'reply', '--port', '4966']);
    expect(readStdin).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4966/api/conversation/reply',
      expect.objectContaining({ body: JSON.stringify(reply) }),
    );
  });
});
