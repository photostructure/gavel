import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { codexTargetFromEnv, parseCodexTarget, sendToCodex } from './codex-queue';

const target = {
  kind: 'codex' as const,
  sessionId: '01a1d14e-3f20-7a62-b380-2a1ce396a0d5',
  home: '/home/test/.codex',
};
const help = { stdout: 'queue --thread <ID> --message <TEXT>' };

describe('Codex queue transport', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gavel-queue-test-'));
    for (const variable of ['TMPDIR', 'TMP', 'TEMP']) vi.stubEnv(variable, directory);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  function feedbackPath(message: string): string {
    return JSON.parse(/^Feedback file: (.+)$/m.exec(message)![1]!) as string;
  }

  it('captures the UUID and Codex home from the launching session', () => {
    expect(
      codexTargetFromEnv({ CODEX_THREAD_ID: target.sessionId, CODEX_HOME: target.home }),
    ).toEqual(target);
    expect(codexTargetFromEnv({ CODEX_THREAD_ID: 'a session name' })).toBeUndefined();
    expect(
      codexTargetFromEnv({ CODEX_THREAD_ID: target.sessionId, CODEX_HOME: 'relative' }),
    ).toBeUndefined();
  });

  it('parses only UUID targets with an absolute home', () => {
    expect(parseCodexTarget(target)).toEqual(target);
    expect(parseCodexTarget({ ...target, sessionId: '--help' })).toBeUndefined();
    expect(parseCodexTarget({ ...target, home: null })).toBeUndefined();
  });

  it('uses separate arguments and the owning home, without resuming another controller', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(help)
      .mockResolvedValueOnce({
        stdout: `Queued message 01a1d14e-b89d-7a92-8f99-c9266164e3c4 for thread ${target.sessionId}.\n`,
      });
    const content = 'Snapshot only; $(touch /tmp/should-not-exist)';
    expect(await sendToCodex(target, content, run)).toEqual({ status: 'queued' });
    expect(run.mock.calls[1]).toEqual([
      ['queue', '--thread', target.sessionId, '--message', content],
      expect.objectContaining({ CODEX_HOME: target.home }),
    ]);
  });

  it.each(['', 'Queued message abc for thread 00000000-0000-0000-0000-000000000000.'])(
    'treats an absent or wrong-owner acknowledgment as uncertain: %s',
    async (stdout) => {
      const run = vi.fn().mockResolvedValueOnce(help).mockResolvedValueOnce({ stdout });
      expect(await sendToCodex(target, 'notice', run)).toMatchObject({
        status: 'uncertain',
        error: expect.stringContaining('owning thread'),
      });
      expect(run).toHaveBeenCalledTimes(2);
    },
  );

  it('does not retry a write that times out after it may have queued', async () => {
    const run = vi.fn().mockResolvedValueOnce(help).mockRejectedValueOnce(new Error('timeout'));
    expect(await sendToCodex(target, 'notice', run)).toEqual({
      status: 'uncertain',
      error: 'timeout',
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  // codex queue --thread <archived UUID> --message test refuses with an archived-session error.
  it('keeps a refusal diagnostic without blindly retrying it', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(help)
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'Command failed: codex queue --message internal notification\nError: session is archived\n',
          ),
          { stderr: 'Error: session is archived\n', code: 1 },
        ),
      );
    expect(await sendToCodex(target, 'notice', run)).toEqual({
      status: 'uncertain',
      error: 'Error: session is archived',
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps the inline budget in UTF-8 bytes and creates no file for small feedback', async () => {
    const content = '🧪'.repeat(4_000);
    const run = vi.fn(async (args: string[]) => {
      if (!args.includes('--help')) expect(args[4]).toBe(content);
      return {
        stdout: `queue --thread --message\nQueued message abc for thread ${target.sessionId}.`,
      };
    });
    expect(await sendToCodex(target, content, run)).toEqual({ status: 'queued' });
    expect(run.mock.calls).toHaveLength(2);
    expect(await readdir(directory)).toEqual([]);
  });

  it('queues one file instruction with the complete oversized feedback already written privately', async () => {
    // User-approved contract: inline up to 16,000 UTF-8 bytes; larger feedback uses one file read.
    const content = JSON.stringify({ body: '🧪 quoted "context"\n'.repeat(4_000) });
    let path = '';
    const run = vi.fn(async (args: string[]) => {
      if (args.includes('--help')) return help;
      path = feedbackPath(args[4]!);
      expect(await readFile(path, 'utf8')).toBe(content);
      expect(args[4]).toContain('Read the complete gavel feedback');
      expect(args[4]).not.toContain('part 1/');
      expect(Buffer.byteLength(args[4]!)).toBeLessThan(16_000);
      return { stdout: `Queued message abc for thread ${target.sessionId}.` };
    });
    expect(await sendToCodex(target, content, run)).toEqual({ status: 'queued' });
    expect(run).toHaveBeenCalledTimes(2);
    expect(await readFile(path, 'utf8')).toBe(content);
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
    }
  });

  it('retains the file after an uncertain queue write without retrying', async () => {
    const content = 'context '.repeat(10_000);
    let path = '';
    const run = vi.fn(async (args: string[]) => {
      if (args.includes('--help')) return help;
      path = feedbackPath(args[4]!);
      throw Object.assign(new Error('Command failed'), { stderr: 'queue unavailable' });
    });
    expect(await sendToCodex(target, content, run)).toEqual({
      status: 'uncertain',
      error: 'queue unavailable',
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(await readFile(path, 'utf8')).toBe(content);
  });

  it('does not queue a file instruction when saving the feedback fails', async () => {
    const run = vi.fn().mockResolvedValue(help);
    await rm(directory, { recursive: true });
    await expect(sendToCodex(target, 'context '.repeat(10_000), run)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('fails before writing when queue is unsupported', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'old CLI help' });
    await expect(sendToCodex(target, 'notice', run)).rejects.toThrow('does not support');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('fails before writing when the CLI is missing', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ENOENT'));
    await expect(sendToCodex(target, 'notice', run)).rejects.toThrow('ENOENT');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
