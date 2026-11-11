import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectPending } from './pending';

describe('collectPending', () => {
  let runtimeDir: string;
  const env = {
    CLAUDE_CODE_SESSION_ID: 'session-a',
    CLAUDE_CODE_MESSAGING_SOCKET: '/run/user/1000/cc-socks/42.sock',
    CLAUDE_CODE_MESSAGING_TOKEN: 'tok',
  };
  const fetchMock = vi.fn<typeof fetch>();

  function register(port: number, pid: number) {
    const dir = join(runtimeDir, 'gavel', 'sessions', 'session-a');
    // As servers create it: closed to other users.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${port}.json`);
    writeFileSync(file, JSON.stringify({ host: 'localhost', port, pid }));
    return file;
  }

  beforeEach(() => {
    runtimeDir = mkdtempSync(join(tmpdir(), 'gavel-pending-'));
  });
  afterEach(() => {
    rmSync(runtimeDir, { recursive: true, force: true });
    vi.resetAllMocks();
  });

  it('prints nothing and contacts nothing when this session owns no review', async () => {
    const result = await collectPending({ env, runtimeDir, fetch: fetchMock, isAlive: () => true });
    expect(result).toEqual({ output: '', errors: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-points each server at the session's current inbox and prints undelivered activity", async () => {
    register(4966, 100);
    register(4967, 101);
    fetchMock.mockImplementation(async (url) =>
      Response.json({
        pending: String(url).includes('4966') ? 'gavel: new review activity at 4966' : null,
      }),
    );
    const result = await collectPending({ env, runtimeDir, fetch: fetchMock, isAlive: () => true });
    expect(result).toEqual({ output: 'gavel: new review activity at 4966', errors: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4966/api/inbox/attach',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'session-a',
          socket: '/run/user/1000/cc-socks/42.sock',
          token: 'tok',
        }),
      }),
    );
  });

  it('removes the registration of a server whose process has exited', async () => {
    const file = register(4966, 100);
    const result = await collectPending({
      env,
      runtimeDir,
      fetch: fetchMock,
      isAlive: () => false,
    });
    expect(result.output).toBe('');
    expect(existsSync(file)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a live server it cannot reach without failing the others', async () => {
    register(4966, 100);
    register(4967, 101);
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('4966')) throw new TypeError('fetch failed');
      return Response.json({ pending: 'activity at 4967' });
    });
    const result = await collectPending({ env, runtimeDir, fetch: fetchMock, isAlive: () => true });
    expect(result.output).toBe('activity at 4967');
    expect(result.errors).toEqual([expect.stringContaining('4966.json: fetch failed')]);
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a registry that other users can write',
    async () => {
      register(4966, 100);
      chmodSync(join(runtimeDir, 'gavel'), 0o777);
      await expect(
        collectPending({ env, runtimeDir, fetch: fetchMock, isAlive: () => true }),
      ).rejects.toThrow(/other users cannot write/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('keeps collected activity when another server unregisters during collection', async () => {
    register(4966, 100);
    const second = register(4967, 101);
    fetchMock.mockImplementation(async () => {
      // The second server shuts down while the first answers.
      rmSync(second, { force: true });
      return Response.json({ pending: 'activity at 4966' });
    });
    const result = await collectPending({ env, runtimeDir, fetch: fetchMock, isAlive: () => true });
    expect(result).toEqual({ output: 'activity at 4966', errors: [] });
  });

  it('does nothing outside a Claude Code session', async () => {
    register(4966, 100);
    const result = await collectPending({
      env: {},
      runtimeDir,
      fetch: fetchMock,
      isAlive: () => true,
    });
    expect(result).toEqual({ output: '', errors: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
