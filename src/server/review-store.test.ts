import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewCapture } from '../types/review.js';
import { createDiffSelection } from '../utils/diffSelection.js';

import {
  REVIEW_RETENTION_MS,
  ReviewStore,
  SERVER_HEARTBEAT_MS,
  savedReviewKey,
  type ReviewOwner,
  type SavedReview,
} from './review-store.js';

const now = Date.parse('2026-11-07T12:00:00.000Z');
const base = 'c'.repeat(40);
// Names gavel generates, which cleanup acts on.
const corrupt = `${'f'.repeat(64)}.json`;
const gone = {
  hashed: `${'e'.repeat(64)}.json`,
  server: '00000000-0000-4000-8000-000000000000.json',
};
const version = (patchDigest: string, baseCommit = base) => ({
  version: 1,
  patchDigest,
  baseCommit,
});

function review(patchDigest?: string, repositoryId = 'repo'): SavedReview {
  return {
    format: 1,
    repositoryId,
    selection: createDiffSelection('a'.repeat(40), 'b'.repeat(40)),
    threads: [],
    progress: [],
    approval: { verdict: 'approve', summaryVersion: 1 },
    summary: { commitMessage: 'fix: keep it', rationale: '', version: 1 },
    ...(patchDigest ? { captures: [version(patchDigest)] } : {}),
    updatedAt: new Date(now).toISOString(),
  };
}

function capture(patchDigest: string, repositoryId = 'repo', baseCommit = base): ReviewCapture {
  return {
    patchDigest,
    repositoryId,
    baseCommit,
    repositoryRoot: `/${repositoryId}`,
    patch: '',
    files: [],
  } as unknown as ReviewCapture;
}

