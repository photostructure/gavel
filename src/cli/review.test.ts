import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  capturePatch,
  captureWorkingTree,
  getCaptureRepository,
  selectCapture,
  validateCapture,
} from '../server/review-capture.js';
import type { ReviewCapture } from '../types/review.js';

import { createReviewCommand, resolveNamedReview, validateReviewName } from './review.js';
import { findSavedCapture, revertCapture, type RevertResult } from './unapply.js';
import { detectStdinSource, readStdin } from './utils.js';

vi.mock('../server/review-capture.js', () => ({
  capturePatch: vi.fn(),
  captureWorkingTree: vi.fn(),
  getCaptureRepository: vi.fn(),
  selectCapture: vi.fn(),
  validateCapture: vi.fn(),
}));

vi.mock('./unapply.js', () => ({ findSavedCapture: vi.fn(), revertCapture: vi.fn() }));

vi.mock('./utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./utils.js')>()),
  readStdin: vi.fn(),
  detectStdinSource: vi.fn(),
}));

const capture: ReviewCapture = {
  schemaVersion: 1,
  repositoryId: 'repository-identity',
  repositoryRoot: '/tmp/review-repository',
  baseCommit: 'a'.repeat(40),
  patch:
    'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-before\n+after\n',
  patchDigest: '1'.repeat(64),
  files: [
    {
      id: 'file-one',
      path: 'file.ts',
      hunks: [{ id: 'hunk-one', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }],
    },
  ],
};
const selectedCapture: ReviewCapture = { ...capture, patchDigest: '2'.repeat(64) };

function command(): Command {
  const review = createReviewCommand();
  for (const current of [review, ...review.commands]) {
    current.exitOverride().configureOutput({ writeErr: vi.fn() });
  }
  return review;
}

async function run(...args: string[]): Promise<Command> {
  return command().parseAsync(['node', 'gavel', ...args]);
}

