import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

import { subscribe, type SubscribeCallback } from '@parcel/watcher';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiffMode } from '../types/watch.js';

import { FileWatcherService } from './file-watcher.js';

// The real git answers the .gitignore check; only the native watcher is replaced, so a test can
// hand the working-tree callback the events a file change would produce.
vi.mock('@parcel/watcher', () => ({ subscribe: vi.fn() }));

describe('FileWatcherService .gitignore check with real git', () => {
  let root: string;
  let watcher: FileWatcherService;
  let broadcast: ReturnType<typeof vi.fn>;
  let onWorkingTreeEvents: SubscribeCallback;

  beforeEach(async () => {
    for (const key of Object.keys(process.env))
      if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
    vi.stubEnv('GIT_CONFIG_GLOBAL', devNull);
    vi.stubEnv('GIT_CONFIG_SYSTEM', devNull);
    // simple-git drops GIT_* variables from the git it spawns, so its global config comes
    // from HOME and XDG_CONFIG_HOME.
    vi.stubEnv('HOME', devNull);
    vi.stubEnv('XDG_CONFIG_HOME', devNull);
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-file-watcher-')));
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), '*.log\n');
    for (const name of ['-ignored.log', '--stdin']) writeFileSync(join(root, name), '');
    vi.mocked(subscribe).mockResolvedValue({ unsubscribe: vi.fn().mockResolvedValue(undefined) });

    watcher = new FileWatcherService();
    broadcast = vi.fn();
    Object.assign(watcher, { debouncedBroadcast: broadcast });
    await watcher.start(DiffMode.DOT, root);
    const workingTreeWatch = vi.mocked(subscribe).mock.calls.find(([path]) => path === root);
    if (!workingTreeWatch) throw new Error('The working tree was not watched');
    onWorkingTreeEvents = workingTreeWatch[1];
  });

  afterEach(async () => {
    await watcher.stop();
    vi.mocked(subscribe).mockReset();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('skips an ignored file whose name starts with "-"', async () => {
    await onWorkingTreeEvents(null, [{ path: join(root, '-ignored.log'), type: 'create' }]);

    expect(broadcast).not.toHaveBeenCalled();
  });

  it('reports a file named --stdin instead of waiting on git check-ignore stdin', async () => {
    await onWorkingTreeEvents(null, [{ path: join(root, '--stdin'), type: 'create' }]);

    expect(broadcast).toHaveBeenCalledOnce();
  });
});
