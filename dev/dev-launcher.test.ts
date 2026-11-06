import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// TypeScript 7 removed ts.transpileModule and its API cannot emit, so transpile with its tsc.
const tsc = join(
  dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
  'bin/tsc',
);

interface Fixture {
  directory: string;
  child: ChildProcessWithoutNullStreams;
  exited: Promise<void>;
  cleanup(): Promise<void>;
}

async function waitForFile(directory: string, name: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await access(join(directory, name));
      return;
    } catch {
      await delay(10);
    }
  }
  throw new Error(`Fixture did not create ${name}`);
}

function withoutGitEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith('GIT_')));
}

async function startFixture(
  mode: 'burst' | 'persistent' | 'exit' | 'compile' | 'compile-fail' | 'compile-disconnect' | 'git',
  jsonl = true,
  environment: NodeJS.ProcessEnv = process.env,
  launcherArgs: string[] = [],
): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'difit-dev-launcher-'));
  const fixtureEnv = withoutGitEnvironment(environment);
  try {
    for (const folder of [
      'scripts',
      'dev',
      'bin',
      'dist/cli',
      'node_modules/typescript/bin',
      'node_modules/vite/bin',
    ]) {
      await mkdir(join(directory, folder), { recursive: true });
    }
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    for (const file of [
      'scripts/dev.js',
      'dev/dev-lifecycle.js',
      'dev/dev-stdout.js',
      'dev/dev-process.js',
    ]) {
      await copyFile(
        join(dirname(fileURLToPath(import.meta.url)), '..', file),
        join(directory, file),
      );
    }
    await copyFile(
      join(dirname(fileURLToPath(import.meta.url)), 'dev-output.js'),
      join(directory, 'dev/dev-output.js'),
    );
    await writeFile(
      join(directory, 'worker.js'),
      `
import { existsSync, writeFileSync } from 'node:fs';
const role = process.env.FIXTURE_ROLE;
console.log(role + ' diagnostic');
if (role === 'vite') writeFileSync('vite-env', JSON.stringify({
  apiUrl: process.env.VITE_DIFIT_API_URL,
  openPath: process.env.DIFIT_VITE_OPEN_PATH,
}));
if (role === 'compile' && ${JSON.stringify(mode)} === 'compile-fail') {
  const diagnostic = 'x'.repeat(2000000);
  writeFileSync('expected-compiler-output', role + ' diagnostic\\n' + diagnostic);
  process.stdout.write(diagnostic);
  process.exitCode = 2;
}
if (role === 'compile' && ${JSON.stringify(mode)} === 'compile-disconnect') {
  const waitForRelease = setInterval(() => {
    if (!existsSync('release-compiler')) return;
    clearInterval(waitForRelease);
    process.stdout.write('compiler diagnostic after disconnect\\n');
  }, 10);
}
if (role === 'vite' || ${JSON.stringify(mode)} === 'compile') {
  const keepAlive = setInterval(() => {}, 1000);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    writeFileSync(role + '-stopped', signal);
    clearInterval(keepAlive);
  });
}
// The test may signal the tree as soon as this marker appears. Publish it only
// after handlers are installed so a pre-startup default signal exit is excluded.
writeFileSync(role + '.pid', String(process.pid));
`,
    );
    for (const [name, entry, role] of [
      ['typescript', 'tsc', 'compile'],
      ['vite', 'vite.js', 'vite'],
    ] as const) {
      await writeFile(
        join(directory, 'node_modules', name, 'package.json'),
        JSON.stringify({ name, type: 'module' }),
      );
      await writeFile(
        join(directory, 'node_modules', name, 'bin', entry),
        `process.env.FIXTURE_ROLE = '${role}'; await import('../../../worker.js');`,
      );
    }
    await writeFile(
      join(directory, 'bin/pnpm'),
      `#!${process.execPath}
import { writeFileSync } from 'node:fs';
writeFileSync('pnpm-invoked', 'unexpected wrapper');
process.exitCode = 99;
`,
    );
    await chmod(join(directory, 'bin/pnpm'), 0o755);
    if (mode === 'git') {
      execFileSync('git', ['init', '-q'], { cwd: directory, env: fixtureEnv });
      execFileSync(
        'git',
        [
          'config',
          'diff.fixture.textconv',
          `"${process.execPath}" "${join(directory, 'textconv.cjs')}"`,
        ],
        { cwd: directory, env: fixtureEnv },
      );
      await writeFile(join(directory, '.gitattributes'), '*.fixture diff=fixture\n');
      await writeFile(join(directory, 'before.fixture'), 'before\n');
      await writeFile(join(directory, 'after.fixture'), 'after\n');
      await writeFile(
        join(directory, 'textconv.cjs'),
        `
const { writeFileSync } = require('node:fs');
writeFileSync('textconv.pid', String(process.pid));
setInterval(() => {}, 1000);
`,
      );
    }
    const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const cliSource = await readFile(join(sourceRoot, 'src/cli/index.ts'), 'utf8');
    const handlerStart = cliSource.indexOf('function registerShutdownHandlers(');
    const handlerEnd = cliSource.indexOf('\nasync function handleUntrackedFiles', handlerStart);
    if (handlerStart < 0 || handlerEnd < 0) throw new Error('CLI shutdown handler not found');
    const shutdownHandlers = cliSource.slice(handlerStart, handlerEnd);
    await mkdir(join(directory, 'cli-source'));
    await writeFile(
      join(directory, 'cli-source/index.ts'),
      `
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
writeFileSync('cli.pid', String(process.pid));
const ready = {
  type: 'server.ready',
  url: 'http://localhost:4966',
  launchUrl: 'http://localhost:4966?review=agent-task#difit-editor-token=fixture-capability',
  port: 4966,
};
const announceReady = () => {
  if (process.argv.includes('--no-jsonl')) process.stderr.write('🚀 difit server started on ' + ready.launchUrl + '\\n');
  else process.stdout.write(JSON.stringify(ready) + '\\n');
};
if (${JSON.stringify(mode)} === 'burst') {
  announceReady();
  const records = Array.from({ length: 60 }, (_, index) => ({ type: 'comment.updated', index, body: 'x'.repeat(16384) }));
  records.push({ type: 'server.shutdown', reason: 'closed' });
  const output = records.map(record => JSON.stringify(record) + '\\n').join('');
  writeFileSync('expected-output', JSON.stringify(ready) + '\\n' + output);
  process.stdout.write(output, () => writeFileSync('producer-finished', 'done'));
} else if (${JSON.stringify(mode)} === 'exit') {
  announceReady();
  const waitForVite = setInterval(() => {
    if (!existsSync('vite.pid')) return;
    process.stdout.write(JSON.stringify({ type: 'server.shutdown', reason: 'closed' }) + '\\n');
    clearInterval(waitForVite);
  }, 10);
} else {
  const keepAlive = setInterval(() => {}, 1000);
  process.stdin.on('data', () => {
    process.stdout.write(JSON.stringify({ type: 'comment.created', body: 'new comment' }) + '\\n');
    process.stderr.write('CLI diagnostic after comment\\n');
    writeFileSync('comment-processed', 'done');
  });
  ${shutdownHandlers}
  registerShutdownHandlers(async (signal) => {
    await new Promise(resolve => setTimeout(resolve, 100));
    process.stdout.write(JSON.stringify({ type: 'server.shutdown', reason: signal }) + '\\n');
    writeFileSync('cli-stopped', signal);
    clearInterval(keepAlive);
    process.stdin.destroy();
  }, 4966, true);
  announceReady();
  if (${JSON.stringify(mode)} === 'git') {
    spawn('git', ['diff', '--no-index', '--no-ext-diff', '--textconv', 'before.fixture', 'after.fixture'], { stdio: 'ignore' });
  }
}
`,
    );
    execFileSync(process.execPath, [
      tsc,
      '--ignoreConfig',
      '--noCheck',
      '--target',
      'es2022',
      '--module',
      'esnext',
      '--outDir',
      join(directory, 'dist/cli'),
      join(directory, 'cli-source/index.ts'),
    ]);
    const child = spawn(
      process.execPath,
      ['scripts/dev.js', ...(jsonl ? [] : ['--no-jsonl']), ...launcherArgs],
      {
        cwd: directory,
        detached: true,
        env: { ...fixtureEnv, PATH: `${join(directory, 'bin')}:${fixtureEnv.PATH ?? ''}` },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', () => resolve());
    });
    return {
      directory,
      child,
      exited,
      async cleanup() {
        const signalGroup = (signal: NodeJS.Signals) => {
          try {
            if (child.pid) process.kill(-child.pid, signal);
          } catch {
            // The detached fixture group may already have exited.
          }
        };
        signalGroup('SIGTERM');
        child.stdout.resume();
        child.stderr.resume();
        await Promise.race([exited, delay(1000)]);
        signalGroup('SIGKILL');
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

// The fixture uses POSIX shebang executables and catchable SIGTERM/SIGINT signals.
describe.skipIf(process.platform === 'win32')('development launcher subprocess output', () => {
  it.each([true, false])(
    'opens the named review and capability without putting either in the proxy target (JSONL: %s)',
    async (jsonl) => {
      const fixture = await startFixture('exit', jsonl);
      try {
        fixture.child.stdout.resume();
        fixture.child.stderr.resume();
        await waitForFile(fixture.directory, 'vite-env');
        const viteEnv = JSON.parse(await readFile(join(fixture.directory, 'vite-env'), 'utf8')) as {
          apiUrl: string;
          openPath: string;
        };
        expect(viteEnv).toEqual({
          apiUrl: 'http://localhost:4966',
          openPath: '/?review=agent-task#difit-editor-token=fixture-capability',
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it('leaves the browser closed when the caller passes --no-open', async () => {
    const fixture = await startFixture('exit', true, process.env, ['--no-open']);
    try {
      fixture.child.stdout.resume();
      fixture.child.stderr.resume();
      await waitForFile(fixture.directory, 'vite-env');
      const viteEnv: unknown = JSON.parse(
        await readFile(join(fixture.directory, 'vite-env'), 'utf8'),
      );
      expect(viteEnv).toEqual({ apiUrl: 'http://localhost:4966' });
    } finally {
      await fixture.cleanup();
    }
  });

  it('drains all JSONL records and shutdown when the consumer temporarily stops reading', async () => {
    const fixture = await startFixture('burst');
    try {
      fixture.child.stderr.resume();
      const chunks: Buffer[] = [];
      fixture.child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      fixture.child.stdout.pause();
      // Leave stdout paused while CLI output exceeds the OS pipe capacity.
      await waitForFile(fixture.directory, 'producer-finished');
      await Promise.race([fixture.exited, delay(200)]);
      fixture.child.stdout.resume();
      expect(
        await Promise.race([fixture.exited.then(() => true), delay(1500).then(() => false)]),
        'launcher must finish draining output',
      ).toBe(true);
      expect(fixture.child.exitCode).toBe(0);
      const actual = Buffer.concat(chunks);
      const expected = await readFile(join(fixture.directory, 'expected-output'));
      expect(
        actual.length,
        `${actual.toString().trim().split('\n').length} of 62 JSONL records received`,
      ).toBe(expected.length);
      expect(createHash('sha256').update(actual).digest('hex')).toBe(
        createHash('sha256').update(expected).digest('hex'),
      );
    } finally {
      await fixture.cleanup();
    }
  }, 10000);

  it.each(['exit', 'persistent'] as const)(
    'stops the installed Vite worker on %s shutdown',
    async (mode) => {
      const fixture = await startFixture(mode);
      try {
        fixture.child.stdout.resume();
        fixture.child.stderr.resume();
        await waitForFile(fixture.directory, 'vite.pid');
        if (mode === 'persistent') fixture.child.kill('SIGTERM');
        const exited = await Promise.race([
          fixture.exited.then(() => true),
          delay(1500).then(() => false),
        ]);
        expect(exited, 'launcher must close after its CLI and Vite tree stop').toBe(true);
        expect(await readFile(join(fixture.directory, 'vite-stopped'), 'utf8')).toBe(
          mode === 'exit' ? 'SIGINT' : 'SIGTERM',
        );
      } finally {
        await fixture.cleanup();
      }
    },
    10000,
  );

  it('drains failed compiler diagnostics before preserving its exit status', async () => {
    const fixture = await startFixture('compile-fail');
    try {
      fixture.child.stdout.resume();
      const chunks: Buffer[] = [];
      fixture.child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
      fixture.child.stderr.pause();
      await waitForFile(fixture.directory, 'expected-compiler-output');
      await delay(200);
      fixture.child.stderr.resume();
      expect(
        await Promise.race([fixture.exited.then(() => true), delay(1500).then(() => false)]),
      ).toBe(true);
      expect(fixture.child.exitCode).toBe(2);
      const expected = await readFile(join(fixture.directory, 'expected-compiler-output'));
      expect(Buffer.concat(chunks).equals(expected)).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  }, 10000);

  it('continues compiler startup after its stderr consumer disconnects', async () => {
    const fixture = await startFixture('compile-disconnect');
    try {
      fixture.child.stdout.resume();
      fixture.child.stderr.resume();
      await waitForFile(fixture.directory, 'compile.pid');
      fixture.child.stderr.destroy();
      await writeFile(join(fixture.directory, 'release-compiler'), 'continue');
      await waitForFile(fixture.directory, 'vite.pid');
      expect(fixture.child.exitCode).toBeNull();
      fixture.child.kill('SIGTERM');
      expect(
        await Promise.race([fixture.exited.then(() => true), delay(1500).then(() => false)]),
      ).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  }, 10000);

  it('isolates fixture Git setup from the Git environment of linked-worktree hooks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'difit-hook-git-'));
    const repository = join(directory, 'repository');
    const linked = join(directory, 'linked');
    const env = withoutGitEnvironment(process.env);
    let fixture: Fixture | undefined;
    try {
      execFileSync('git', ['init', '-q', repository], { env });
      execFileSync(
        'git',
        [
          '-C',
          repository,
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          'commit',
          '--allow-empty',
          '-qm',
          'fixture',
        ],
        { env },
      );
      execFileSync(
        'git',
        [
          '-C',
          repository,
          '-c',
          'core.hooksPath=/dev/null',
          'worktree',
          'add',
          '--detach',
          '-q',
          linked,
          'HEAD',
        ],
        {
          env,
        },
      );
      const gitDirectory = execFileSync('git', ['-C', linked, 'rev-parse', '--absolute-git-dir'], {
        env,
        encoding: 'utf8',
      }).trim();
      const config = join(repository, '.git', 'config');
      const before = await readFile(config);
      const index = join(gitDirectory, 'index');
      const indexBefore = await readFile(index);
      fixture = await startFixture('git', true, {
        ...process.env,
        GIT_DIR: gitDirectory,
        GIT_INDEX_FILE: join(gitDirectory, 'index'),
      });
      fixture.child.stdout.resume();
      fixture.child.stderr.resume();
      await waitForFile(fixture.directory, 'vite.pid');
      expect(
        (await readFile(config)).equals(before),
        'fixture setup must not alter its parent hook repository config',
      ).toBe(true);
      expect(
        (await readFile(index)).equals(indexBefore),
        'fixture setup must not alter the parent hook index',
      ).toBe(true);
    } finally {
      await fixture?.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10000);

  it('stops active Git descendants when only the launcher receives SIGTERM', async () => {
    const fixture = await startFixture('git');
    try {
      fixture.child.stdout.resume();
      fixture.child.stderr.resume();
      await waitForFile(fixture.directory, 'textconv.pid');
      const pid = Number(await readFile(join(fixture.directory, 'textconv.pid'), 'utf8'));
      fixture.child.kill('SIGTERM');
      expect(
        await Promise.race([fixture.exited.then(() => true), delay(1500).then(() => false)]),
      ).toBe(true);
      let running = true;
      const deadline = Date.now() + 1500;
      while (running && Date.now() < deadline) {
        try {
          const state = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
            encoding: 'utf8',
          }).trim();
          running = state.length > 0 && !state.startsWith('Z');
        } catch {
          running = false;
        }
        if (running) await delay(10);
      }
      expect(running, 'the launcher must stop its active Git text-conversion process').toBe(false);
    } finally {
      await fixture.cleanup();
    }
  }, 10000);

  it('cancels the installed compiler without leaving descendants or open pipes', async () => {
    const fixture = await startFixture('compile');
    try {
      fixture.child.stdout.resume();
      fixture.child.stderr.resume();
      await waitForFile(fixture.directory, 'compile.pid');
      fixture.child.kill('SIGTERM');
      const exited = await Promise.race([
        fixture.exited.then(() => true),
        delay(1500).then(() => false),
      ]);
      expect(exited, 'launcher must close after compiler cancellation').toBe(true);
      expect(await readFile(join(fixture.directory, 'compile-stopped'), 'utf8')).toBe('SIGTERM');
    } finally {
      await fixture.cleanup();
    }
  }, 10000);

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'tolerates duplicate terminal %s and preserves delayed CLI shutdown output',
    async (signal) => {
      const fixture = await startFixture('persistent');
      try {
        const chunks: Buffer[] = [];
        fixture.child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        fixture.child.stderr.resume();
        await waitForFile(fixture.directory, 'vite.pid');
        process.kill(-fixture.child.pid!, signal);
        const exited = await Promise.race([
          fixture.exited.then(() => true),
          delay(1500).then(() => false),
        ]);
        expect(exited).toBe(true);
        expect(Buffer.concat(chunks).toString()).toContain(
          `"type":"server.shutdown","reason":"${signal}"`,
        );
        expect(await readFile(join(fixture.directory, 'cli-stopped'), 'utf8')).toBe(signal);
      } finally {
        await fixture.cleanup();
      }
    },
    10000,
  );

  it.each([
    ['persistent', 'SIGHUP'],
    ['persistent', 'SIGKILL'],
    ['compile', 'SIGHUP'],
    ['compile', 'SIGKILL'],
  ] as const)(
    'leaves no %s worker after launcher-group %s',
    async (mode, signal) => {
      const fixture = await startFixture(mode);
      try {
        fixture.child.stdout.resume();
        fixture.child.stderr.resume();
        await waitForFile(fixture.directory, mode === 'compile' ? 'compile.pid' : 'vite.pid');
        const pids = await Promise.all(
          (mode === 'compile' ? ['compile.pid'] : ['cli.pid', 'vite.pid']).map(async (name) =>
            Number(await readFile(join(fixture.directory, name), 'utf8')),
          ),
        );
        process.kill(-fixture.child.pid!, signal);
        await delay(200);
        const alive = pids.filter((pid) => {
          try {
            return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
              .trim()
              .startsWith('Z');
          } catch {
            return false;
          }
        });
        expect(
          alive,
          'CLI and Vite must remain in the launcher group for terminal/harness cleanup',
        ).toEqual([]);
      } finally {
        await fixture.cleanup();
      }
    },
    10000,
  );

  it('cleans up both workers when only the launcher receives SIGHUP', async () => {
    const fixture = await startFixture('persistent');
    try {
      fixture.child.stdout.resume();
      fixture.child.stderr.resume();
      await waitForFile(fixture.directory, 'vite.pid');
      fixture.child.kill('SIGHUP');
      const exited = await Promise.race([
        fixture.exited.then(() => true),
        delay(1500).then(() => false),
      ]);
      expect(exited).toBe(true);
      expect(await readFile(join(fixture.directory, 'cli-stopped'), 'utf8')).toBe('SIGTERM');
      expect(await readFile(join(fixture.directory, 'vite-stopped'), 'utf8')).toBe('SIGTERM');
    } finally {
      await fixture.cleanup();
    }
  }, 10000);

  it.each(['stdout', 'stderr'] as const)(
    'keeps the launcher and children managed after its %s consumer disconnects',
    async (stream) => {
      const fixture = await startFixture('persistent');
      try {
        fixture.child.stdout.resume();
        fixture.child.stderr.resume();
        await waitForFile(fixture.directory, 'vite.pid');
        fixture.child[stream].destroy();
        fixture.child.stdin.write('comment\\n');
        await waitForFile(fixture.directory, 'comment-processed');
        await Promise.race([fixture.exited, delay(200)]);
        expect(fixture.child.exitCode).toBeNull();
        expect(fixture.child.signalCode).toBeNull();
        fixture.child.kill('SIGTERM');
        expect(
          await Promise.race([fixture.exited.then(() => true), delay(1500).then(() => false)]),
          'launcher must close after disconnect cleanup',
        ).toBe(true);
        expect(await readFile(join(fixture.directory, 'cli-stopped'), 'utf8')).toBe('SIGTERM');
        expect(await readFile(join(fixture.directory, 'vite-stopped'), 'utf8')).toBe('SIGTERM');
      } finally {
        await fixture.cleanup();
      }
    },
    10000,
  );
});
