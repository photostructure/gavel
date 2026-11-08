import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

// Exercise the actual launcher with bounded, short-lived compiler and Vite substitutes.
describe.skipIf(process.platform === 'win32')('development readiness protocol', () => {
  it.each([
    [true, 'startup'],
    [false, 'startup'],
    [true, 'burst'],
  ] as const)(
    'starts Vite and forwards complete output (JSONL: %s, mode: %s)',
    async (jsonl, mode) => {
      const directory = await mkdtemp(join(tmpdir(), 'gavel-dev-readiness-'));
      let child: ReturnType<typeof spawn> | undefined;
      try {
        for (const folder of ['scripts', 'dev', 'bin', 'dist/cli']) {
          await mkdir(join(directory, folder), { recursive: true });
        }
        await writeFile(join(directory, 'package.json'), '{"type":"module"}');
        for (const file of ['scripts/dev.js', 'dev/dev-lifecycle.js', 'dev/dev-stdout.js']) {
          await copyFile(
            join(dirname(fileURLToPath(import.meta.url)), '..', file),
            join(directory, file),
          );
        }
        // Later launcher lifecycle changes load these helpers and run Node directly.
        // Keep this protocol regression usable before and after that separate change.
        for (const file of ['dev/dev-output.js', 'dev/dev-process.js']) {
          try {
            await copyFile(
              join(dirname(fileURLToPath(import.meta.url)), '..', file),
              join(directory, file),
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        await writeFile(
          join(directory, 'worker.js'),
          `
import { writeFileSync } from 'node:fs';
const vite = process.env.FIXTURE_ROLE === 'vite';
if (vite) writeFileSync('vite-env', JSON.stringify({ apiUrl: process.env.VITE_GAVEL_API_URL, openPath: process.env.GAVEL_VITE_OPEN_PATH }));
console.log(vite ? 'vite diagnostic' : 'compiler diagnostic');
`,
        );
        for (const [name, entry, role] of [
          ['typescript', 'tsc', 'compiler'],
          ['vite', 'vite.js', 'vite'],
        ] as const) {
          const modulePath = join(directory, 'node_modules', name);
          await mkdir(join(modulePath, 'bin'), { recursive: true });
          await writeFile(
            join(modulePath, 'package.json'),
            JSON.stringify({ name, type: 'module' }),
          );
          await writeFile(
            join(modulePath, 'bin', entry),
            `process.env.FIXTURE_ROLE = '${role}'; await import('../../../worker.js');`,
          );
        }
        await writeFile(
          join(directory, 'bin/pnpm'),
          `#!${process.execPath}
process.env.FIXTURE_ROLE = process.argv.includes('vite') ? 'vite' : 'compiler';
await import('../worker.js');
`,
        );
        await chmod(join(directory, 'bin/pnpm'), 0o755);
        await writeFile(
          join(directory, 'dist/cli/index.js'),
          `
import { existsSync, writeFileSync } from 'node:fs';
const ready = { type: 'server.ready', url: 'http://localhost:4966', launchUrl: 'http://localhost:4966?mode=fixture#gavel-editor-token=capability', port: 4966 };
if (${jsonl}) process.stdout.write(JSON.stringify(ready) + '\\n');
else process.stderr.write('🚀 gavel server started on ' + ready.launchUrl + '\\n');
if (${JSON.stringify(mode)} === 'burst') {
  const events = Array.from({ length: 60 }, (_, index) => ({ type: 'comment.updated', index, body: 'x'.repeat(16384) }));
  events.push({ type: 'server.shutdown', reason: 'closed' });
  const waitForVite = setInterval(() => {
    if (!existsSync('vite-env')) return;
    clearInterval(waitForVite);
    process.stdout.write(events.map(event => JSON.stringify(event) + '\\n').join(''), () => writeFileSync('producer-finished', 'done'));
  }, 10);
} else setTimeout(() => {}, 1500);
`,
        );
        child = spawn(process.execPath, ['scripts/dev.js', ...(jsonl ? [] : ['--no-jsonl'])], {
          cwd: directory,
          env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH ?? ''}` },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        const exited = new Promise<void>((resolve, reject) => {
          child!.once('error', reject);
          child!.once('close', () => resolve());
        });
        if (mode === 'burst') {
          child.stdout?.pause();
          const deadline = Date.now() + 3000;
          while (Date.now() < deadline) {
            try {
              await readFile(join(directory, 'producer-finished'));
              break;
            } catch {
              await delay(10);
            }
          }
          // The producer has finished while the consumer still leaves its pipe full.
          await delay(200);
          child.stdout?.resume();
        }
        await Promise.race([
          exited,
          delay(4000).then(() => {
            throw new Error('Launcher did not exit');
          }),
        ]);
        expect(JSON.parse(await readFile(join(directory, 'vite-env'), 'utf8'))).toEqual({
          apiUrl: 'http://localhost:4966',
          openPath: '/?mode=fixture#gavel-editor-token=capability',
        });
        expect(stderr).toContain('compiler diagnostic');
        expect(stderr).toContain('vite diagnostic');
        expect(stderr).toContain('Starting Vite dev server');
        if (jsonl) {
          const records = stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as { type: string });
          const expected: unknown[] = [expect.objectContaining({ type: 'server.ready' })];
          if (mode === 'burst') {
            expected.push(
              ...Array.from({ length: 60 }, (_, index) => ({
                type: 'comment.updated',
                index,
                body: 'x'.repeat(16384),
              })),
              { type: 'server.shutdown', reason: 'closed' },
            );
          }
          expect(records).toEqual(expected);
        } else expect(stdout).toBe('');
      } finally {
        child?.kill('SIGTERM');
        await rm(directory, { recursive: true, force: true });
      }
    },
    10000,
  );
});
