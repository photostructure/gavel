import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from 'commander';

import {
  inboxRuntimeDir,
  inboxTargetFromEnv,
  privateDirectory,
  registryRoot,
} from '../server/session-inbox.js';

import { serverUrl } from './server-url.js';
import { detectStdinSource, readStdin } from './utils.js';

interface Registration {
  host: string;
  port: number;
  pid: number;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Re-points every gavel server that holds reviews of this Claude Code session at the session's
 * current inbox, which changes when the session restarts, and returns the review activity no
 * inbox message carried. Run from prompt hooks, so it prints nothing when nothing is pending.
 */
export async function collectPending(options: {
  env: NodeJS.ProcessEnv;
  runtimeDir: string;
  fetch: typeof fetch;
  isAlive: (pid: number) => boolean;
}): Promise<{ output: string; errors: string[] }> {
  const target = inboxTargetFromEnv(options.env);
  if (!target) return { output: '', errors: [] };
  // A registry other users could write could send this session's inbox token to their server.
  if (
    !privateDirectory(options.runtimeDir, false) ||
    !privateDirectory(registryRoot(options.runtimeDir), false)
  )
    return { output: '', errors: [] };
  const dir = join(registryRoot(options.runtimeDir), 'sessions', target.sessionId);
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { output: '', errors: [] };
    throw error;
  }
  const outputs: string[] = [];
  const errors: string[] = [];
  for (const name of files.sort()) {
    const file = join(dir, name);
    // Each server's failure is reported on its own: activity other servers handed over counts
    // as delivered and must still be printed.
    try {
      let registration: Registration;
      try {
        registration = JSON.parse(readFileSync(file, 'utf8')) as Registration;
      } catch (error) {
        // The server shut down after the directory was read.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      // A server that crashed could not remove its own registration.
      if (!options.isAlive(registration.pid)) {
        rmSync(file, { force: true });
        continue;
      }
      const url = serverUrl(registration.host, registration.port, '/api/inbox/attach');
      const response = await options.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target),
        signal: AbortSignal.timeout(2000),
      });
      const body = (await response.json()) as { pending?: string | null; error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      if (body.pending) outputs.push(body.pending);
    } catch (error) {
      errors.push(
        `gavel pending: ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { output: outputs.join('\n\n'), errors };
}

export function createPendingCommand(): Command {
  return new Command('pending')
    .description(
      "Print review activity that never reached this Claude Code session's inbox; for prompt hooks",
    )
    .action(async () => {
      let env = process.env;
      // A hook's input names the session even when its environment does not.
      if (!env.CLAUDE_CODE_SESSION_ID && detectStdinSource() !== 'tty') {
        const input = JSON.parse((await readStdin()) || '{}') as { session_id?: unknown };
        if (typeof input.session_id === 'string')
          env = { ...env, CLAUDE_CODE_SESSION_ID: input.session_id };
      }
      const { output, errors } = await collectPending({
        env,
        runtimeDir: inboxRuntimeDir(process.env),
        fetch,
        isAlive: processAlive,
      });
      for (const error of errors) console.error(error);
      if (output) console.log(output);
    });
}
