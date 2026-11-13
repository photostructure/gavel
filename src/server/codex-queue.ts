import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

export interface CodexQueueTarget {
  kind: 'codex';
  sessionId: string;
  home: string;
}

export type QueueReceipt = { status: 'queued' } | { status: 'uncertain'; error: string };
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const execute = promisify(execFile);
type RunCodex = (args: string[], env: NodeJS.ProcessEnv) => Promise<{ stdout: string }>;
const runCodex: RunCodex = (args, env) =>
  execute('codex', args, { env, timeout: 5_000, maxBuffer: 64 * 1024, encoding: 'utf8' });

export function codexTargetFromEnv(env: NodeJS.ProcessEnv): CodexQueueTarget | undefined {
  const sessionId = env.CODEX_THREAD_ID;
  const home = env.CODEX_HOME || join(homedir(), '.codex');
  if (!sessionId || !UUID.test(sessionId) || !isAbsolute(home)) return undefined;
  return { kind: 'codex', sessionId, home };
}

export function parseCodexTarget(input: Record<string, unknown>): CodexQueueTarget | undefined {
  const { sessionId, home } = input;
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) return undefined;
  if (typeof home !== 'string' || !isAbsolute(home)) return undefined;
  return { kind: 'codex', sessionId, home };
}

// Queue accepts one command-line argument, with no stdin/file expansion. Keep small feedback
// inline; larger batches need one file read instead of multiple queued model inputs.
async function queueMessage(content: string): Promise<string> {
  if (Buffer.byteLength(content, 'utf8') <= 16_000) return content;
  const directory = await mkdtemp(join(resolve(tmpdir()), 'gavel-codex-feedback-'));
  const file = join(directory, 'feedback.txt');
  try {
    await writeFile(file, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  // mkdtemp creates a private directory. Retain the file even after queue errors or server
  // shutdown: a saved notification may be consumed much later. OS temp cleanup may remove it.
  return `Read the complete gavel feedback from this local UTF-8 file before acting. It contains the review IDs, human comments, verdicts, and code context.\nFeedback file: ${JSON.stringify(file)}\nIf the file is unavailable, use the review's manual resume prompt to recover its current state. Follow the gavel instructions in the file; this notification is not approval by itself.`;
}

function queueFailure(error: unknown): string {
  const failure = error as {
    stderr?: unknown;
    killed?: unknown;
    code?: unknown;
    signal?: unknown;
  } | null;
  const diagnostic = typeof failure?.stderr === 'string' ? failure.stderr.trim() : '';
  if (diagnostic) return diagnostic;
  if (failure?.killed === true) return 'Codex queue did not finish within 5 seconds';
  if (typeof failure?.code === 'number' || typeof failure?.code === 'string')
    return `Codex queue failed (${failure.code})`;
  if (typeof failure?.signal === 'string') return `Codex queue stopped (${failure.signal})`;
  return error instanceof Error ? error.message : 'Codex queue failed without a diagnostic';
}

/** Queue acceptance is not proof of a running turn. Never resume a second controller. */
export async function sendToCodex(
  target: CodexQueueTarget,
  content: string,
  run: RunCodex = runCodex,
): Promise<QueueReceipt> {
  const env = { ...process.env, CODEX_HOME: target.home };
  // Check before attempting a write: older CLIs and missing executables remain recoverable.
  const help = await run(['queue', '--help'], env);
  if (!help.stdout.includes('--thread') || !help.stdout.includes('--message'))
    throw new Error('The installed Codex CLI does not support queueing messages');

  const message = await queueMessage(content);
  try {
    const { stdout } = await run(
      ['queue', '--thread', target.sessionId, '--message', message],
      env,
    );
    const receipt = /^Queued message [\da-f-]+ for thread ([\da-f-]+)\.$/im.exec(stdout);
    if (receipt?.[1] === target.sessionId) return { status: 'queued' };
    return {
      status: 'uncertain',
      error: 'Codex did not acknowledge queueing for the owning thread',
    };
  } catch (error) {
    // The command may already have saved the notification. Keep its file and never retry.
    return { status: 'uncertain', error: queueFailure(error) };
  }
}