describe('ReviewStore', () => {
  let directory: string;
  let store: ReviewStore;
  let server: ReturnType<ReviewStore['registerServer']>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'gavel-review-store-'));
    store = new ReviewStore(directory, () => now);
    server = store.registerServer();
  });

  afterEach(() => {
    server.release();
    vi.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  });

  function age(subdirectory: string, milliseconds: number): void {
    const seconds = (now - milliseconds) / 1000;
    for (const name of readdirSync(join(directory, subdirectory)))
      utimesSync(join(directory, subdirectory, name), seconds, seconds);
  }

  it('reads back a saved review and leaves no temporary file', () => {
    expect(store.save('key', review(), server.owner)).toBe('saved');
    expect(store.load('key')).toEqual(review());
    expect(store.has('key')).toBe(true);
    for (const subdirectory of ['reviews', 'locks', 'servers'])
      expect(
        readdirSync(join(directory, subdirectory)).every((name) => name.endsWith('.json')),
      ).toBe(true);
    store.remove('key', server.owner);
    expect(store.load('key')).toBeUndefined();
  });

  it('writes nothing until a server saves its first review', () => {
    store.vacuum(server.owner);
    expect(readdirSync(directory)).toEqual([]);
  });

  it('fails loudly when a review names a patch that is not saved', () => {
    expect(() => store.loadCapture('repo', version('missing'))).toThrow(/missing/);
    store.saveCapture(capture('present'));
    expect(store.loadCapture('repo', version('present'))).toEqual(capture('present'));
  });

  it('keeps each worktree’s and each base commit’s copy of the same patch', () => {
    store.saveCapture(capture('shared', 'main'));
    store.saveCapture(capture('shared', 'linked'));
    store.saveCapture(capture('shared', 'main', 'd'.repeat(40)));
    expect(store.loadCapture('main', version('shared')).repositoryRoot).toBe('/main');
    expect(store.loadCapture('linked', version('shared')).repositoryRoot).toBe('/linked');
    expect(store.loadCapture('main', version('shared', 'd'.repeat(40))).baseCommit).toBe(
      'd'.repeat(40),
    );
  });

  it('deletes reviews untouched for seven days and keeps newer ones', () => {
    store.save('old', review(), server.owner);
    age('reviews', REVIEW_RETENTION_MS + 1000);
    store.save('new', review(), server.owner);
    store.vacuum(server.owner);
    expect(store.load('old')).toBeUndefined();
    expect(store.load('new')).toBeDefined();
  });

  it('deletes an old patch only once no remaining review uses it', () => {
    store.saveCapture(capture('used'));
    store.saveCapture(capture('used', 'other-worktree'));
    store.saveCapture(capture('orphan'));
    age('captures', REVIEW_RETENTION_MS + 1000);
    store.saveCapture(capture('recent-orphan'));
    store.save('review', review('used'), server.owner);
    store.vacuum(server.owner);
    expect(() => store.loadCapture('repo', version('used'))).not.toThrow();
    expect(() => store.loadCapture('other-worktree', version('used'))).toThrow(/missing/);
    expect(() => store.loadCapture('repo', version('orphan'))).toThrow(/missing/);
    expect(() => store.loadCapture('repo', version('recent-orphan'))).not.toThrow();
  });

  it('skips files another server deletes while this one lists or cleans up', () => {
    for (const subdirectory of ['reviews', 'captures', 'servers', 'locks']) {
      mkdirSync(join(directory, subdirectory), { recursive: true });
      // A dangling link fails stat and read with ENOENT, as a file deleted mid-scan does.
      symlinkSync(
        join(directory, 'gone'),
        join(directory, subdirectory, subdirectory === 'servers' ? gone.server : gone.hashed),
      );
    }
    store.save('kept', review(), server.owner);
    expect(store.list()).toEqual([review()]);
    expect(() => store.vacuum(server.owner)).not.toThrow();
    expect(store.load('kept')).toBeDefined();
  });

  it('cleans up past a review it cannot read, and reports it', () => {
    store.save('old', review(), server.owner);
    age('reviews', REVIEW_RETENTION_MS + 1000);
    writeFileSync(join(directory, 'reviews', corrupt), '{not json');
    const problems = store.vacuum(server.owner);
    expect(problems).toEqual([expect.stringContaining(corrupt)]);
    expect(store.load('old')).toBeUndefined();
    expect(readdirSync(join(directory, 'reviews'))).toContain(corrupt);
  });

  it('names the saved review it cannot read', () => {
    mkdirSync(join(directory, 'reviews'), { recursive: true });
    writeFileSync(join(directory, 'reviews', corrupt), '{not json');
    expect(() => store.list()).toThrow(corrupt);
  });

  it('deletes a heartbeat as soon as its process has exited', () => {
    mkdirSync(join(directory, 'servers'), { recursive: true });
    const exited = {
      serverId: gone.server.replace('.json', ''),
      pid: 2 ** 22 + 1,
      hostname: hostname(),
    };
    writeFileSync(join(directory, 'servers', gone.server), JSON.stringify(exited));
    const remote = '11111111-1111-4111-8111-111111111111.json';
    writeFileSync(
      join(directory, 'servers', remote),
      JSON.stringify({ ...exited, serverId: 'remote', hostname: 'other-host' }),
    );
    store.vacuum(server.owner);
    // Another host's server cannot be checked from here, so its heartbeat stays.
    expect(readdirSync(join(directory, 'servers'))).toEqual([remote]);
  });

  it('keeps every patch while a retained review cannot be read', () => {
    mkdirSync(join(directory, 'reviews'), { recursive: true });
    store.saveCapture(capture('maybe-used'));
    age('captures', REVIEW_RETENTION_MS + 1000);
    writeFileSync(join(directory, 'reviews', corrupt), '{not json');
    store.vacuum(server.owner);
    expect(() => store.loadCapture('repo', version('maybe-used'))).not.toThrow();
  });

  it('releases a server even when its locks cannot be deleted', () => {
    const other = store.registerServer();
    store.save('key', review(), other.owner);
    chmodSync(join(directory, 'locks'), 0o500);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => other.release()).not.toThrow();
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('could not release'));
      expect(store.ownedByAnotherServer('key', server.owner)).toBe(false);
    } finally {
      chmodSync(join(directory, 'locks'), 0o700);
      errors.mockRestore();
    }
  });

  it('deletes only files whose names gavel generates', () => {
    store.save('old', review(), server.owner);
    for (const subdirectory of ['reviews', 'captures', 'servers', 'locks']) {
      mkdirSync(join(directory, subdirectory), { recursive: true });
      writeFileSync(join(directory, subdirectory, 'notes.txt'), 'not ours');
      writeFileSync(join(directory, subdirectory, 'README.json'), '{}');
    }
    // A lock that names no running server, under a name gavel would not write.
    writeFileSync(
      join(directory, 'locks', 'foreign.json'),
      JSON.stringify({ serverId: 'x', pid: 2 ** 22 + 1, hostname: hostname() }),
    );
    for (const subdirectory of ['reviews', 'captures', 'servers', 'locks'])
      age(subdirectory, REVIEW_RETENTION_MS + 1000);
    store.vacuum(server.owner);
    expect(store.load('old')).toBeUndefined();
    for (const subdirectory of ['reviews', 'captures', 'servers', 'locks'])
      expect(readdirSync(join(directory, subdirectory))).toEqual(
        expect.arrayContaining(['notes.txt', 'README.json']),
      );
    expect(readdirSync(join(directory, 'locks'))).toContain('foreign.json');
    // list() skips foreign files too, so none is read as a saved review.
    expect(store.list()).toEqual([]);
  });

  it('runs on an empty directory', () => {
    store.vacuum(server.owner);
    expect(store.list()).toEqual([]);
    expect(existsSync(join(directory, 'reviews'))).toBe(false);
  });

  it('recreates its heartbeat when someone deletes the store', () => {
    vi.useFakeTimers();
    store.save('key', review(), server.owner);
    rmSync(join(directory, 'servers'), { recursive: true });
    vi.advanceTimersByTime(SERVER_HEARTBEAT_MS);
    expect(readdirSync(join(directory, 'servers'))).toEqual([`${server.owner.serverId}.json`]);
  });

  describe('ownership', () => {
    it('lets only the first running server in this process save a review', () => {
      const other = store.registerServer();
      expect(store.save('key', review(), other.owner)).toBe('saved');
      expect(store.ownedByAnotherServer('key', server.owner)).toBe(true);
      expect(store.ownedByAnotherServer('key', other.owner)).toBe(false);
      expect(store.save('key', { ...review(), threads: [] }, server.owner)).toBe('owned');
      other.release();
      expect(store.ownedByAnotherServer('key', server.owner)).toBe(false);
      expect(store.save('key', review(), server.owner)).toBe('saved');
    });

    it('treats another process as running only with a live pid and a fresh heartbeat', () => {
      const other: ReviewOwner = { serverId: 'elsewhere', pid: process.ppid, hostname: hostname() };
      // Save once to learn the lock file's name, then hand the lock to the other process.
      store.save('key', review(), server.owner);
      const [lockName] = readdirSync(join(directory, 'locks'));
      const hold = (owner: ReviewOwner) =>
        writeFileSync(join(directory, 'locks', lockName!), JSON.stringify(owner));
      const heartbeat = join(directory, 'servers', 'elsewhere.json');
      hold(other);
      expect(store.ownedByAnotherServer('key', server.owner)).toBe(false);
      writeFileSync(heartbeat, '{}');
      const fresh = (now - SERVER_HEARTBEAT_MS) / 1000;
      utimesSync(heartbeat, fresh, fresh);
      expect(store.ownedByAnotherServer('key', server.owner)).toBe(true);
      expect(store.save('key', review(), server.owner)).toBe('owned');
      hold({ ...other, pid: spawnSync(process.execPath, ['-e', '']).pid });
      expect(store.ownedByAnotherServer('key', server.owner)).toBe(false);
      hold({ ...other, hostname: 'other-host' });
      expect(store.ownedByAnotherServer('key', server.owner)).toBe(false);
      // A pid reused by an unrelated process: its heartbeat stopped long ago.
      hold(other);
      const stale = (now - 4 * SERVER_HEARTBEAT_MS) / 1000;
      utimesSync(heartbeat, stale, stale);
      expect(store.ownedByAnotherServer('key', server.owner)).toBe(false);
      expect(store.save('key', review(), server.owner)).toBe('saved');
      expect(store.ownedByAnotherServer('key', other)).toBe(true);
    });

    it('never deletes a lock another server took after the stale one', () => {
      store.save('key', review(), server.owner);
      const [lockName] = readdirSync(join(directory, 'locks'));
      const lock = join(directory, 'locks', lockName!);
      const crashed: ReviewOwner = { serverId: 'crashed', pid: 2 ** 22 + 1, hostname: hostname() };
      const winner = store.registerServer();
      // This server saw the crashed server's lock, but another server replaced it first.
      writeFileSync(lock, JSON.stringify(winner.owner));
      const reclaim = store['reclaim'].bind(store);
      expect(reclaim(lock, crashed, server.owner)).toBe(false);
      expect(JSON.parse(readFileSync(lock, 'utf8'))).toEqual(winner.owner);
      winner.release();
    });

    it('clears a reclaim guard left by a crashed server', () => {
      store.save('key', review(), server.owner);
      const [lockName] = readdirSync(join(directory, 'locks'));
      const lock = join(directory, 'locks', lockName!);
      const crashed: ReviewOwner = { serverId: 'crashed', pid: 2 ** 22 + 1, hostname: hostname() };
      writeFileSync(lock, JSON.stringify(crashed));
      writeFileSync(`${lock}.reclaim`, '{}');
      const reclaim = store['reclaim'].bind(store);
      expect(reclaim(lock, crashed, server.owner)).toBe(false);
      const abandoned = (now - 60 * 1000) / 1000;
      utimesSync(`${lock}.reclaim`, abandoned, abandoned);
      expect(reclaim(lock, crashed, server.owner)).toBe(false);
      expect(reclaim(lock, crashed, server.owner)).toBe(true);
      expect(store.save('key', review(), server.owner)).toBe('saved');
    });

    it('reports a lock another server is reclaiming as busy, not owned', () => {
      store.save('key', review(), server.owner);
      const [lockName] = readdirSync(join(directory, 'locks'));
      const lock = join(directory, 'locks', lockName!);
      const crashed: ReviewOwner = { serverId: 'crashed', pid: 2 ** 22 + 1, hostname: hostname() };
      writeFileSync(lock, JSON.stringify(crashed));
      // Another server's cleanup holds the guard while it deletes the crashed server's lock.
      writeFileSync(`${lock}.reclaim`, '{}');
      expect(store.save('key', review(), server.owner)).toBe('busy');
      rmSync(`${lock}.reclaim`);
      expect(store.save('key', review(), server.owner)).toBe('saved');
    });

    it('rewrites its heartbeat on every save, even after the store was deleted', () => {
      store.save('first', review(), server.owner);
      rmSync(join(directory, 'servers'), { recursive: true });
      store.save('second', review(), server.owner);
      expect(readdirSync(join(directory, 'servers'))).toEqual([`${server.owner.serverId}.json`]);
    });

    it('drops a stopped server’s locks and heartbeat', () => {
      const other = store.registerServer();
      store.save('key', review(), other.owner);
      other.release();
      expect(readdirSync(join(directory, 'locks'))).toEqual([]);
      expect(readdirSync(join(directory, 'servers'))).toEqual([]);
    });
  });
});

describe('savedReviewKey', () => {
  const selection = createDiffSelection('a'.repeat(40), 'b'.repeat(40));
  const named = createDiffSelection('a'.repeat(40), '.', undefined, 'task');

  it('keeps two named tasks with the same patch apart', () => {
    expect(savedReviewKey('repo', named, { patchDigest: 'd' })).not.toBe(
      savedReviewKey('repo', { ...named, reviewName: 'other' }, { patchDigest: 'd' }),
    );
  });

  it('gives a named review a new identity when its patch changes', () => {
    expect(savedReviewKey('repo', named, { patchDigest: 'd1' })).not.toBe(
      savedReviewKey('repo', named, { patchDigest: 'd2' }),
    );
  });

  it('keys other reviews by repository and resolved selection, and skips stdin patches', () => {
    expect(savedReviewKey('repo', selection, undefined)).toBe(
      savedReviewKey('repo', { ...selection }, undefined),
    );
    expect(savedReviewKey('repo', selection, undefined)).not.toBe(
      savedReviewKey('other-worktree', selection, undefined),
    );
    expect(savedReviewKey('repo', createDiffSelection('stdin', 'stdin'), undefined)).toBe(
      undefined,
    );
  });
});
