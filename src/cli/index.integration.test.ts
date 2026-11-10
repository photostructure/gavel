import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { closeSync, openSync, watch } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { devNull, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fetch } from 'undici';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServerEvent } from '../types/events.js';
import type { DiffResponse, RevisionsResponse } from '../types/diff.js';
import type { BackgroundServerInfo } from './background.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let directory: string;
let entrypoint: string;
let revisions: string[];

function withoutGitEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
  );
}

async function sources(directoryName: string): Promise<string[]> {
  const source = join(repository, 'src', directoryName);
  const files: string[] = [];
  for (const item of await readdir(source, { withFileTypes: true })) {
    if (item.isDirectory()) {
      files.push(...(await sources(join(directoryName, item.name))));
    } else if (
      item.name.endsWith('.ts') &&
      !item.name.endsWith('.test.ts') &&
      !item.name.endsWith('.d.ts')
    ) {
      files.push(join(source, item.name));
    }
  }
  return files;
}

// TypeScript 7 removed ts.transpileModule and its API cannot emit, so transpile with its tsc.
function compile(files: string[]): void {
  const tsc = join(
    dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
    'bin/tsc',
  );
  execFileSync(process.execPath, [
    tsc,
    '--ignoreConfig',
    '--noCheck',
    '--target',
    'es2022',
    '--module',
    'esnext',
    '--rootDir',
    join(repository, 'src'),
    '--outDir',
    join(directory, 'dist'),
    ...files,
  ]);
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gavel-cli-protocol-'));
  await symlink(join(repository, 'node_modules'), join(directory, 'node_modules'), 'junction');
  await writeFile(
    join(directory, 'package.json'),
    await readFile(join(repository, 'package.json')),
  );
  const files: string[] = [];
  for (const folder of ['cli', 'server', 'types', 'utils']) files.push(...(await sources(folder)));
  compile(files);
  entrypoint = join(directory, 'dist/cli/index.js');
  // Hook Git variables must not redirect fixture setup into the caller's repository.
  const fixtureEnvironment = {
    ...withoutGitEnvironment(process.env),
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_SYSTEM: devNull,
  };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: directory, env: fixtureEnvironment, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'CLI protocol fixture');
  git('config', 'user.email', 'cli@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  for (let index = 0; index < 3; index += 1) {
    await writeFile(join(directory, 'fixture.txt'), `revision ${index}\n`);
    git('add', 'fixture.txt');
    git('-c', `core.hooksPath=${devNull}`, 'commit', '-qm', `fixture ${index}`);
  }
  revisions = [git('rev-parse', 'HEAD~1'), git('rev-parse', 'HEAD~2')];
}, 30000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function launch(
  args: string[],
  readySignal?: 'SIGINT' | 'SIGTERM' | 'SIGHUP',
  environment: Record<string, string> = {},
  input?: string,
) {
  const child = spawn(process.execPath, [entrypoint, ...args], {
    cwd: directory,
    env: {
      ...withoutGitEnvironment(process.env),
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_SYSTEM: devNull,
      ...environment,
    },
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  let signalled = false;
  child.stdout!.on('data', (chunk: string) => {
    stdout += chunk;
    // Signal from the complete readiness record, without a polling or timer grace period.
    if (
      readySignal &&
      !signalled &&
      stdout
        .split('\n')
        .slice(0, -1)
        .some((line) => line.includes('"type":"server.ready"'))
    ) {
      signalled = true;
      child.kill(readySignal);
    }
  });
  child.stderr!.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const closed = new Promise<number | null>((resolveClose, reject) => {
    child.once('error', reject);
    child.once('close', resolveClose);
  });
  if (input !== undefined) child.stdin!.end(input);
  return { child, closed, output: () => ({ stdout, stderr }) };
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGKILL');
  await new Promise<void>((resolveClose) => child.once('close', () => resolveClose()));
}

// These run the compiled CLI because the decision depends on what fstat reports for the real fd 0.
describe('named review stdin sources', () => {
  const pipedPatch =
    'diff --git a/tracked.txt b/tracked.txt\n--- a/tracked.txt\n+++ b/tracked.txt\n@@ -1 +1 @@\n-committed\n+piped\n';
  const ambiguous = /add -.*\/dev\/null/i;
  const requests: string[] = [];
  let cwd: string;
  let patchFile: string;
  let emptyFile: string;
  let server: Server;
  let port: number;

  const environment = () => ({
    ...withoutGitEnvironment(process.env),
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_SYSTEM: devNull,
  });

  beforeAll(async () => {
    cwd = join(directory, 'stdin-sources');
    await mkdir(cwd);
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd, env: environment(), encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.name', 'CLI stdin fixture');
    git('config', 'user.email', 'cli@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    await writeFile(join(cwd, 'tracked.txt'), 'committed\n');
    git('add', 'tracked.txt');
    git('-c', `core.hooksPath=${devNull}`, 'commit', '-qm', 'fixture');
    await writeFile(join(cwd, 'tracked.txt'), 'uncommitted\n');
    patchFile = join(directory, 'stdin-sources.patch');
    emptyFile = join(directory, 'stdin-sources-empty.patch');
    await writeFile(patchFile, pipedPatch);
    await writeFile(emptyFile, '');
    server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        requests.push(body);
        response.setHeader('Content-Type', 'application/json');
        response.end('{}');
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolveClose) => server.close(resolveClose));
  });

  beforeEach(() => {
    requests.length = 0;
  });

  const reviewArgs = (action: string, ...extra: string[]) => [
    'review',
    action,
    'task',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    ...(action === 'update' ? ['--expected-version', '1'] : []),
    ...extra,
  ];

  function finished(child: ChildProcess): Promise<{ code: number | null; stderr: string }> {
    let stderr = '';
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      stderr += chunk;
    });
    return new Promise((resolveClose, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolveClose({ code, stderr }));
    });
  }

  function runWithStdin(stdin: 'ignore' | 'pipe' | number, args: string[]) {
    const child = spawn(process.execPath, [entrypoint, ...args], {
      cwd,
      env: environment(),
      stdio: [stdin, 'ignore', 'pipe'],
    });
    return { child, result: finished(child) };
  }

  function runWithFile(file: string, args: string[]) {
    const descriptor = openSync(file, 'r');
    try {
      return runWithStdin(descriptor, args).result;
    } finally {
      closeSync(descriptor);
    }
  }

  // A shell pipeline is the only way to give the child a real FIFO on fd 0: Node's own stdio
  // pipes are sockets on POSIX.
  function runInPipeline(output: string, args: string[]) {
    const child = spawn(
      '/bin/sh',
      ['-c', 'printf %s "$OUTPUT" | "$NODE" "$ENTRY" "$@"', 'sh', ...args],
      {
        cwd,
        env: { ...environment(), OUTPUT: output, NODE: process.execPath, ENTRY: entrypoint },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    return finished(child);
  }

  const capturedPatch = () => {
    expect(requests).toHaveLength(1);
    return (JSON.parse(requests[0]!) as { capture: { patch: string } }).capture.patch;
  };

  describe.each(['create', 'update'])('review %s', (action) => {
    it.skipIf(process.platform === 'win32').each([
      { label: 'a piped patch', output: pipedPatch },
      { label: 'an empty pipe', output: '' },
    ])(
      'rejects $label without the - marker',
      async ({ output }) => {
        const { code, stderr } = await runInPipeline(output, reviewArgs(action));
        expect(code, stderr).toBe(1);
        expect(stderr).toMatch(ambiguous);
        expect(requests).toEqual([]);
      },
      15000,
    );

    it.each([
      { label: 'a redirected patch', file: () => patchFile },
      { label: 'a redirected empty file', file: () => emptyFile },
    ])(
      'rejects $label without the - marker',
      async ({ file }) => {
        const { code, stderr } = await runWithFile(file(), reviewArgs(action));
        expect(code, stderr).toBe(1);
        expect(stderr).toMatch(ambiguous);
        expect(requests).toEqual([]);
      },
      15000,
    );

    it('rejects a stdin pipe that never closes instead of waiting on it', async () => {
      const { child, result } = runWithStdin('pipe', reviewArgs(action));
      const { code, stderr } = await result;
      child.stdin!.destroy();
      expect(code, stderr).toBe(1);
      expect(stderr).toMatch(ambiguous);
      expect(requests).toEqual([]);
    }, 15000);

    it.skipIf(process.platform === 'win32')(
      'reads a piped patch with the - marker',
      async () => {
        const { code, stderr } = await runInPipeline(pipedPatch, reviewArgs(action, '-'));
        expect(code, stderr).toBe(0);
        expect(capturedPatch()).toContain('+piped');
      },
      15000,
    );

    it('captures the uncommitted tree when stdin is the null device', async () => {
      const { code, stderr } = await runWithStdin('ignore', reviewArgs(action)).result;
      expect(code, stderr).toBe(0);
      expect(capturedPatch()).toContain('+uncommitted');
    }, 15000);

    it.skipIf(process.platform === 'win32').each([
      { label: '--pathspec', flags: ['--pathspec', 'tracked.txt'] },
      { label: '--include-untracked', flags: ['--include-untracked'] },
    ])(
      'captures the uncommitted tree with $label despite a pipe',
      async ({ flags }) => {
        const { code, stderr } = await runInPipeline(pipedPatch, reviewArgs(action, ...flags));
        expect(code, stderr).toBe(0);
        expect(capturedPatch()).toContain('+uncommitted');
      },
      15000,
    );
  });
});