describe('named review CLI', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const log = vi.fn();
  const error = vi.fn();
  let directory: string;

  beforeEach(async () => {
    vi.stubEnv('CODEX_THREAD_ID', undefined);
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', undefined);
    directory = await mkdtemp(join(tmpdir(), 'gavel-review-cli-'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(log);
    vi.spyOn(console, 'error').mockImplementation(error);
    vi.mocked(captureWorkingTree).mockResolvedValue(capture);
    vi.mocked(getCaptureRepository).mockResolvedValue({
      repositoryRoot: capture.repositoryRoot,
      repositoryId: capture.repositoryId,
      baseCommit: capture.baseCommit,
    });
    vi.mocked(capturePatch).mockReturnValue(capture);
    vi.mocked(validateCapture).mockReturnValue(capture);
    vi.mocked(selectCapture).mockReturnValue(selectedCapture);
    vi.mocked(detectStdinSource).mockReturnValue('tty');
    vi.mocked(readStdin).mockResolvedValue(capture.patch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true })));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    process.exitCode = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it.each(['a', 'A0.task_1-branch', '9'.repeat(80)])('accepts review name %s unchanged', (name) => {
    expect(validateReviewName(name)).toBe(name);
  });

  it.each([
    '',
    '.task',
    '-task',
    '_task',
    ' task',
    'task ',
    'a/b',
    'a%2Fb',
    'a?b',
    'é',
    'a'.repeat(81),
    'a\nb',
    'a\n',
    'a\r',
    'a\u2028',
  ])('rejects ambiguous or invalid review name %j before capture', async (name) => {
    await expect(resolveNamedReview({ name })).rejects.toThrow('Review name');
    expect(captureWorkingTree).not.toHaveBeenCalled();
    expect(getCaptureRepository).not.toHaveBeenCalled();
  });

  it('resolves the native uncommitted capture by default and forwards Git pathspecs unchanged', async () => {
    const pathspecs = ['src/**/*.ts', ':(exclude)src/vendor/**'];
    await expect(
      resolveNamedReview({
        name: 'task',
        cwd: '/tmp/review-repository/src',
        pathspecs,
        includeUntracked: true,
      }),
    ).resolves.toEqual({ name: 'task', capture });
    expect(captureWorkingTree).toHaveBeenCalledWith({
      cwd: '/tmp/review-repository/src',
      pathspecs,
      includeUntracked: true,
    });
    expect(readStdin).not.toHaveBeenCalled();
  });

  it('binds an explicit supplied patch to current repository metadata', async () => {
    await expect(
      resolveNamedReview({ name: 'task', patch: capture.patch, cwd: '/tmp/repository' }),
    ).resolves.toEqual({ name: 'task', capture });
    expect(getCaptureRepository).toHaveBeenCalledWith('/tmp/repository');
    expect(capturePatch).toHaveBeenCalledWith(capture.patch, {
      repositoryRoot: capture.repositoryRoot,
      repositoryId: capture.repositoryId,
      baseCommit: capture.baseCommit,
    });
    expect(captureWorkingTree).not.toHaveBeenCalled();
  });

  it('loads and validates saved artifacts before selecting immutable IDs', async () => {
    const file = join(directory, 'capture.json');
    await writeFile(file, JSON.stringify(capture));
    await expect(
      resolveNamedReview({
        name: 'task',
        captureFile: file,
        selectedIds: ['file-one', 'hunk-one'],
      }),
    ).resolves.toEqual({ name: 'task', capture: selectedCapture });
    expect(validateCapture).toHaveBeenCalledWith(capture);
    expect(selectCapture).toHaveBeenCalledWith(capture, ['file-one', 'hunk-one']);
    expect(captureWorkingTree).not.toHaveBeenCalled();
    expect(getCaptureRepository).not.toHaveBeenCalled();
  });

  it.each([
    { patch: '', captureFile: '/missing.json' },
    { patch: capture.patch, pathspecs: ['src'] },
    { patch: capture.patch, includeUntracked: true },
    { captureFile: '/missing.json', pathspecs: ['src'] },
    { captureFile: '/missing.json', includeUntracked: true },
  ])('rejects conflicting resolution sources or native filters %j', async (options) => {
    await expect(resolveNamedReview({ name: 'task', ...options })).rejects.toThrow(
      /patch source|only apply/,
    );
    expect(captureWorkingTree).not.toHaveBeenCalled();
    expect(getCaptureRepository).not.toHaveBeenCalled();
    expect(validateCapture).not.toHaveBeenCalled();
  });

  it.each([
    { action: 'create', patch: '' },
    { action: 'update', patch: '' },
    { action: 'create', patch: ' \n\t' },
    { action: 'update', patch: ' \n\t' },
  ])('rejects blank stdin before $action sends a capture', async ({ action, patch }) => {
    // Ground truth: gavel - --review task rejects blank stdin with No diff content received from stdin.
    vi.mocked(detectStdinSource).mockReturnValue('pipe');
    vi.mocked(readStdin).mockResolvedValue(patch);
    await run(
      action,
      'task',
      '-',
      '--port',
      '4966',
      ...(action === 'update' ? ['--expected-version', '1'] : []),
    );
    expect(error).toHaveBeenCalledExactlyOnceWith('Error: No diff content received from stdin');
    expect(process.exitCode).toBe(1);
    expect(getCaptureRepository).not.toHaveBeenCalled();
    expect(capturePatch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prints a full artifact from review capture by default', async () => {
    await run('capture');
    expect(captureWorkingTree).toHaveBeenCalledWith({ pathspecs: [], includeUntracked: undefined });
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify(capture));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('writes a full artifact only to the requested output and prints its catalogue', async () => {
    const output = join(directory, 'capture.json');
    await run(
      'capture',
      '--output',
      output,
      '--pathspec',
      'src',
      '--pathspec',
      ':(exclude)src/vendor',
      '--include-untracked',
    );
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(capture);
    expect(captureWorkingTree).toHaveBeenCalledWith({
      pathspecs: ['src', ':(exclude)src/vendor'],
      includeUntracked: true,
    });
    const catalogue = { ...capture } as Partial<ReviewCapture>;
    delete catalogue.patch;
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify(catalogue));
    expect(error).not.toHaveBeenCalled();
  });

  it('reports an artifact output failure without printing success', async () => {
    await run('capture', '--output', join(directory, 'missing', 'capture.json'));
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
    expect(process.exitCode).toBe(1);
  });

  it('creates another named review on the same running server using native capture', async () => {
    const result = { name: 'task-b', version: 1, patchDigest: capture.patchDigest, updated: true };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(result)));
    await run('create', 'task-b', '--port', '4983');
    // null: without an inbox of its own, the review must not go to the launching session.
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://localhost:4983/api/reviews',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'task-b', capture, inbox: null }),
      }),
    );
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify(result));
    expect(error).not.toHaveBeenCalled();
  });

  it('records the creating Codex thread and home', async () => {
    const sessionId = '01a1d14e-3f20-7a62-b380-2a1ce396a0d5';
    vi.stubEnv('CODEX_THREAD_ID', sessionId);
    vi.stubEnv('CODEX_HOME', '/home/test/.codex');
    await run('create', 'task-b', '--port', '4983');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { inbox: unknown };
    expect(body.inbox).toEqual({ kind: 'codex', sessionId, home: '/home/test/.codex' });
  });

  it("names the creating Claude Code session's inbox so its feedback goes there", async () => {
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'session-b');
    vi.stubEnv('CLAUDE_CODE_MESSAGING_SOCKET', '/run/user/1000/cc-socks/7.sock');
    vi.stubEnv('CLAUDE_CODE_MESSAGING_TOKEN', 'tok');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ updated: true })));
    await run('create', 'task-b', '--port', '4983');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { inbox: unknown };
    expect(body.inbox).toEqual({
      sessionId: 'session-b',
      socket: '/run/user/1000/cc-socks/7.sock',
      token: 'tok',
    });
  });

  it.each(['create', 'update'])('uses a selected interface for review %s', async (action) => {
    fetchMock.mockResolvedValue(new Response('{}'));
    await run(
      action,
      'task',
      '--host',
      '10.1.1.24',
      '--port',
      '4983',
      ...(action === 'update' ? ['--expected-version', '3'] : []),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `http://10.1.1.24:4983/api/reviews${action === 'update' ? '/task/capture' : ''}`,
    );
  });

  it('renames a named review on a running server without capturing', async () => {
    const result = { reviewId: 'id', name: 'better', version: 2 };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(result)));
    await run('rename', 'task', 'better', '--host', '10.1.1.24', '--port', '4983');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://10.1.1.24:4983/api/reviews/task/rename',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'better' }),
      }),
    );
    expect(captureWorkingTree).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify(result));
    expect(error).not.toHaveBeenCalled();
  });

  it('deletes a named review on a running server', async () => {
    const result = { reviewId: 'id', name: 'task', deleted: true };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(result)));
    await run('delete', 'task', '--port', '4983');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://localhost:4983/api/reviews/task',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify(result));
  });

  it.each([
    ['rename', 'task', 'bad name'],
    ['rename', 'bad name', 'task'],
    ['delete', 'bad name'],
  ])('rejects an invalid name for review %s before contacting the server', async (...args) => {
    await run(...args, '--port', '4983');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Review name'));
    expect(process.exitCode).toBe(1);
  });

  it('reports a taken name from rename with the server message', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Review "better" already exists' }), { status: 409 }),
    );
    await run('rename', 'task', 'better', '--port', '4983');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Error: Review "better" already exists'),
    );
    // An earlier server's saved review also takes a name, and GET /api/reviews cannot show it.
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining('/api/reviews'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Choose another name'));
    expect(log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('updates the native uncommitted capture at the expected version', async () => {
    const result = { name: 'task', version: 4, patchDigest: capture.patchDigest, updated: true };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(result)));
    await run(
      'update',
      'task',
      '--port',
      '4983',
      '--expected-version',
      '3',
      '--pathspec',
      'src',
      '--include-untracked',
    );
    expect(captureWorkingTree).toHaveBeenCalledWith({
      cwd: undefined,
      pathspecs: ['src'],
      includeUntracked: true,
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://localhost:4983/api/reviews/task/capture',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 3, capture }),
      }),
    );
    expect(readStdin).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(JSON.stringify(result));
  });

  it.each(['create', 'update'])(
    'uses explicit stdin and repeatable selectors for %s',
    async (action) => {
      vi.mocked(detectStdinSource).mockReturnValue('pipe');
      await run(
        action,
        'task',
        '-',
        '--port',
        '4983',
        ...(action === 'update' ? ['--expected-version', '1'] : []),
        '--select',
        'file-one',
        '--select',
        'hunk-one',
      );
      expect(readStdin).toHaveBeenCalledExactlyOnceWith({ strictUtf8: true });
      expect(selectCapture).toHaveBeenCalledWith(capture, ['file-one', 'hunk-one']);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(
            action === 'update'
              ? { expectedVersion: 1, capture: selectedCapture }
              : { name: 'task', capture: selectedCapture, inbox: null },
          ),
        }),
      );
      expect(captureWorkingTree).not.toHaveBeenCalled();
    },
  );

  it.each(['create', 'update'])(
    'loads a saved capture for %s without reading stdin or the working tree',
    async (action) => {
      vi.mocked(detectStdinSource).mockReturnValue('pipe');
      const file = join(directory, 'capture.json');
      await writeFile(file, JSON.stringify(capture));
      await run(
        action,
        'task',
        '--port',
        '4983',
        ...(action === 'update' ? ['--expected-version', '1'] : []),
        '--capture',
        file,
        '--select',
        'hunk-one',
      );
      expect(validateCapture).toHaveBeenCalledWith(capture);
      expect(selectCapture).toHaveBeenCalledWith(capture, ['hunk-one']);
      expect(readStdin).not.toHaveBeenCalled();
      expect(captureWorkingTree).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    },
  );

  it.each([
    { args: ['-', '--capture', '/missing.json'] },
    { args: ['-', '--pathspec', 'src'] },
    { args: ['-', '--include-untracked'] },
    { args: ['--capture', '/missing.json', '--pathspec', 'src'] },
    { args: ['--capture', '/missing.json', '--include-untracked'] },
    { args: ['patch.diff'] },
  ])(
    'rejects command source conflicts %j before reading stdin or contacting the server',
    async ({ args }) => {
      await run('update', 'task', '--port', '4983', '--expected-version', '1', ...args);
      expect(readStdin).not.toHaveBeenCalled();
      expect(captureWorkingTree).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(/patch source|only apply|Patch source/),
      );
      expect(process.exitCode).toBe(1);
    },
  );

  it.each([
    { action: 'create', source: 'pipe' },
    { action: 'create', source: 'file' },
    { action: 'create', source: 'socket' },
    { action: 'update', source: 'pipe' },
    { action: 'update', source: 'file' },
    { action: 'update', source: 'socket' },
  ] as const)(
    'rejects $action with $source stdin and no patch source before capturing or contacting the server',
    async ({ action, source }) => {
      vi.mocked(detectStdinSource).mockReturnValue(source);
      await run(
        action,
        'task',
        '--port',
        '4983',
        ...(action === 'update' ? ['--expected-version', '1'] : []),
      );
      expect(readStdin).not.toHaveBeenCalled();
      expect(captureWorkingTree).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(expect.stringMatching(/add -.*\/dev\/null/i));
      expect(process.exitCode).toBe(1);
    },
  );

  it.each([['--pathspec', 'src'], ['--include-untracked']])(
    'treats %s as an intentional native capture despite piped stdin',
    async (...flags) => {
      vi.mocked(detectStdinSource).mockReturnValue('pipe');
      await run('create', 'task', '--port', '4983', ...flags);
      expect(captureWorkingTree).toHaveBeenCalledOnce();
      expect(readStdin).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    },
  );

  it('rejects interactive stdin before waiting for input', async () => {
    await run('update', 'task', '-', '--port', '4983', '--expected-version', '1');
    expect(readStdin).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'Error: Provide a unified diff via stdin for patch source -',
    );
    expect(process.exitCode).toBe(1);
  });

  it('reports malformed capture JSON before contacting the server', async () => {
    const file = join(directory, 'capture.json');
    await writeFile(file, '{');
    await run('update', 'task', '--capture', file, '--port', '4983', '--expected-version', '1');
    expect(error).toHaveBeenCalledWith(`Error: Invalid capture JSON in ${file}`);
    expect(validateCapture).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('reports invalid artifact data and unknown capture IDs before sending an update', async () => {
    const file = join(directory, 'capture.json');
    await writeFile(file, '{}');
    vi.mocked(validateCapture).mockImplementation(() => {
      throw new Error('Capture digest does not match its patch');
    });
    await run('update', 'task', '--capture', file, '--port', '4983', '--expected-version', '1');
    expect(error).toHaveBeenCalledWith('Error: Capture digest does not match its patch');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.mocked(selectCapture).mockImplementation(() => {
      throw new Error('Unknown capture selection ID: missing');
    });
    await run('update', 'task', '--select', 'missing', '--port', '4983', '--expected-version', '1');
    expect(error).toHaveBeenCalledWith('Error: Unknown capture selection ID: missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['create', 'update'])(
    'reports the server response on a %s conflict without terminating buffered output',
    async (action) => {
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Unexpected process.exit');
      });
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            error:
              action === 'create' ? 'Review "task" already exists' : 'Capture version conflict',
            ...(action === 'update'
              ? { current: { name: 'task', version: 7, patchDigest: capture.patchDigest } }
              : {}),
          }),
          { status: 409 },
        ),
      );
      await run(
        action,
        'task',
        '--port',
        '4983',
        ...(action === 'update' ? ['--expected-version', '1'] : []),
      );
      expect(error).toHaveBeenCalledWith(
        action === 'create'
          ? 'Error: Review "task" already exists. Read /api/reviews/task before retrying'
          : `Error: Capture version conflict; current version 7, digest ${capture.patchDigest}. Read /api/reviews/task before retrying`,
      );
      expect(process.exitCode).toBe(1);
      expect(log).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      status: 404,
      body: JSON.stringify({ error: 'Named review not found' }),
      expected: 'Named review not found',
    },
    { status: 500, body: 'Not JSON', expected: 'Named review request failed (500)' },
  ])('reports HTTP $status errors', async ({ status, body, expected }) => {
    fetchMock.mockResolvedValue(new Response(body, { status }));
    await run('update', 'task', '--port', '4983', '--expected-version', '1');
    expect(error).toHaveBeenCalledWith(`Error: ${expected}`);
    expect(log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it.each(['create', 'update'])(
    'rejects an oversized serialized %s request before fetch',
    async (action) => {
      vi.mocked(captureWorkingTree).mockResolvedValue({
        ...capture,
        patch: '\u0001'.repeat(3 * 1024 * 1024),
      });
      await run(
        action,
        'task',
        '--port',
        '4983',
        ...(action === 'update' ? ['--expected-version', '1'] : []),
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('16 MiB serialized JSON limit'));
      expect(log).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    },
  );

  it('rejects a malformed success response instead of printing null', async () => {
    fetchMock.mockResolvedValue(new Response('Not JSON'));
    await run('update', 'task', '--port', '4983', '--expected-version', '1');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Error:'));
    expect(log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('reports the port of an unreachable server', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await run('update', 'task', '--port', '4983', '--expected-version', '1');
    expect(error).toHaveBeenCalledWith(
      'Error: Cannot connect to gavel server at http://localhost:4983/. Check --host and --port.',
    );
    expect(process.exitCode).toBe(1);
  });

  it.each(['create', 'update'])('requires valid port integers for %s', async (action) => {
    for (const port of [
      '0',
      '65536',
      '1.5',
      '4983suffix',
      '1e3',
      '9007199254740992',
      ' 4983',
      '4983\n',
      '4983\r',
    ]) {
      await expect(
        run(
          action,
          'task',
          '--port',
          port,
          ...(action === 'update' ? ['--expected-version', '1'] : []),
        ),
      ).rejects.toThrow('Expected an integer from 1 to 65535');
    }
    expect(captureWorkingTree).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a positive safe integer expected version', async () => {
    for (const version of [
      '0',
      '-1',
      '1.5',
      '1suffix',
      '1e3',
      '9007199254740992',
      ' 1',
      '1\n',
      '1\r',
    ]) {
      await expect(
        run('update', 'task', '--port', '4983', `--expected-version=${version}`),
      ).rejects.toThrow(`Expected an integer from 1 to ${Number.MAX_SAFE_INTEGER}`);
    }
    expect(captureWorkingTree).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires an expected version only for update', async () => {
    await expect(run('update', 'task', '--port', '4983')).rejects.toThrow(
      "required option '--expected-version <integer>' not specified",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await run('create', 'task', '--port', '4983');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('review unapply and reapply', () => {
  const log = vi.fn();
  const error = vi.fn();
  const result = (fields: Partial<RevertResult> = {}): RevertResult => ({
    direction: 'unapply',
    label: 'task',
    patchDigest: capture.patchDigest,
    baseCommit: capture.baseCommit,
    dryRun: false,
    written: true,
    stat: ' file.ts | 2 +-\n',
    ...fields,
  });

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(log);
    vi.spyOn(console, 'error').mockImplementation(error);
    vi.mocked(findSavedCapture).mockResolvedValue(capture);
    vi.mocked(revertCapture).mockResolvedValue(result());
    vi.mocked(getCaptureRepository).mockResolvedValue({
      repositoryRoot: capture.repositoryRoot,
      repositoryId: capture.repositoryId,
      baseCommit: capture.baseCommit,
    });
    vi.mocked(capturePatch).mockReturnValue(selectedCapture);
    vi.mocked(detectStdinSource).mockReturnValue('pipe');
    vi.mocked(readStdin).mockResolvedValue(capture.patch);
  });

  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it.each(['unapply', 'reapply'] as const)(
    '%s reads the saved capture by name and prints the result',
    async (direction) => {
      vi.mocked(detectStdinSource).mockReturnValue('tty');
      await run(direction, 'task', '--dry-run');
      expect(findSavedCapture).toHaveBeenCalledWith(process.cwd(), 'task', undefined);
      expect(revertCapture).toHaveBeenCalledWith(capture, {
        cwd: process.cwd(),
        direction,
        label: 'task',
        dryRun: true,
      });
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ written: true });
      expect(process.exitCode).toBe(0);
    },
  );

  it('passes --patch-digest through to the saved-review lookup', async () => {
    vi.mocked(detectStdinSource).mockReturnValue('tty');
    await run('unapply', 'task', '--patch-digest', capture.patchDigest);
    expect(findSavedCapture).toHaveBeenCalledWith(process.cwd(), 'task', capture.patchDigest);
  });

  it.each([
    ['piped stdin without -', [], 'pipe', 'Stdin is a pipe or file'],
    ['- with a terminal for stdin', ['-'], 'tty', 'Provide a unified diff via stdin'],
    ['a patch source other than -', ['patch.diff'], 'tty', 'Patch source must be -'],
  ] as const)('refuses %s', async (_case, extra, stdin, message) => {
    vi.mocked(detectStdinSource).mockReturnValue(stdin);
    await run('unapply', 'task', ...extra);
    expect(revertCapture).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(process.exitCode).toBe(1);
  });

  it('uses a patch from stdin with -', async () => {
    await run('unapply', 'task', '-');
    expect(findSavedCapture).not.toHaveBeenCalled();
    expect(capturePatch).toHaveBeenCalledWith(capture.patch, expect.anything());
    expect(revertCapture).toHaveBeenCalledWith(selectedCapture, expect.anything());
  });

  it('refuses a piped patch whose digest differs from --patch-digest', async () => {
    await run('unapply', 'task', '-', '--patch-digest', 'f'.repeat(64));
    expect(revertCapture).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('does not match --patch-digest'));
  });

  it.each([
    ['paths are staged', { written: false, refused: 'Unstage these paths first:\nfile.ts' }],
    ['git apply left hunks in place', { rejected: 'error: patch failed: file.ts:1' }],
  ])('exits 1 when %s, after printing the result', async (_case, fields) => {
    vi.mocked(revertCapture).mockResolvedValue(result(fields));
    vi.mocked(detectStdinSource).mockReturnValue('tty');
    await run('unapply', 'task');
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject(fields);
    expect(process.exitCode).toBe(1);
  });

  it('rejects an invalid name before reading anything', async () => {
    await run('unapply', 'a/b');
    expect(findSavedCapture).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Review name'));
    expect(process.exitCode).toBe(1);
  });
});