describe('actual CLI launch protocol', () => {
  it.each([
    { label: 'explicit stdin', args: ['-'] },
    { label: 'automatically detected stdin', args: [] },
  ])(
    'preserves $label when launching in the background',
    async ({ args }) => {
      const patch = [
        'diff --git a/background.txt b/background.txt',
        '--- a/background.txt',
        '+++ b/background.txt',
        '@@ -1 +1 @@',
        '-before',
        '+background café',
        '',
      ].join('\n');
      const fixture = launch(
        [...args, '--background', '--host', '127.0.0.1', '--port', '0', '--no-open'],
        undefined,
        {},
        patch,
      );
      let background: BackgroundServerInfo | undefined;
      try {
        const exitCode = await fixture.closed;
        const output = fixture.output().stdout.trim();
        if (output) background = JSON.parse(output) as BackgroundServerInfo;
        expect(exitCode, fixture.output().stderr).toBe(0);
        expect(background).toMatchObject({
          type: 'server.background',
          port: expect.any(Number),
          pid: expect.any(Number),
        });
        const response = await fetch(new URL('/api/diff', background!.url));
        const diff = (await response.json()) as DiffResponse;
        expect(response.ok).toBe(true);
        expect(diff.reviewContext?.source).toBe('stdin');
        expect(diff.files).toHaveLength(1);
        expect(diff.files[0]?.path).toBe('background.txt');
        expect(diff.files[0]?.chunks[0]?.lines).toContainEqual(
          expect.objectContaining({ type: 'add', content: 'background café' }),
        );
      } finally {
        if (background) process.kill(background.pid, 'SIGKILL');
        await stop(fixture.child);
      }
    },
    15000,
  );

  const allAgentFlags = [
    '--agent',
    'Codex desktop',
    '--agent-session-name',
    'Add agent session to About',
    '--agent-session-id',
    'session-1234',
  ];
  const claudeEnvironment = {
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_SESSION_ID: 'environment-session',
  };
  it.each([
    {
      label: 'a commit review',
      args: ['HEAD', ...allAgentFlags],
      environment: claudeEnvironment,
      expected: {
        agent: 'Codex desktop',
        agentSessionName: 'Add agent session to About',
        agentSessionId: 'session-1234',
      },
    },
    {
      label: 'a named review',
      args: ['--review', 'agent-task', ...allAgentFlags],
      environment: claudeEnvironment,
      expected: {
        agent: 'Codex desktop',
        agentSessionName: 'Add agent session to About',
        agentSessionId: 'session-1234',
      },
    },
    {
      label: 'an environment default with an --agent override',
      args: ['HEAD', '--agent', 'Codex desktop'],
      environment: claudeEnvironment,
      expected: { agent: 'Codex desktop', agentSessionId: 'environment-session' },
    },
    {
      label: 'environment defaults alone',
      args: ['HEAD'],
      environment: claudeEnvironment,
      expected: { agent: 'Claude Code terminal', agentSessionId: 'environment-session' },
    },
  ])(
    'reports the launching agent session for $label',
    async ({ args, environment, expected }) => {
      const fixture = launch(
        [...args, '--background', '--host', '127.0.0.1', '--port', '0', '--no-open'],
        undefined,
        environment,
      );
      let background: BackgroundServerInfo | undefined;
      try {
        const exitCode = await fixture.closed;
        const output = fixture.output().stdout.trim();
        if (output) background = JSON.parse(output) as BackgroundServerInfo;
        expect(exitCode, fixture.output().stderr).toBe(0);
        const response = await fetch(new URL('/api/diff', background!.url));
        const diff = (await response.json()) as DiffResponse;
        expect(diff.reviewContext).toMatchObject(expected);
      } finally {
        if (background) process.kill(background.pid, 'SIGKILL');
        await stop(fixture.child);
      }
    },
    15000,
  );

  it('reports an explicit commit-ish as the launched diff', async () => {
    const fixture = launch(['HEAD~1', '--background', '--host', '127.0.0.1', '--port', '0']);
    let background: BackgroundServerInfo | undefined;
    try {
      const exitCode = await fixture.closed;
      const output = fixture.output().stdout.trim();
      if (output) background = JSON.parse(output) as BackgroundServerInfo;
      expect(exitCode, fixture.output().stderr).toBe(0);
      const response = await fetch(new URL('/api/revisions', background!.url));
      const revisionOptions = (await response.json()) as RevisionsResponse;
      // The launch names the commits HEAD~1^ and HEAD~1 resolved to, so a later HEAD
      // does not move it.
      const { baseCommitish, targetCommitish } = revisionOptions.launch!;
      expect(targetCommitish).toMatch(/^[0-9a-f]{7,40}$/);
      expect(baseCommitish).toMatch(/^[0-9a-f]{7,40}$/);
      expect(revisions[0]!.startsWith(targetCommitish)).toBe(true);
      expect(revisions[1]!.startsWith(baseCommitish)).toBe(true);
    } finally {
      if (background) process.kill(background.pid, 'SIGKILL');
      await stop(fixture.child);
    }
  }, 15000);

  it('rejects an explicitly empty named review instead of opening an ordinary comparison', async () => {
    // Ground truth: the documented 1–80 character name contract requires rejection of
    // node <compiled-cli> --review '' --host 127.0.0.1 --port 0 --no-open --keep-alive.
    const fixture = launch(
      ['--review', '', '--host', '127.0.0.1', '--port', '0', '--no-open', '--keep-alive'],
      'SIGTERM',
    );
    try {
      expect(await fixture.closed).toBe(1);
      expect(fixture.output().stdout).toBe('');
      expect(fixture.output().stderr).toContain('Review name must be 1–80');
    } finally {
      await stop(fixture.child);
    }
  }, 15000);

  it.each([
    {
      label: 'a pathspec without a review',
      args: ['--pathspec', 'fixture.txt'],
      error: 'require --review',
    },
    {
      label: 'an empty capture without a review',
      args: ['--capture', ''],
      error: 'require --review',
    },
    {
      label: 'a selector without a review',
      args: ['--select', 'file-id'],
      error: 'require --review',
    },
    {
      label: 'a named review with a revision argument',
      args: ['--review', 'task', 'HEAD'],
      error: 'Git revision arguments are not supported',
    },
    {
      label: 'background stdin for a named review',
      args: ['-', '--review', 'task', '--background'],
      error: 'A background review cannot read stdin',
    },
  ])(
    'rejects $label before starting a server',
    async ({ args, error }) => {
      // Ground truth: each command is forbidden by gavel --help's named capture contract.
      const fixture = launch(
        [...args, '--host', '127.0.0.1', '--port', '0', '--no-open', '--keep-alive'],
        'SIGTERM',
      );
      try {
        expect(await fixture.closed).toBe(1);
        expect(fixture.output().stdout).toBe('');
        expect(fixture.output().stderr).toContain(error);
      } finally {
        await stop(fixture.child);
      }
    },
    15000,
  );

  it('rejects named reviews with explicitly disabled conversation mode', async () => {
    // Ground truth: node <compiled-cli> --review task --no-conversation --no-jsonl must not expose conversation APIs.
    const fixture = launch([
      '--review',
      'task',
      '--no-conversation',
      '--no-jsonl',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-open',
      '--keep-alive',
    ]);
    let requestedShutdown = false;
    fixture.child.stderr!.on('data', () => {
      // Let the unfixed human-output server stop so this rejection regression cannot leak it.
      if (!requestedShutdown && fixture.output().stderr.includes('gavel server started on')) {
        requestedShutdown = true;
        fixture.child.kill('SIGTERM');
      }
    });
    try {
      expect(await fixture.closed).toBe(1);
      expect(fixture.output().stdout).toBe('');
      expect(fixture.output().stderr).toContain('Named reviews require conversation mode');
      expect(fixture.output().stderr).not.toContain('gavel server started on');
    } finally {
      await stop(fixture.child);
    }
  }, 15000);

  it('warns when a named capture has no differences while keeping the task available', async () => {
    // Ground truth: named empty captures share the ordinary CLI's nonfatal no-differences notice.
    const fixture = launch(
      [
        '--review',
        'empty-task',
        '--pathspec',
        'missing-file',
        '--host',
        '127.0.0.1',
        '--port',
        '0',
        '--no-open',
        '--keep-alive',
      ],
      'SIGTERM',
    );
    try {
      expect(await fixture.closed).toBe(0);
      expect(fixture.output().stdout).toContain('"type":"server.ready"');
      expect(fixture.output().stdout).toContain('"name":"empty-task"');
      expect(fixture.output().stderr).toContain(
        'No differences found. Browser will not open automatically.',
      );
    } finally {
      await stop(fixture.child);
    }
  }, 15000);

  it('starts a native named review from a subdirectory while stdin stays an open pipe', async () => {
    // Ground truth: node <compiled-cli> --review pipe-task --pathspec fixture.txt starts without consuming stdin unless - is explicit.
    const nested = join(directory, 'named-pipe-nested');
    await mkdir(nested, { recursive: true });
    const child = spawn(
      process.execPath,
      [
        entrypoint,
        '--review',
        'pipe-task',
        '--pathspec',
        'fixture.txt',
        '--host',
        '127.0.0.1',
        '--port',
        '0',
        '--no-open',
        '--keep-alive',
      ],
      {
        cwd: nested,
        env: {
          ...withoutGitEnvironment(process.env),
          GIT_CONFIG_GLOBAL: devNull,
          GIT_CONFIG_SYSTEM: devNull,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '';
    let stderr = '';
    let deadline: ReturnType<typeof setTimeout> | undefined;
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    try {
      const ready = await new Promise<Extract<ServerEvent, { type: 'server.ready' }>>(
        (resolveReady, rejectReady) => {
          deadline = setTimeout(
            () => rejectReady(new Error('Named review waited for stdin instead of starting')),
            10000,
          );
          child.once('error', rejectReady);
          child.once('close', (code) =>
            rejectReady(new Error(`CLI exited before readiness (${code}): ${stderr}`)),
          );
          child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
            const line = stdout
              .split('\n')
              .slice(0, -1)
              .find((entry) => entry.includes('"type":"server.ready"'));
            if (line)
              resolveReady(JSON.parse(line) as Extract<ServerEvent, { type: 'server.ready' }>);
          });
        },
      );
      expect(ready.selection.reviewName).toBe('pipe-task');
      expect(ready.capture?.name).toBe('pipe-task');
      expect(ready.reviewContext.repositoryPath).toBe(await realpath(directory));
      expect(child.stdin.destroyed).toBe(false);
    } finally {
      if (deadline) clearTimeout(deadline);
      await stop(child);
    }
  }, 15000);

  it.each([
    {
      label: 'root named launch',
      args: [
        '-',
        '--review',
        'raw-task',
        '--host',
        '127.0.0.1',
        '--port',
        '0',
        '--no-open',
        '--keep-alive',
      ],
    },
    { label: 'named create', args: ['review', 'create', 'raw-task', '-', '--port', '1'] },
    {
      label: 'named update',
      args: ['review', 'update', 'raw-task', '-', '--port', '1', '--expected-version', '1'],
    },
  ])(
    'rejects non-UTF-8 patch bytes before $label can publish a capture',
    async ({ args }) => {
      // Ground truth: the immutable capture must preserve supplied bytes; Latin-1 0xE9 is not UTF-8.
      const patch = Buffer.concat([
        Buffer.from(
          'diff --git a/fixture.txt b/fixture.txt\n--- a/fixture.txt\n+++ b/fixture.txt\n@@ -1 +1 @@\n-before\n+caf',
        ),
        Buffer.from([0xe9]),
        Buffer.from('\n'),
      ]);
      const child = spawn(process.execPath, [entrypoint, ...args], {
        cwd: directory,
        env: {
          ...withoutGitEnvironment(process.env),
          GIT_CONFIG_GLOBAL: devNull,
          GIT_CONFIG_SYSTEM: devNull,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      let stdout = '';
      let stderr = '';
      let signalled = false;
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (!signalled && stdout.includes('"type":"server.ready"')) {
          signalled = true;
          child.kill('SIGTERM');
        }
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      const closed = new Promise<number | null>((resolveClose, rejectClose) => {
        child.once('error', rejectClose);
        child.once('close', resolveClose);
      });
      child.stdin.end(patch);
      try {
        expect(await closed).toBe(1);
        expect(stdout).toBe('');
        expect(stderr).toContain('valid UTF-8');
      } finally {
        await stop(child);
      }
    },
    15000,
  );

  it.each(['create', 'update'])(
    'reports the serialized transport budget before %s contacts the server',
    async (action) => {
      const patch =
        '--- a/fixture.txt\n+++ b/fixture.txt\n@@ -1 +1 @@\n-before\n+' +
        '\u0001'.repeat(3 * 1024 * 1024) +
        '\n';
      const child = spawn(
        process.execPath,
        [
          entrypoint,
          'review',
          action,
          'large-task',
          '-',
          '--port',
          '1',
          ...(action === 'update' ? ['--expected-version', '1'] : []),
        ],
        {
          cwd: directory,
          env: {
            ...withoutGitEnvironment(process.env),
            GIT_CONFIG_GLOBAL: devNull,
            GIT_CONFIG_SYSTEM: devNull,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      const closed = new Promise<number | null>((resolveClose, rejectClose) => {
        child.once('error', rejectClose);
        child.once('close', resolveClose);
      });
      child.stdin.end(patch);
      try {
        expect(await closed).toBe(1);
        expect(stdout).toBe('');
        expect(stderr).toContain('16 MiB serialized JSON limit');
        expect(stderr).not.toContain('Cannot connect');
      } finally {
        await stop(child);
      }
    },
    15000,
  );

  // Ground truth: node <compiled-cli> <target-sha> <base-sha> --host 127.0.0.1 --port 0 --no-open --keep-alive.
  // Windows process.kill does not deliver these catchable POSIX signals; rejection coverage still runs there.
  it.skipIf(process.platform === 'win32').each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)(
    'keeps immutable-comparison stdout JSONL through %s',
    async (signal) => {
      const fixture = launch(
        [...revisions, '--host', '127.0.0.1', '--port', '0', '--no-open', '--keep-alive'],
        signal,
      );
      try {
        expect(await fixture.closed).toBe(0);
        const events = fixture
          .output()
          .stdout.trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { type: string; reason?: string; port?: number });
        expect(events[0]).toMatchObject({ type: 'server.ready', port: expect.any(Number) });
        expect(events[0]!.port).toBeGreaterThan(0);
        expect(events.at(-1)).toMatchObject({ type: 'server.shutdown', reason: signal });
        expect(events.filter((event) => event.type === 'server.shutdown')).toHaveLength(1);
        expect(fixture.output().stderr).toContain('File watching disabled');
      } finally {
        await stop(fixture.child);
      }
    },
    15000,
  );

  // Linux routes 127/8 to loopback; the second address catches localhost-only shutdown fetches.
  it
    .skipIf(process.platform === 'win32')
    .each(process.platform === 'linux' ? ['127.0.0.1', '127.0.0.2'] : ['127.0.0.1'])(
    'flushes human-readable comments on SIGHUP from host %s',
    async (host) => {
      const fixture = launch([
        ...revisions,
        '--host',
        host,
        '--port',
        '0',
        '--no-open',
        '--keep-alive',
        '--no-jsonl',
        '--comment',
        JSON.stringify({
          type: 'thread',
          filePath: 'fixture.txt',
          position: { side: 'new', line: 1 },
          body: 'Keep this comment after a terminal hangup',
        }),
      ]);
      let signalled = false;
      fixture.child.stderr?.on('data', () => {
        if (!signalled && fixture.output().stderr.includes('gavel server started on')) {
          signalled = true;
          fixture.child.kill('SIGHUP');
        }
      });
      try {
        expect(await fixture.closed).toBe(0);
        expect(fixture.output().stdout).toContain('Keep this comment after a terminal hangup');
      } finally {
        await stop(fixture.child);
      }
    },
    15000,
  );

  it.skipIf(process.platform === 'win32').each(['SIGINT', 'SIGTERM'] as const)(
    'cancels on the first %s while Git startup is blocked',
    async (signal) => {
      const wrapperDirectory = await mkdtemp(join(directory, 'git-wrapper-'));
      const markerPath = join(wrapperDirectory, 'blocked');
      const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
      const wrapper = join(wrapperDirectory, 'git');
      await writeFile(
        wrapper,
        `#!${process.execPath}
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.argv.slice(2).includes('diff')) {
  writeFileSync(${JSON.stringify(markerPath)}, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  const result = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
`,
      );
      await chmod(wrapper, 0o755);
      let notifyBlocked!: () => void;
      const blocked = new Promise<void>((resolveBlocked) => {
        notifyBlocked = resolveBlocked;
      });
      const watcher = watch(wrapperDirectory, (_event, filename) => {
        if (filename === 'blocked') notifyBlocked();
      });
      const fixture = launch(
        [...revisions, '--host', '127.0.0.1', '--port', '0', '--keep-alive'],
        undefined,
        {
          PATH: `${wrapperDirectory}:${process.env.PATH ?? ''}`,
        },
      );
      try {
        // The Git wrapper's marker proves startup is blocked; no elapsed-time guess triggers cancellation.
        await blocked;
        fixture.child.kill(signal);
        await expect.poll(() => fixture.child.signalCode, { timeout: 1000 }).toBe(signal);
        expect(await fixture.closed).toBeNull();
        expect(fixture.output().stdout).toBe('');
        expect(fixture.output().stderr).not.toContain('gavel server started');
        expect(fixture.output().stderr).not.toContain('Opening browser');
      } finally {
        watcher.close();
        await stop(fixture.child);
        try {
          process.kill(Number(await readFile(markerPath, 'utf8')), 'SIGKILL');
        } catch {
          // The Git worker may already have exited with its parent.
        }
      }
    },
    15000,
  );

  it.skipIf(process.platform === 'win32')(
    'keeps the untracked-file prompt on stderr and stdout JSONL',
    async () => {
      const untracked = join(directory, 'prompt-untracked.txt');
      await writeFile(untracked, 'untracked prompt fixture\n');
      const child = spawn(
        process.execPath,
        [entrypoint, '.', '--host', '127.0.0.1', '--port', '0', '--no-open', '--keep-alive'],
        {
          cwd: directory,
          env: {
            ...withoutGitEnvironment(process.env),
            GIT_CONFIG_GLOBAL: devNull,
            GIT_CONFIG_SYSTEM: devNull,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      let answered = false;
      let signalled = false;
      const answerPrompt = (output: string) => {
        if (!answered && output.includes('Would you like to include')) {
          answered = true;
          child.stdin.write('n\n');
        }
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        // Also answer a misrouted prompt so that regression fails on JSON purity, not a timeout.
        answerPrompt(stdout);
        if (
          !signalled &&
          stdout
            .split('\n')
            .slice(0, -1)
            .some((line) => line.includes('"type":"server.ready"'))
        ) {
          signalled = true;
          child.kill('SIGTERM');
        }
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        answerPrompt(stderr);
      });
      const closed = new Promise<number | null>((resolveClose, reject) => {
        child.once('error', reject);
        child.once('close', resolveClose);
      });
      try {
        expect(await closed).toBe(0);
        const events = stdout
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { type: string });
        expect(stderr).toContain('Would you like to include');
        expect(events[0]?.type).toBe('server.ready');
        expect(events.at(-1)?.type).toBe('server.shutdown');
      } finally {
        child.stdin.destroy();
        await stop(child);
        await rm(untracked, { force: true });
      }
    },
    15000,
  );

  it.skipIf(process.platform === 'win32')(
    'isolates real fixture setup and CLI startup from linked-worktree hook variables',
    async () => {
      // The nested selected cases wait for real readiness and shutdown, so both setup and child Git lookup are exercised.
      const hookRoot = await mkdtemp(join(tmpdir(), 'gavel-protocol-hook-'));
      const caller = join(hookRoot, 'caller');
      const linked = join(hookRoot, 'linked');
      const environment = withoutGitEnvironment(process.env);
      let probe: ReturnType<typeof spawn> | undefined;
      let exited: Promise<number | null> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        execFileSync('git', ['init', '-q', caller], { env: environment });
        await writeFile(join(caller, 'caller.txt'), 'caller repository fixture\n');
        execFileSync('git', ['-C', caller, 'add', 'caller.txt'], { env: environment });
        execFileSync(
          'git',
          [
            '-C',
            caller,
            '-c',
            `core.hooksPath=${devNull}`,
            '-c',
            'commit.gpgsign=false',
            '-c',
            'user.name=Hook caller fixture',
            '-c',
            'user.email=hook@example.invalid',
            'commit',
            '-qm',
            'caller fixture',
          ],
          { env: environment },
        );
        execFileSync(
          'git',
          [
            '-C',
            caller,
            '-c',
            `core.hooksPath=${devNull}`,
            'worktree',
            'add',
            '--detach',
            '-q',
            linked,
            'HEAD',
          ],
          { env: environment },
        );
        const gitDirectory = execFileSync(
          'git',
          ['-C', linked, 'rev-parse', '--absolute-git-dir'],
          { env: environment, encoding: 'utf8' },
        ).trim();
        const configPath = join(caller, '.git', 'config');
        const indexPath = join(gitDirectory, 'index');
        const configBefore = await readFile(configPath);
        const indexBefore = await readFile(indexPath);
        const reportPath = join(hookRoot, 'result.json');
        probe = spawn(
          process.execPath,
          [
            join(repository, 'node_modules/vitest/vitest.mjs'),
            'run',
            'src/cli/index.integration.test.ts',
            '-t',
            'keeps (immutable-comparison stdout JSONL through SIGTERM|the untracked-file prompt on stderr and stdout JSONL)$',
            '--reporter=json',
            '--outputFile',
            reportPath,
          ],
          {
            cwd: repository,
            env: { ...environment, GIT_DIR: gitDirectory, GIT_INDEX_FILE: indexPath },
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let diagnostics = '';
        probe.stdout?.setEncoding('utf8');
        probe.stderr?.setEncoding('utf8');
        probe.stdout?.on('data', (chunk: string) => {
          diagnostics += chunk;
        });
        probe.stderr?.on('data', (chunk: string) => {
          diagnostics += chunk;
        });
        exited = new Promise<number | null>((resolveExit, rejectExit) => {
          probe!.once('error', rejectExit);
          probe!.once('close', resolveExit);
        });
        const code = await Promise.race([
          exited,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error(`Nested fixture did not exit: ${diagnostics}`)),
              20000,
            );
          }),
        ]);
        expect(
          (await readFile(configPath)).equals(configBefore),
          'fixture setup must preserve caller Git config',
        ).toBe(true);
        expect(
          (await readFile(indexPath)).equals(indexBefore),
          'fixture setup and CLI Git operations must preserve caller index',
        ).toBe(true);
        expect(code, diagnostics).toBe(0);
        const report = JSON.parse(await readFile(reportPath, 'utf8')) as { numPassedTests: number };
        expect(
          report.numPassedTests,
          'both selected real readiness cases must run, not merely skip',
        ).toBe(2);
      } finally {
        if (timeout) clearTimeout(timeout);
        if (probe?.pid) {
          try {
            process.kill(-probe.pid, 'SIGKILL');
          } catch (error) {
            // A completed runner may already have reaped its process group.
            expect((error as NodeJS.ErrnoException).code).toBe('ESRCH');
          }
        }
        await exited?.catch(() => undefined);
        await rm(hookRoot, { recursive: true, force: true });
      }
    },
    30000,
  );

  it('rejects --no-conversation alone before starting the server', async () => {
    const fixture = launch(['--no-conversation']);
    try {
      expect(await fixture.closed).toBe(1);
      expect(fixture.output().stdout).toBe('');
      expect(fixture.output().stderr).toContain('--no-conversation requires --no-jsonl');
    } finally {
      await stop(fixture.child);
    }
  });
});
